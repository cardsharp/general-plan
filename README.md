# Explore the Fruit Heights City Plan

Mobile-first, citation-grounded chat app for the Fruit Heights General Plan PDF, with support for future county/state web docs and question-theme analytics.

## What this build includes

- High-end mobile-first UI with airy/edgy visual style.
- Chat API with retrieval-augmented generation (RAG).
- Citation payloads with page + paragraph mapping (`[pX ¶Y]`) and quote snippets.
- Citation guard with strict validation + retry + safe fallback when grounding fails.
- Configurable conversation starters and system prompt in `lib/config.ts`.
- PDF ingestion script for indexing plan paragraphs.
- Optional Gemini vision enrichment for map/chart/image-heavy pages during ingestion.
- Web ingestion script for county/state sources.
- Transcript ingestion script for `.txt`, `.md`, `.vtt`, and `.srt` meeting files.
- Direct YouTube ingestion for meeting videos/transcripts (channel + year filtered, no MCP required).
- Theme tracking and public stats endpoint.

## Architecture

- Frontend: Next.js App Router + Tailwind.
- Retrieval store: local SQLite file (`better-sqlite3`) with FTS5 lexical prefilter + in-process cosine ranking.
- Embeddings: simple primary/fallback targets (same config shape for both).
- Chat model: Gemini (default) or OpenAI via env toggle.
- Google embedding mode includes auto-throttle and auto-retry on 429 quota/rate responses.
- Optional embedding failover: set `EMBED_FALLBACK_PROVIDER=ollama` to auto-fallback on 429/transient errors.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill keys.

3. (Optional) Initialize schema manually from `db/schema.sql`.
   The app auto-creates tables on first run, so this step is not required.

4. Ingest the city plan PDF:

```bash
npm run ingest:pdf -- "Fruit Heights General Plan FINAL (1).pdf"
```

If ingestion is interrupted, resume from a page:

```bash
npm run ingest:pdf -- "Fruit Heights General Plan FINAL (1).pdf" 47
```

If the PDF has important map/image content, enable vision enrichment first:

```bash
export PDF_VISION_ENRICH=true
npm run ingest:pdf -- "Fruit Heights General Plan FINAL (1).pdf"
```

Note: vision enrichment uses `pdftoppm` to render pages, so install Poppler (`pdftoppm`) on your machine/host.

5. Optional: ingest state/county web docs:

```bash
npm run ingest:web
```

Web ingestion now checks `ETag`/`Last-Modified` and skips unchanged pages (`304`).
If headers are missing, it uses content-hash comparison and skips re-index when content is unchanged.
When changed, it removes prior chunks for that URL before re-indexing.

6. Optional: ingest meeting transcripts (text-based):

Put files in `./transcripts` (or pass a specific file/folder path), then run:

```bash
npm run ingest:transcript
```

Or:

```bash
npm run ingest:transcript -- "./transcripts/Planning Commission 2026-02-10.txt"
```

7. Run locally:

```bash
npm run dev
```

## YouTube direct ingestion (2019 onward)

Default `ingest:youtube` now uses direct API/tool calls via `yt-dlp` (faster and simpler than MCP for bulk ingest).

```bash
npm run ingest:youtube
```

This scans `.../videos` and `.../streams`, filters by `YOUTUBE_INGEST_START_YEAR`, ingests available captions, and optionally falls back to Whisper transcription when captions are missing.

For very large backfills, use two-phase mode:

1. Fast import without embeddings:

```bash
YOUTUBE_DEFER_EMBED=true npm run ingest:youtube
```

2. Background embedding pass:

```bash
npm run embed:pending
```

`embed:pending` is resumable via `PENDING_EMBED_STATE_PATH`.

## YouTube MCP ingestion (optional)

1. Configure your MCP server command in `.env`:

```bash
YOUTUBE_MCP_COMMAND=...
YOUTUBE_MCP_ARGS=...
YOUTUBE_CHANNEL_URL=https://www.youtube.com/@fruitheightscity9716
YOUTUBE_INGEST_START_YEAR=2019
```

2. Discover tool names:

```bash
npm run mcp:tools
```

3. If auto-detection fails, set:

```bash
YOUTUBE_MCP_SEARCH_TOOL=...
YOUTUBE_MCP_TRANSCRIPT_TOOL=...
```

