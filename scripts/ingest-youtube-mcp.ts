import "dotenv/config";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import { embedText } from "../lib/embeddings";
import { upsertChunk } from "../lib/vector-store";
import { Chunk } from "../lib/types";

type Video = {
  id: string;
  title: string;
  url: string;
  publishedAt?: string;
  description?: string;
  payload?: unknown;
};

const execFileAsync = promisify(execFile);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callToolWithRetry(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  maxAttempts: number
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(client.callTool({ name, arguments: args }), timeoutMs, `Tool ${name}`);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Tool ${name} failed (attempt ${attempt}/${maxAttempts}): ${detail}`);
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`Tool ${name} failed after retries.`);
}

function parseArgs(raw: string) {
  return raw
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeToolContent(content: Array<{ type: string; [key: string]: unknown }>) {
  const collected: unknown[] = [];

  for (const item of content) {
    if (item.type === "text") {
      const text = String(item.text ?? "").trim();
      if (!text) continue;
      try {
        collected.push(JSON.parse(text));
      } catch {
        collected.push(text);
      }
      continue;
    }

    if (item.type === "json" && "json" in item) {
      collected.push(item.json);
      continue;
    }

    if ("data" in item) {
      collected.push(item.data);
    }
  }

  if (collected.length === 1) return collected[0];
  return collected;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["videos", "items", "results", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function inferVideoId(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return id;
      const parts = u.pathname.split("/").filter(Boolean);
      const short = parts[0] === "shorts" ? parts[1] : undefined;
      if (short) return short;
    }
    if (u.hostname.includes("youtu.be")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0]) return parts[0];
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeVideos(raw: unknown): Video[] {
  const rows = readArrayLike(raw);
  const out: Video[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = String(r.url ?? r.link ?? r.videoUrl ?? "").trim();
    const title = String(r.title ?? r.name ?? "").trim();
    const idRaw = String(r.id ?? r.videoId ?? "").trim();
    const id = idRaw || inferVideoId(url);
    if (!id || !url || !title) continue;
    out.push({
      id,
      url,
      title,
      publishedAt: r.publishedAt ? String(r.publishedAt) : r.published ? String(r.published) : undefined,
      description: r.description ? String(r.description) : undefined,
    });
  }

  return out;
}

function deepGetString(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const r = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = r[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(r)) {
    if (value && typeof value === "object") {
      const nested = deepGetString(value, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function parseTranscriptText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;

  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          const ts = o.start ? `[${String(o.start)}] ` : o.timestamp ? `[${String(o.timestamp)}] ` : "";
          const text = o.text ? String(o.text) : o.content ? String(o.content) : "";
          return `${ts}${text}`.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.transcript === "string") return o.transcript;
    if (Array.isArray(o.transcript)) return parseTranscriptText(o.transcript);
    if (Array.isArray(o.segments)) return parseTranscriptText(o.segments);
    if (Array.isArray(o.captions)) return parseTranscriptText(o.captions);
    return JSON.stringify(o);
  }

  return String(raw);
}

async function loadVideoIdsFromFile(filePath: string): Promise<string[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => /^[a-zA-Z0-9_-]{11}$/.test(x));
}

async function loadVideoIds(): Promise<string[]> {
  const fromEnv = (process.env.YOUTUBE_VIDEO_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[a-zA-Z0-9_-]{11}$/.test(x));
  if (fromEnv.length > 0) return fromEnv;

  const file = readString(process.env.YOUTUBE_VIDEO_IDS_FILE).trim();
  if (!file) return [];
  return loadVideoIdsFromFile(file);
}

function splitChunks(text: string, size = 1200, overlap = 200): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + size);
    const chunk = cleaned.slice(i, end).trim();
    if (chunk.length > 120) out.push(chunk);
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return out;
}

function isFromStartYear(publishedAt: string | undefined, startYear: number) {
  if (!publishedAt) return true;
  const year = Number(new Date(publishedAt).getUTCFullYear());
  if (Number.isNaN(year) || year < 1900) return true;
  return year >= startYear;
}

async function downloadAudioForVideo(video: Video, ytdlpPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-audio-${video.id}-`));
  const outTemplate = path.join(dir, `${video.id}.%(ext)s`);
  await execFileAsync(ytdlpPath, [
    "-f",
    "bestaudio",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--output",
    outTemplate,
    video.url,
  ]);

  const files = await fs.readdir(dir);
  const file = files.find((f) => f.startsWith(video.id));
  if (!file) {
    throw new Error(`No downloaded audio file found for ${video.id}`);
  }
  return path.join(dir, file);
}

