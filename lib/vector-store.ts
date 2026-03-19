import { Chunk } from "@/lib/types";
import { getSqlite } from "@/lib/sqlite";
import crypto from "node:crypto";

type StoredChunkRow = {
  rowid: number;
  id: string;
  doc_id: string;
  doc_title: string;
  page: number;
  paragraph: number;
  text: string;
  source_type: "plan" | "web";
  url: string | null;
  embedding_blob: Buffer | null;
};

type WebSourceStateRow = {
  url: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  checked_at: string;
  indexed_at: string | null;
};

type AppStateRow = {
  key: string;
  value: string;
};

export type ReembedChunkRow = {
  rowid: number;
  id: string;
  doc_title: string;
  page: number;
  paragraph: number;
  text: string;
};

export type WebSourceState = {
  url: string;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  checkedAt: string;
  indexedAt?: string;
};

function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toEmbeddingBlob(embedding: number[]) {
  const float = Float32Array.from(embedding);
  return Buffer.from(float.buffer);
}

function fromEmbeddingBlob(blob: Buffer | null) {
  if (!blob || blob.byteLength === 0) return null;
  if (blob.byteLength % 4 !== 0) return null;
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function buildFtsQuery(input: string) {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 10);
  return tokens.join(" OR ");
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function upsertChunk(chunk: Chunk, embedding: number[]) {
  const db = getSqlite();
  const contentHash = hashText(chunk.text);
  const stmt = db.prepare(`
    insert into document_chunks (
      id, doc_id, doc_title, page, paragraph, text, source_type, url, content_hash, embedding_blob
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      doc_id = excluded.doc_id,
      doc_title = excluded.doc_title,
      page = excluded.page,
      paragraph = excluded.paragraph,
      text = excluded.text,
      source_type = excluded.source_type,
      url = excluded.url,
      content_hash = excluded.content_hash,
      embedding_blob = excluded.embedding_blob
    where document_chunks.content_hash <> excluded.content_hash
  `);
  stmt.run(
    chunk.id,
    chunk.doc_id,
    chunk.doc_title,
    chunk.page,
    chunk.paragraph,
    chunk.text,
    chunk.source_type,
    chunk.url ?? null,
    contentHash,
    toEmbeddingBlob(embedding)
  );
}

export async function upsertChunkWithoutEmbedding(chunk: Chunk) {
  const db = getSqlite();
  const contentHash = hashText(chunk.text);
  const stmt = db.prepare(`
    insert into document_chunks (
      id, doc_id, doc_title, page, paragraph, text, source_type, url, content_hash, embedding_blob
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
    on conflict(id) do update set
      doc_id = excluded.doc_id,
      doc_title = excluded.doc_title,
      page = excluded.page,
      paragraph = excluded.paragraph,
      text = excluded.text,
      source_type = excluded.source_type,
      url = excluded.url,
      content_hash = excluded.content_hash,
      embedding_blob = case
        when document_chunks.content_hash = excluded.content_hash then document_chunks.embedding_blob
        else null
      end
  `);
  stmt.run(
    chunk.id,
    chunk.doc_id,
    chunk.doc_title,
    chunk.page,
    chunk.paragraph,
    chunk.text,
    chunk.source_type,
    chunk.url ?? null,
    contentHash
  );
}

export async function isChunkCurrent(chunk: Pick<Chunk, "id" | "text">): Promise<boolean> {
  const db = getSqlite();
  const row = db
    .prepare("select content_hash from document_chunks where id = ?")
    .get(chunk.id) as { content_hash: string } | undefined;
  if (!row) return false;
  return row.content_hash === hashText(chunk.text);
}

export async function hasIndexedChunksForDoc(docId: string): Promise<boolean> {
  const db = getSqlite();
  const row = db
    .prepare("select 1 as one from document_chunks where doc_id = ? limit 1")
    .get(docId) as { one: number } | undefined;
  return !!row;
}

export async function listChunksForReembed(afterRowid: number, limit: number): Promise<ReembedChunkRow[]> {
  const db = getSqlite();
  return db
    .prepare(
      `
      select rowid, id, doc_title, page, paragraph, text
      from document_chunks
      where rowid > ?
      order by rowid asc
      limit ?
      `
    )
    .all(afterRowid, limit) as ReembedChunkRow[];
}

export async function listPendingEmbeddingChunks(afterRowid: number, limit: number): Promise<ReembedChunkRow[]> {
  const db = getSqlite();
  return db
    .prepare(
      `
      select rowid, id, doc_title, page, paragraph, text
      from document_chunks
      where rowid > ? and embedding_blob is null
      order by rowid asc
      limit ?
      `
    )
    .all(afterRowid, limit) as ReembedChunkRow[];
}

export async function forceUpdateChunkEmbedding(id: string, embedding: number[]) {
  const db = getSqlite();
  db.prepare("update document_chunks set embedding_blob = ? where id = ?").run(toEmbeddingBlob(embedding), id);
}

export async function setAppState(key: string, value: string) {
  const db = getSqlite();
  db.prepare(
    `
    insert into app_state (key, value, updated_at)
    values (?, ?, datetime('now'))
    on conflict(key) do update set
      value = excluded.value,
      updated_at = datetime('now')
    `
  ).run(key, value);
}

export async function getAppState(key: string): Promise<string | null> {
  const db = getSqlite();
  const row = db.prepare("select key, value from app_state where key = ?").get(key) as AppStateRow | undefined;
  return row?.value ?? null;
}

export async function deleteWebChunksByUrl(url: string): Promise<number> {
  const db = getSqlite();
  const stmt = db.prepare("delete from document_chunks where source_type = 'web' and url = ?");
  const result = stmt.run(url);
  return result.changes;
}

export async function getWebSourceState(url: string): Promise<WebSourceState | null> {
  const db = getSqlite();
  const row = db
    .prepare(
      "select url, etag, last_modified, content_hash, checked_at, indexed_at from web_source_state where url = ?"
    )
    .get(url) as WebSourceStateRow | undefined;
  if (!row) return null;
  return {
    url: row.url,
    etag: row.etag ?? undefined,
    lastModified: row.last_modified ?? undefined,
    contentHash: row.content_hash ?? undefined,
    checkedAt: row.checked_at,
    indexedAt: row.indexed_at ?? undefined,
  };
}

export async function upsertWebSourceState(input: {
  url: string;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  didIndex: boolean;
}) {
  const db = getSqlite();
  db.prepare(
    `
    insert into web_source_state (url, etag, last_modified, content_hash, checked_at, indexed_at)
    values (?, ?, ?, ?, datetime('now'), case when ? then datetime('now') else null end)
    on conflict(url) do update set
      etag = excluded.etag,
      last_modified = excluded.last_modified,
      content_hash = coalesce(excluded.content_hash, web_source_state.content_hash),
      checked_at = datetime('now'),
      indexed_at = case when ? then datetime('now') else web_source_state.indexed_at end
    `
  ).run(
    input.url,
    input.etag ?? null,
    input.lastModified ?? null,
    input.contentHash ?? null,
    input.didIndex ? 1 : 0,
    input.didIndex ? 1 : 0
  );
}

export async function searchChunks(queryText: string, queryEmbedding: number[], limit = 8): Promise<Chunk[]> {
  const db = getSqlite();
  const ftsQuery = buildFtsQuery(queryText);
  const planSourceBoost = envNumber("PLAN_SOURCE_BOOST", 0.2);
  const planTitleBoost = envNumber("PLAN_TITLE_BOOST", 0.15);
  const lexicalBoostBase = envNumber("LEXICAL_BOOST_BASE", 0.05);
  const lexicalBoostDecay = envNumber("LEXICAL_BOOST_DECAY", 0.00025);

  let rows: StoredChunkRow[] = [];
  if (ftsQuery) {
    rows = db
      .prepare(
        `
        select
          dc.rowid as rowid,
          dc.id,
          dc.doc_id,
          dc.doc_title,
          dc.page,
          dc.paragraph,
          dc.text,
          dc.source_type,
          dc.url,
          dc.embedding_blob
        from document_chunks_fts fts
        join document_chunks dc on dc.rowid = fts.rowid
        where document_chunks_fts match ?
        order by bm25(document_chunks_fts)
        limit 200
        `
      )
      .all(ftsQuery) as StoredChunkRow[];
  }

  if (rows.length === 0) {
    rows = db
      .prepare(
        `
        select rowid, id, doc_id, doc_title, page, paragraph, text, source_type, url, embedding_blob
        from document_chunks
        limit 500
        `
      )
      .all() as StoredChunkRow[];
  }

  const ranked = rows
    .map((row, idx) => {
      const embedding = fromEmbeddingBlob(row.embedding_blob);
      const semanticScore = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
      const lexicalScore = ftsQuery ? Math.max(0, lexicalBoostBase - idx * lexicalBoostDecay) : 0;
      const sourceScore = row.source_type === "plan" ? planSourceBoost : 0;
      const titleScore = /fruit heights general plan/i.test(row.doc_title) ? planTitleBoost : 0;
      // Favor city-plan chunks while still preserving semantic relevance ordering.
      const score = semanticScore + lexicalScore + sourceScore + titleScore;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
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

  return ranked;
}

export async function recordThemeEvent(question: string, theme: string) {
  const db = getSqlite();
  db.prepare("insert into question_events (question, theme) values (?, ?)").run(question, theme);
}

export async function topThemes(limit = 10): Promise<Array<{ theme: string; count: number }>> {
  const db = getSqlite();
  const rows = db
    .prepare(
      "select theme, count(*) as count from question_events group by theme order by count desc limit ?"
    )
    .all(limit) as Array<{ theme: string; count: number }>;
  return rows;
}
