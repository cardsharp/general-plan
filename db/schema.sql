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