async function transcribeAudioWithOpenAI(filePath: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for fallback audio transcription.");
  }
  const client = new OpenAI({ apiKey });
  const transcript = await client.audio.transcriptions.create({
    file: fsSync.createReadStream(filePath),
    model,
  });
  return transcript.text?.trim() ?? "";
}

async function run() {
  const command = process.env.YOUTUBE_MCP_COMMAND;
  const args = parseArgs(process.env.YOUTUBE_MCP_ARGS || "");
  const startYear = Number(process.env.YOUTUBE_INGEST_START_YEAR || "2019");
  const queryArg = process.env.YOUTUBE_MCP_SEARCH_QUERY_ARG || "query";
  const channelArg = process.env.YOUTUBE_MCP_SEARCH_CHANNEL_ARG || "channelUrl";
  const transcriptVideoIdArg = process.env.YOUTUBE_MCP_TRANSCRIPT_VIDEO_ID_ARG || "videoId";
  const transcriptUrlArg = process.env.YOUTUBE_MCP_TRANSCRIPT_URL_ARG || "url";
  const timeoutMs = Number(process.env.YOUTUBE_MCP_TIMEOUT_MS || "45000");
  const maxAttempts = Number(process.env.YOUTUBE_MCP_MAX_ATTEMPTS || "2");
  const fallbackTranscribe = process.env.YOUTUBE_FALLBACK_TRANSCRIBE === "true";
  const fallbackModel = process.env.YOUTUBE_FALLBACK_MODEL || "whisper-1";
  const ytdlpPath = process.env.YOUTUBE_YTDLP_PATH || "yt-dlp";
  const reportPath = process.env.YOUTUBE_INGEST_REPORT_PATH || "./data/youtube-ingest-report.json";

  if (!command) {
    throw new Error("Set YOUTUBE_MCP_COMMAND in .env (and optionally YOUTUBE_MCP_ARGS). Run npm run mcp:tools first.");
  }

  console.log(`Starting YouTube MCP ingest (start year: ${startYear})...`);
  console.log(`Launching MCP server: ${command} ${args.join(" ")}`.trim());
  const transport = new StdioClientTransport({ command, args, stderr: "pipe" });
  const client = new Client({ name: "fh-plan-youtube-ingest", version: "0.1.0" }, { capabilities: {} });
  await withTimeout(client.connect(transport), timeoutMs, "MCP connect");
  console.log("Connected to MCP server.");

  const tools = await withTimeout(client.listTools(), timeoutMs, "listTools");
  const names = tools.tools.map((t) => t.name);
  console.log(`Discovered tools: ${names.join(", ")}`);
  const directVideoTool =
    process.env.YOUTUBE_MCP_VIDEO_INFO_TOOL ||
    names.find((n) => /get.*video.*info|video.*info/i.test(n));
  const searchTool =
    process.env.YOUTUBE_MCP_SEARCH_TOOL ||
    names.find((n) => /search.*(youtube|video)|find.*video|list.*video/i.test(n));
  const transcriptTool =
    process.env.YOUTUBE_MCP_TRANSCRIPT_TOOL ||
    names.find((n) => /(transcript|caption|subtitle)/i.test(n));

  const videoIds = await loadVideoIds();
  const useVideoIdsMode = videoIds.length > 0 && !!directVideoTool;
  if (videoIds.length > 0) {
    console.log(`Loaded ${videoIds.length} input video IDs from env/file.`);
  }

  if (!useVideoIdsMode && (!searchTool || !transcriptTool)) {
    throw new Error(
      `Could not infer tools. Either set YOUTUBE_MCP_SEARCH_TOOL + YOUTUBE_MCP_TRANSCRIPT_TOOL, or provide YOUTUBE_VIDEO_IDS/YOUTUBE_VIDEO_IDS_FILE plus YOUTUBE_MCP_VIDEO_INFO_TOOL. Available tools: ${names.join(
        ", "
      )}`
    );
  }

  const queries = (process.env.YOUTUBE_MCP_QUERIES || "Fruit Heights City Council,Fruit Heights Planning Commission")
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);
  const channelUrl = process.env.YOUTUBE_CHANNEL_URL || "https://www.youtube.com/@fruitheightscity9716";

  const found = new Map<string, Video>();
  if (useVideoIdsMode && directVideoTool) {
    console.log(`Using video-ID mode with tool: ${directVideoTool}`);
    for (const id of videoIds) {
      console.log(`Fetching video info for ${id}...`);
      const res = await callToolWithRetry(client, directVideoTool, { video_id: id }, timeoutMs, maxAttempts);
      const payload = normalizeToolContent(res.content as Array<{ type: string; [key: string]: unknown }>);
      const title = deepGetString(payload, ["title", "name"]);
      const url = deepGetString(payload, ["url", "link", "videoUrl"]);
      const publishedAt = deepGetString(payload, ["publishedAt", "publishDate", "published"]);
      const video: Video = {
        id,
        title: title || `YouTube Video ${id}`,
        url: url || `https://www.youtube.com/watch?v=${id}`,
        publishedAt: publishedAt || undefined,
        payload,
      };
      if (isFromStartYear(video.publishedAt, startYear)) {
        found.set(video.id, video);
      }
    }
    console.log(`Loaded ${found.size} videos from supplied ID list.`);
  } else {
    for (const q of queries) {
      const argsObj: Record<string, unknown> = { [queryArg]: q };
      if (channelUrl) argsObj[channelArg] = channelUrl;

      const searchRes = await client.callTool({ name: searchTool!, arguments: argsObj });
      const normalized = normalizeVideos(
        normalizeToolContent(searchRes.content as Array<{ type: string; [key: string]: unknown }>)
      );

      for (const video of normalized) {
        if (isFromStartYear(video.publishedAt, startYear)) {
          found.set(video.id, video);
        }
      }

      console.log(`Search "${q}" found ${normalized.length} videos (${found.size} unique kept so far).`);
    }
  }

  let indexedChunks = 0;
  let indexedVideos = 0;
  const report: Array<{ id: string; title: string; status: "indexed" | "skipped" | "failed"; reason?: string; chunks?: number }> = [];

  for (const video of found.values()) {
    console.log(`Fetching transcript for ${video.id} (${video.title})...`);
    let transcript = "";
    try {
      if (useVideoIdsMode && directVideoTool) {
        const payload =
          video.payload ??
          normalizeToolContent(
            (
              await callToolWithRetry(client, directVideoTool, { video_id: video.id }, timeoutMs, maxAttempts)
            ).content as Array<{ type: string; [key: string]: unknown }>
          );
        transcript = parseTranscriptText(payload);
        if (!transcript.trim()) {
          transcript =
            deepGetString(payload, ["transcript", "captionsText", "captionText"]) ||
            deepGetString(payload, ["description"]);
        }
      } else {
        const tArgs: Record<string, unknown> = {
          [transcriptVideoIdArg]: video.id,
          [transcriptUrlArg]: video.url,
        };
        const transcriptRes = await callToolWithRetry(client, transcriptTool!, tArgs, timeoutMs, maxAttempts);
        transcript = parseTranscriptText(
          normalizeToolContent(transcriptRes.content as Array<{ type: string; [key: string]: unknown }>)
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped ${video.id} due to transcript fetch error: ${detail}`);
      report.push({ id: video.id, title: video.title, status: "failed", reason: `mcp_error: ${detail}` });
      continue;
    }

    if (!transcript.trim() && fallbackTranscribe) {
      try {
        console.log(`No transcript from MCP for ${video.id}. Falling back to audio transcription...`);
        const audioPath = await downloadAudioForVideo(video, ytdlpPath);
        transcript = await transcribeAudioWithOpenAI(audioPath, fallbackModel);
        await fs.rm(path.dirname(audioPath), { recursive: true, force: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Fallback transcription failed for ${video.id}: ${detail}`);
        report.push({ id: video.id, title: video.title, status: "failed", reason: `fallback_error: ${detail}` });
        continue;
      }
    }

    const chunks = splitChunks(transcript);
    if (chunks.length === 0) {
      console.log(`Skipped ${video.url} (no transcript text)`);
      report.push({ id: video.id, title: video.title, status: "skipped", reason: "no_transcript_text" });
      continue;
    }

    for (let i = 0; i < chunks.length; i += 1) {
      const text = `Video: ${video.title}\nPublished: ${video.publishedAt ?? "unknown"}\nURL: ${video.url}\n\n${chunks[i]}`;
      const chunk: Chunk = {
        id: `yt-${video.id}-c${i + 1}`,
        doc_id: `youtube-fruit-heights-${video.id}`,
        doc_title: `Fruit Heights YouTube Meeting: ${video.title}`,
        page: 1,
        paragraph: i + 1,
        text,
        quote: text.slice(0, 220),
        source_type: "web",
        url: video.url,
      };
      const embedding = await embedText(text);
      await upsertChunk(chunk, embedding);
      indexedChunks += 1;
    }

    indexedVideos += 1;
    report.push({ id: video.id, title: video.title, status: "indexed", chunks: chunks.length });
    console.log(`Indexed ${video.title} (${chunks.length} chunks)`);
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalCandidates: found.size,
        indexedVideos,
        indexedChunks,
        fallbackTranscribe,
        entries: report,
      },
      null,
      2
    )
  );

  console.log(`Done. Indexed ${indexedVideos} videos and ${indexedChunks} chunks from YouTube MCP.`);
  console.log(`Report written to ${reportPath}`);
  await transport.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
