import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { embedText } from "../lib/embeddings";
import { upsertChunk } from "../lib/vector-store";
import { Chunk } from "../lib/types";

const DEFAULT_INPUT = "./transcripts";
const EXTENSIONS = new Set([".txt", ".md", ".vtt", ".srt"]);

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanTranscript(text: string) {
  return text
    .replace(/^WEBVTT\s*$/gim, "")
    .replace(/^\d+\s*$/gim, "")
    .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[\.,]\d{3}.*/g, "")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}.*/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitChunks(text: string, size = 1100, overlap = 180): string[] {
  const out: string[] = [];
  if (!text) return out;
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    const chunk = text.slice(i, end).trim();
    if (chunk.length > 120) out.push(chunk);
    if (end >= text.length) break;
    i = Math.max(0, end - overlap);
  }
  return out;
}

async function walkFiles(entry: string): Promise<string[]> {
  const stat = await fs.stat(entry);
  if (stat.isFile()) return [entry];

  const files: string[] = [];
  const stack = [entry];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (EXTENSIONS.has(ext)) files.push(full);
      }
    }
  }

  files.sort();
  return files;
}

async function run() {
  const inputPath = path.resolve(process.argv[2] || DEFAULT_INPUT);
  const files = await walkFiles(inputPath);

  if (files.length === 0) {
    throw new Error(`No transcript files found in ${inputPath}. Add .txt/.md/.vtt/.srt files.`);
  }

  let totalChunks = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const cleaned = cleanTranscript(raw);
    const parts = splitChunks(cleaned);

    if (parts.length === 0) {
      console.log(`Skipped ${filePath} (no usable text)`);
      continue;
    }

    const relative = path.relative(process.cwd(), filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const docId = `transcript-${slug(base)}-${crypto.createHash("md5").update(relative).digest("hex").slice(0, 8)}`;
    const docTitle = `Meeting Transcript: ${base}`;

    for (let i = 0; i < parts.length; i += 1) {
      const text = parts[i];
      const chunk: Chunk = {
        id: `${docId}-c${i + 1}`,
        doc_id: docId,
        doc_title: docTitle,
        page: 1,
        paragraph: i + 1,
        text,
        quote: text.slice(0, 220),
        source_type: "web",
        url: `file:${relative}`,
      };

      const embedding = await embedText(`${docTitle}\n${text}`);
      await upsertChunk(chunk, embedding);
      totalChunks += 1;
    }

    console.log(`Indexed transcript ${relative} (${parts.length} chunks)`);
  }

  console.log(`Done. Indexed ${totalChunks} transcript chunks from ${files.length} file(s).`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