4. Ingest with MCP mode:

```bash
npm run ingest:youtube:mcp
```

This indexes meeting transcript text into the same retrieval store used by chat.

If your MCP server only has a `get_video_info` tool (no search/list), use video ID mode:

1. Put one YouTube video ID per line in `./data/youtube-video-ids.txt`.
2. Set `YOUTUBE_MCP_VIDEO_INFO_TOOL=get_video_info` in `.env`.
3. Run `npm run ingest:youtube`.

To maximize coverage when MCP transcripts are missing:

- Set `YOUTUBE_FALLBACK_TRANSCRIBE=true`
- Ensure `yt-dlp` is installed and `OPENAI_API_KEY` is set
- The script will download audio and transcribe with `whisper-1` as fallback.

After each run, inspect `./data/youtube-ingest-report.json` for indexed/skipped/failed videos.

For faster ingest on large meeting transcripts, tune chunking in `.env`:

- `YOUTUBE_CHUNK_SIZE` (larger = fewer embedding calls)
- `YOUTUBE_CHUNK_OVERLAP` (smaller = fewer embedding calls)
- `YOUTUBE_MIN_CHUNK_CHARS` (higher = skip tiny chunks)

## Transcript quick checklist

When you get a new meeting transcript:

1. Drop the file into `./transcripts` (`.txt`, `.md`, `.vtt`, or `.srt`).
2. Run `npm run ingest:transcript`.
3. Ask a test question in chat about that meeting to confirm retrieval.

## Hosting

- Simplest host: one Node instance with a persistent volume for `data/app.db`.
- If you deploy to ephemeral serverless, SQLite file persistence may reset between deploys.

## Prompt + Starters Iteration

- Edit `SYSTEM_PROMPT` in `lib/config.ts` as you tune behavior after launch.
- Edit `APP_CONFIG.starters` to change conversation starters without touching UI code.

## Switching embedding models safely (reusable process)

Use one embedding provider/model consistently across the index. Do not mix models in the same vector store.

1. Update `.env`:

```bash
EMBED_PRIMARY_PROVIDER=ollama
EMBED_PRIMARY_MODEL=nomic-embed-text
EMBED_PRIMARY_BASE_URL=http://127.0.0.1:11434
EMBED_PRIMARY_API_KEY=

EMBED_FALLBACK_PROVIDER=ollama
EMBED_FALLBACK_MODEL=nomic-embed-text
EMBED_FALLBACK_BASE_URL=
EMBED_FALLBACK_API_KEY=
```

2. Re-embed existing chunks with resume support:

```bash
npm run reembed:all
```

3. If interrupted, run the same command again. It resumes from `REEMBED_STATE_PATH`.

4. After re-embedding, run normal ingestion commands for new documents.

## Hosted Nomic + local fallback

```bash
EMBED_PRIMARY_PROVIDER=nomic
EMBED_PRIMARY_MODEL=nomic-embed-text-v1.5
EMBED_PRIMARY_BASE_URL=https://api-atlas.nomic.ai/v1/embedding/text
EMBED_PRIMARY_API_KEY=your_nomic_api_key

EMBED_FALLBACK_PROVIDER=ollama
EMBED_FALLBACK_MODEL=nomic-embed-text
EMBED_FALLBACK_BASE_URL=http://127.0.0.1:11434
EMBED_FALLBACK_API_KEY=
EMBED_FALLBACK_ON_ANY_ERROR=false
NOMIC_TASK_TYPE=search_document
```

Notes:

- Fallback is triggered for rate limits (`429`) and transient network/server failures by default.
- Keep primary and fallback models aligned where possible to reduce embedding-space drift.
- If you materially change model/provider, run `npm run reembed:all`.

## Important quality notes

- Statistical/public-opinion analysis quality depends on what the plan actually documents.
- The assistant is instructed to explicitly state when sample validity details are missing.
- This project performs post-answer citation validation; if validation fails twice, it returns a verified evidence fallback.
- Embeddings are stored as binary float blobs for smaller DB footprint than JSON vectors.
- Re-ingesting unchanged chunks does not rewrite vectors (content-hash dedupe).

## Next recommended improvements

- Add an admin prompt editor backed by DB versioning.
- Add moderation + abuse/rate limiting.
- Add background job ingestion for new county/state documents.
