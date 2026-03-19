import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { embedText } from "../lib/embeddings";
import { forceUpdateChunkEmbedding, listPendingEmbeddingChunks } from "../lib/vector-store";

const STATE_PATH = process.env.PENDING_EMBED_STATE_PATH || "./data/pending-embed-state.json";
const BATCH_SIZE = Number(process.env.PENDING_EMBED_BATCH_SIZE || "50");
const CONCURRENCY = Math.max(1, Number(process.env.PENDING_EMBED_CONCURRENCY || "4"));

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as { lastRowid: number };
  } catch {
    return { lastRowid: 0 };
  }
}

async function writeState(state: { lastRowid: number }) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function run() {
  let lastRowid = (await readState()).lastRowid || 0;
  let processed = 0;
  const startedAt = Date.now();

  console.log(`Embedding pending chunks from rowid > ${lastRowid}`);
  console.log(`Batch size: ${BATCH_SIZE}, concurrency: ${CONCURRENCY}`);

  while (true) {
    const rows = await listPendingEmbeddingChunks(lastRowid, BATCH_SIZE);
    if (rows.length === 0) {
      if (lastRowid > 0) {
        lastRowid = 0;
        const retryRows = await listPendingEmbeddingChunks(lastRowid, 1);
        if (retryRows.length === 0) break;
      } else {
        break;
      }
    }

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (row) => {
          const input = `${row.doc_title} page ${row.page} paragraph ${row.paragraph}\n${row.text}`;
          const embedding = await embedText(input);
          await forceUpdateChunkEmbedding(row.id, embedding);
        })
      );

      lastRowid = Math.max(lastRowid, ...slice.map((row) => row.rowid));
      processed += slice.length;

      if (processed % 20 === 0) {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        const rate = (processed / elapsedSec).toFixed(2);
        console.log(`Embedded ${processed} pending chunks (last rowid ${lastRowid}, ~${rate}/s)`);
      }

      await writeState({ lastRowid });
    }
  }

  await writeState({ lastRowid: 0 });
  console.log(`Done. Embedded ${processed} pending chunks.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
