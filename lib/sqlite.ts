import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

function getDbPath() {
  const raw = process.env.SQLITE_PATH || "./data/app.db";
  return path.resolve(raw);
}

function ensureSchema(conn: Database.Database) {
  conn.exec(`
    create table if not exists document_chunks (
      id text primary key,
      doc_id text not null,
      doc_title text not null,
      page integer not null,
      paragraph integer not null,
      text text not null,
      source_type text not null,
      url text,
      content_hash text not null default '',
      embedding_blob blob,
      embedding_json text,
      created_at text not null default (datetime('now'))
    );

    create table if not exists question_events (
      id integer primary key autoincrement,
      question text not null,
      theme text not null,
      created_at text not null default (datetime('now'))
    );

    create table if not exists web_source_state (
      url text primary key,
      etag text,
      last_modified text,
      content_hash text,
      checked_at text not null default (datetime('now')),
      indexed_at text
    );

    create table if not exists app_state (
      key text primary key,
      value text not null,
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_question_events_theme on question_events(theme);
    create index if not exists idx_document_chunks_doc on document_chunks(doc_id, page, paragraph);
    create index if not exists idx_document_chunks_content_hash on document_chunks(content_hash);

    create virtual table if not exists document_chunks_fts using fts5(
      id UNINDEXED,
      text,
      content='document_chunks',
      content_rowid='rowid'
    );

    create trigger if not exists document_chunks_ai after insert on document_chunks begin
      insert into document_chunks_fts(rowid, id, text) values (new.rowid, new.id, new.text);
    end;

    create trigger if not exists document_chunks_ad after delete on document_chunks begin
      insert into document_chunks_fts(document_chunks_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
    end;

    create trigger if not exists document_chunks_au after update on document_chunks begin
      insert into document_chunks_fts(document_chunks_fts, rowid, id, text)
      values ('delete', old.rowid, old.id, old.text);
      insert into document_chunks_fts(rowid, id, text) values (new.rowid, new.id, new.text);
    end;
  `);

  const cols = conn
    .prepare("select name from pragma_table_info('document_chunks')")
    .all() as Array<{ name: string }>;
  const has = new Set(cols.map((c) => c.name));

  if (!has.has("content_hash")) {
    conn.exec("alter table document_chunks add column content_hash text not null default ''");
  }
  if (!has.has("embedding_blob")) {
    conn.exec("alter table document_chunks add column embedding_blob blob");
  }
  if (!has.has("embedding_json")) {
    conn.exec("alter table document_chunks add column embedding_json text");
  }

  migrateLegacyEmbeddings(conn);
  rebuildFtsIfNeeded(conn);
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function migrateLegacyEmbeddings(conn: Database.Database) {
  const rows = conn
    .prepare("select rowid, text, embedding_json, embedding_blob, content_hash from document_chunks")
    .all() as Array<{
    rowid: number;
    text: string;
    embedding_json: string | null;
    embedding_blob: Buffer | null;
    content_hash: string | null;
  }>;

  const update = conn.prepare("update document_chunks set embedding_blob = ?, content_hash = ? where rowid = ?");
  const tx = conn.transaction((items: typeof rows) => {
    for (const row of items) {
      const nextHash = row.content_hash && row.content_hash.length > 0 ? row.content_hash : hashText(row.text);
      let blob = row.embedding_blob;

      if (!blob && row.embedding_json) {
        try {
          const vec = JSON.parse(row.embedding_json) as number[];
          const float = Float32Array.from(vec);
          blob = Buffer.from(float.buffer);
        } catch {
          blob = null;
        }
      }

      if (blob || !row.content_hash || row.content_hash.length === 0) {
        update.run(blob ?? null, nextHash, row.rowid);
      }
    }
  });

  tx(rows);
}

function rebuildFtsIfNeeded(conn: Database.Database) {
  const docCount = (conn.prepare("select count(*) as c from document_chunks").get() as { c: number }).c;
  const ftsCount = (conn.prepare("select count(*) as c from document_chunks_fts").get() as { c: number }).c;
  if (docCount > 0 && ftsCount === 0) {
    conn.exec("insert into document_chunks_fts(document_chunks_fts) values ('rebuild')");
  }
}

export function getSqlite() {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  return db;
}
