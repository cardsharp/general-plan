import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SYSTEM_PROMPT } from "@/lib/config";
import { embedText } from "@/lib/embeddings";
import { buildContext, buildUserPrompt } from "@/lib/prompt-builder";
import { classifyTheme } from "@/lib/theme-classifier";
import { runChatModel } from "@/lib/chat-model";
import { recordThemeEvent, searchChunks } from "@/lib/vector-store";
import { buildSafeFallback, buildStrictRepairPrompt, validateGroundedAnswer } from "@/lib/citation-guard";

const schema = z.object({
  message: z.string().min(3),
});

function normalizeCitationSyntax(text: string) {
  // Normalize bracketed citation blocks to canonical [pX ¶Y] form.
  return text.replace(/\[([^\]]+)\]/g, (full, inner) => {
    const pairs: RegExpMatchArray[] = [];
    const matches = inner.matchAll(
      /(?:^|[\s,;])(?:[A-Za-z]+\s+)?(?:p|page)\s*\.?\s*(\d+)\s*(?:¶|para(?:graph)?)\s*\.?\s*(\d+)/gi
    );
    for (const m of matches) {
      pairs.push(m);
    }
    if (pairs.length === 0) return full;
    const normalized = pairs.map((m) => `p${m[1]} ¶${m[2]}`).join(", ");
    return `[${normalized}]`;
  });
}

function defaultNextOptions(question: string) {
  const short = question.trim().slice(0, 120);
  return [
    `Give me a brief 3-bullet summary of: ${short}`,
    `Show the strongest quotes and sources for this topic`,
    `What are the top risks and what should I ask next?`,
  ];
}

function extractNextOptions(answer: string, question: string) {
  const lines = answer.split(/\r?\n/);
  const start = lines.findIndex((line) => /^(\*\*)?\s*next options\s*:?\s*(\*\*)?$/i.test(line.trim()));
  if (start < 0) {
    return { cleanAnswer: answer.trim(), nextOptions: defaultNextOptions(question) };
  }

  const options: string[] = [];
  let end = start;
  let seenContent = false;

  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    const isBoundary =
      /^(\*\*)?\s*sources\s*:?\s*(\*\*)?$/i.test(trimmed) ||
      /^[-_]{3,}$/.test(trimmed) ||
      /^#{1,6}\s+/.test(trimmed);

    if (isBoundary) {
      end = i - 1;
      break;
    }

    if (!trimmed) {
      if (seenContent) {
        end = i;
        break;
      }
      end = i;
      continue;
    }

    seenContent = true;
    end = i;
    const option = trimmed.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
    if (!option) continue;
    if (option.length > 140) continue;
    if (!options.some((o) => o.toLowerCase() === option.toLowerCase())) {
      options.push(option);
    }
    if (options.length >= 3) {
      break;
    }
  }

  const cleanedLines = [...lines.slice(0, start), ...lines.slice(end + 1)];
  const cleanAnswer = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    cleanAnswer,
    nextOptions: options.length ? options.slice(0, 3) : defaultNextOptions(question),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const theme = classifyTheme(body.message);

    const queryEmbedding = await embedText(body.message);
    const chunks = await searchChunks(body.message, queryEmbedding, 10);
    const context = buildContext(chunks);
    const baseUserPrompt = buildUserPrompt(body.message, context);

    const firstPass = await runChatModel({
      system: SYSTEM_PROMPT,
      user: baseUserPrompt,
    });

    const firstPassNormalized = normalizeCitationSyntax(firstPass);
    const firstValidation = validateGroundedAnswer(firstPassNormalized, chunks);
    let answer = firstPassNormalized;

    if (!firstValidation.ok) {
      const secondPass = await runChatModel({
        system: SYSTEM_PROMPT,
        user: `${baseUserPrompt}\n\n${buildStrictRepairPrompt(firstValidation.reason)}`,
      });

      const secondPassNormalized = normalizeCitationSyntax(secondPass);
      const secondValidation = validateGroundedAnswer(secondPassNormalized, chunks);
      answer = secondValidation.ok ? secondPassNormalized : buildSafeFallback(chunks, body.message);
    }

    const { cleanAnswer, nextOptions } = extractNextOptions(answer, body.message);

    await recordThemeEvent(body.message, theme);

    return NextResponse.json({
      answer: cleanAnswer,
      nextOptions,
      theme,
      citations: chunks.map((c) => ({
        id: `${c.doc_id}-p${c.page}-q${c.paragraph}`,
        label: `${c.doc_title} [p${c.page} ¶${c.paragraph}]`,
        quote: c.quote,
        url: c.url ?? null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
