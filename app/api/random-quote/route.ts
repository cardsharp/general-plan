import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite } from "@/lib/sqlite";
import { runChatModel } from "@/lib/chat-model";
import { Chunk } from "@/lib/types";

const outputSchema = z.object({
  title: z.string().min(3),
  quotation: z.string().min(8),
  insight: z.string().min(8),
});
const outputArraySchema = z.array(outputSchema).min(1);
const CACHE_TARGET = Number(process.env.RANDOM_QUOTE_CACHE_SIZE || "30");
let quoteCache: Array<{ title: string; quotation: string; insight: string }> = [];
let generatingCache: Promise<void> | null = null;

function truncateWords(text: string, maxWords: number) {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function parseJsonObject(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as unknown;
  } catch {
    return null;
  }
}

function parseJsonArray(text: string) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as unknown;
  } catch {
    return null;
  }
}

function toChunkRows(): Chunk[] {
  const db = getSqlite();
  const rows = db
    .prepare(
      `
      select id, doc_id, doc_title, page, paragraph, text, source_type, url
      from document_chunks
      where source_type = 'plan'
      order by random()
      limit 8
      `
    )
    .all() as Array<{
    id: string;
    doc_id: string;
    doc_title: string;
    page: number;
    paragraph: number;
    text: string;
    source_type: "plan" | "web";
    url: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    doc_id: row.doc_id,
    doc_title: row.doc_title,
    page: row.page,
    paragraph: row.paragraph,
    text: row.text,
    quote: row.text.slice(0, 220),
    source_type: row.source_type,
    url: row.url ?? undefined,
  }));
}

function buildCompactEvidence(chunks: Chunk[]) {
  return chunks
    .map((c) => {
      const short = c.text.replace(/\s+/g, " ").trim().slice(0, 360);
      return `[${c.doc_title} p${c.page} ¶${c.paragraph}] ${short}`;
    })
    .join("\n");
}

function randomFrom<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeItem(item: { title: string; quotation: string; insight: string }) {
  return {
    title: truncateWords(item.title, 4),
    quotation: item.quotation.trim(),
    insight: truncateWords(item.insight, 10),
  };
}

function buildFallbackCache(chunks: Chunk[]) {
  const out: Array<{ title: string; quotation: string; insight: string }> = [];
  for (let i = 0; i < Math.min(CACHE_TARGET, chunks.length); i += 1) {
    const c = chunks[i];
    out.push({
      title: "Plan Tension",
      quotation: c.text.slice(0, 280),
      insight: "Officials cite changes some residents may view negatively.",
    });
  }
  return out;
}

async function generateQuoteCache(chunks: Chunk[]) {
  if (quoteCache.length >= CACHE_TARGET) return;
  if (generatingCache) {
    await generatingCache;
    return;
  }

  generatingCache = (async () => {
    const evidence = buildCompactEvidence(chunks);
    const system = [
      "You are a hard hitting reporter analyzing a city plan for stories that might interest residents. There is an undercurrent of mistrust of the city plan stemming from development of a loved golf course, government overstepping their right with trail easements on private land, and a history of ignoring citizens in favor of what officials want. You are finding insights that residents would find interesting.",
      "Use only the provided evidence text.",
      "Return JSON only.",
      "Output must be a JSON array of objects with keys: title, quotation, insight.",
      "Generate exactly 30 objects.",
      "Each title must be 4 words or fewer.",
      "Each insight must be limited to 10 words or less.",
      "Write each title and insight in concise reporter style.",
      "Each quotation must be copied from evidence and should be limited to 1-2 sentences and include a page reference.",
      "No markdown.",
    ].join("\n");

    const user = [
      `Find random facts from the general plan that discuss development of the golf course, reduction or development of open spaces, development of low or median income housing, devleopment of high density housing, commercial development of the golf course, commercial business, trails or easements through private property, changes in population size, or any other item that could represent city interests at the expense of private property or freedoms.`,
      "When generating title and insight, write as a reporter looking for things that would alarm or upset citizens.",
      "Generate 30 varied items.",
      "",
      "Evidence:",
      evidence,
      "",
      "Output JSON array only.",
    ].join("\n");

    const raw = await runChatModel({ system, user });
    const parsedArray = parseJsonArray(raw);
    const parsedObject = parseJsonObject(raw);

    const validatedArray = outputArraySchema.safeParse(parsedArray);
    const validatedObject = outputSchema.safeParse(parsedObject);

    let generated: Array<{ title: string; quotation: string; insight: string }> = [];
    if (validatedArray.success) {
      generated = validatedArray.data.map(normalizeItem);
    } else if (validatedObject.success) {
      generated = [normalizeItem(validatedObject.data)];
    }

    if (generated.length === 0) {
      quoteCache = buildFallbackCache(chunks);
      return;
    }

    while (generated.length < CACHE_TARGET) {
      generated.push(normalizeItem(randomFrom(generated)));
    }
    quoteCache = generated.slice(0, CACHE_TARGET);
  })();

  try {
    await generatingCache;
  } finally {
    generatingCache = null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    if (refresh) {
      quoteCache = [];
    }

    const chunks = toChunkRows();
    if (chunks.length === 0) {
      return NextResponse.json({ error: "No plan chunks are indexed yet." }, { status: 404 });
    }

    if (quoteCache.length === 0) {
      await generateQuoteCache(chunks);
    }

    if (quoteCache.length === 0) {
      return NextResponse.json({ error: "Quote cache is empty." }, { status: 500 });
    }

    return NextResponse.json(randomFrom(quoteCache));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate random quote" },
      { status: 500 }
    );
  }
}
