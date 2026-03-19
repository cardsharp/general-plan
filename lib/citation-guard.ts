import { Chunk } from "@/lib/types";

const CITATION_PATTERN = /\[p(\d+)\s*¶(\d+)\]/g;
const QUOTE_PATTERN = /"[^"\n]{12,}"/g;

type CitationPair = { page: number; paragraph: number };

function extractCitations(text: string): CitationPair[] {
  const matches = text.matchAll(CITATION_PATTERN);
  const out: CitationPair[] = [];
  for (const m of matches) {
    out.push({ page: Number(m[1]), paragraph: Number(m[2]) });
  }
  return out;
}

function citationInRetrieved(c: CitationPair, chunks: Chunk[]) {
  return chunks.some((chunk) => chunk.page === c.page && chunk.paragraph === c.paragraph);
}

export function validateGroundedAnswer(answer: string, chunks: Chunk[]) {
  const citations = extractCitations(answer);
  const quotes = answer.match(QUOTE_PATTERN) ?? [];

  if (chunks.length === 0) {
    return {
      ok: false,
      reason: "No retrieval evidence available.",
    };
  }

  if (citations.length === 0) {
    return {
      ok: false,
      reason: "Missing citations in [pX ¶Y] format.",
    };
  }

  const allKnown = citations.every((c) => citationInRetrieved(c, chunks));
  if (!allKnown) {
    return {
      ok: false,
      reason: "One or more citations do not map to retrieved evidence.",
    };
  }

  if (quotes.length === 0) {
    return {
      ok: false,
      reason: "Missing direct quote evidence.",
    };
  }

  return { ok: true as const };
}

export function buildStrictRepairPrompt(reason: string) {
  return `
Your previous answer failed validation: ${reason}

Regenerate the answer and obey all rules:
- Include at least two citations in this exact format: [pX ¶Y]
- Only cite pages/paragraphs present in the provided evidence
- Include at least one short direct quote in double quotes
- If evidence is insufficient, explicitly say so and still cite what exists
- End with a Sources section
`;
}

export function buildSafeFallback(chunks: Chunk[], question: string) {
  const top = chunks.slice(0, 4);
  const bullets = top.map((chunk) => {
    const quote = chunk.quote.replace(/\s+/g, " ").trim();
    return `- ${chunk.text.slice(0, 180)}... [p${chunk.page} ¶${chunk.paragraph}] "${quote}"`;
  });

  return [
    `I could not confidently generate a fully grounded response for: "${question}".`,
    "Here is the closest verified evidence I found:",
    ...bullets,
    "",
    "Sources:",
    ...top.map((chunk) => `- ${chunk.doc_title} [p${chunk.page} ¶${chunk.paragraph}]`),
  ].join("\n");
}
