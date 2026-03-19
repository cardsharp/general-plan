import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { embedText } from "../lib/embeddings";
import { forceUpdateChunkEmbedding, listChunksForReembed, setAppState } from "../lib/vector-store";

const STATE_PATH = process.env.REEMBED_STATE_PATH || "./data/reembed-state.json";
const BATCH_SIZE = Number(process.env.REEMBED_BATCH_SIZE || "100");

function embeddingSignature() {
  const primaryProvider = process.env.EMBED_PRIMARY_PROVIDER || process.env.EMBED_PROVIDER || "google";
  const primaryModel = process.env.EMBED_PRIMARY_MODEL || process.env.EMBED_MODEL || "default";
  const primaryBase = process.env.EMBED_PRIMARY_BASE_URL || process.env.EMBED_BASE_URL || "";
  const fallbackProvider = process.env.EMBED_FALLBACK_PROVIDER || "";
  const fallbackModel = process.env.EMBED_FALLBACK_MODEL || "";
  const fallbackBase = process.env.EMBED_FALLBACK_BASE_URL || "";
  return `p:${primaryProvider}:${primaryModel}:${primaryBase}|f:${fallbackProvider}:${fallbackModel}:${fallbackBase}`;
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return JSON.parse(raw) as { lastRowid: number; done?: boolean; signature?: string };
  } catch {
    return { lastRowid: 0 };
  }
}

async function writeState(state: { lastRowid: number; done?: boolean; signature?: string }) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function run() {
  const sig = embeddingSignature();
  const state = await readState();
  let lastRowid = state.lastRowid || 0;

  console.log(`Starting re-embed with signature: ${sig}`);
  console.log(`Resume rowid: ${lastRowid}`);

  let processed = 0;

  while (true) {
    const rows = await listChunksForReembed(lastRowid, BATCH_SIZE);
    if (rows.length === 0) break;

    for (const row of rows) {
      const input = `${row.doc_title} page ${row.page} paragraph ${row.paragraph}\n${row.text}`;
      const embedding = await embedText(input);
      await forceUpdateChunkEmbedding(row.id, embedding);
      lastRowid = row.rowid;
      processed += 1;

      if (processed % 25 === 0) {
        console.log(`Re-embedded ${processed} chunks (last rowid ${lastRowid})`);
      }
    }

    await writeState({ lastRowid, signature: sig });
  }

  await setAppState("embedding_signature", sig);
  await setAppState("embedding_last_reembed_at", new Date().toISOString());
  await writeState({ lastRowid, signature: sig, done: true });

  console.log(`Done. Re-embedded ${processed} chunks. Signature set to ${sig}.`);
  console.log(`State written to ${STATE_PATH}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
