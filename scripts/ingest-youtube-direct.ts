import "dotenv/config";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";
import { embedText } from "../lib/embeddings";
import { hasIndexedChunksForDoc, isChunkCurrent, upsertChunk, upsertChunkWithoutEmbedding } from "../lib/vector-store";
import { Chunk } from "../lib/types";

const execFileAsync = promisify(execFile);

type Video = {
  id: string;
  title: string;
  url: string;
  uploadDate?: string;
};

function splitChunks(text: string, size: number, overlap: number, minChunkChars: number): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + size);
    const chunk = cleaned.slice(i, end).trim();
    if (chunk.length >= minChunkChars) out.push(chunk);
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return out;
}

function parseYear(uploadDate?: string) {
  if (!uploadDate || uploadDate.length < 4) return undefined;
  const n = Number(uploadDate.slice(0, 4));
  return Number.isFinite(n) ? n : undefined;
}

function cleanVtt(text: string) {
  return text
    .replace(/^WEBVTT\s*$/gim, "")
    .replace(/^\d+\s*$/gim, "")
    .replace(/\d{2}:\d{2}:\d{2}[\.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[\.,]\d{3}.*/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runYtDlp(args: string[], ytdlpPath: string) {
  const timeoutMs = Number(process.env.YOUTUBE_YTDLP_TIMEOUT_MS || "120000");
  const retries = String(Number(process.env.YOUTUBE_YTDLP_RETRIES || "1"));
  const socketTimeout = String(Number(process.env.YOUTUBE_YTDLP_SOCKET_TIMEOUT_SEC || "20"));
  return execFileAsync(
    ytdlpPath,
    ["--retries", retries, "--socket-timeout", socketTimeout, ...args],
    { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs }
  );
}

async function listFromTab(tabUrl: string, ytdlpPath: string): Promise<Video[]> {
  const { stdout } = await runYtDlp(
    ["--flat-playlist", "--print", "%(_type)s\t%(id)s\t%(title)s\t%(upload_date)s", tabUrl],
    ytdlpPath
  );

  const out: Video[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const id = parts[1]?.trim();
    const title = parts[2]?.trim() || "YouTube video";
    const uploadDate = parts[3]?.trim() || undefined;
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) continue;
    out.push({ id, title, uploadDate, url: `https://www.youtube.com/watch?v=${id}` });
  }
  return out;
}

async function downloadCaptions(video: Video, ytdlpPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-cap-${video.id}-`));
  const output = path.join(dir, `${video.id}.%(ext)s`);

  try {
    await runYtDlp(
      [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*,en",
        "--sub-format",
        "vtt",
        "-o",
        output,
        video.url,
      ],
      ytdlpPath
    );

    const files = await fs.readdir(dir);
    const vtt = files.filter((f) => f.endsWith(".vtt"));
    if (vtt.length === 0) return "";

    const merged: string[] = [];
    for (const file of vtt) {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const cleaned = cleanVtt(text);
      if (cleaned) merged.push(cleaned);
    }

    return merged.join("\n").trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadAudio(video: Video, ytdlpPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-audio-${video.id}-`));
  const output = path.join(dir, `${video.id}.%(ext)s`);
  await runYtDlp(["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3", "-o", output, video.url], ytdlpPath);
  const files = await fs.readdir(dir);
  const pick = files.find((f) => f.startsWith(video.id));
  if (!pick) throw new Error(`Audio download failed for ${video.id}`);
  return path.join(dir, pick);
}

async function transcribeWithOpenAI(filePath: string, model: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY required for fallback audio transcription");
  const client = new OpenAI({ apiKey: key });
  const result = await client.audio.transcriptions.create({
    file: fsSync.createReadStream(filePath),
    model,
  });
  return result.text?.trim() ?? "";
}

async function run() {
  const channelUrl = process.env.YOUTUBE_CHANNEL_URL || "https://www.youtube.com/@fruitheightscity9716";
  const startYear = Number(process.env.YOUTUBE_INGEST_START_YEAR || "2019");
  const ytdlpPath = process.env.YOUTUBE_YTDLP_PATH || "yt-dlp";
  const fallbackTranscribe = process.env.YOUTUBE_FALLBACK_TRANSCRIBE === "true";
  const fallbackModel = process.env.YOUTUBE_FALLBACK_MODEL || "whisper-1";
  const reportPath = process.env.YOUTUBE_INGEST_REPORT_PATH || "./data/youtube-ingest-report.json";
  const resumeEnabled = process.env.YOUTUBE_RESUME !== "false";
  const deferEmbed = process.env.YOUTUBE_DEFER_EMBED === "true";
  const chunkSize = Number(process.env.YOUTUBE_CHUNK_SIZE || "2400");
  const chunkOverlap = Number(process.env.YOUTUBE_CHUNK_OVERLAP || "120");
  const minChunkChars = Number(process.env.YOUTUBE_MIN_CHUNK_CHARS || "240");
  const skipIds = new Set(
    (process.env.YOUTUBE_SKIP_VIDEO_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^[a-zA-Z0-9_-]{11}$/.test(x))
  );

  console.log(`Starting direct YouTube ingest for ${channelUrl} (from ${startYear})`);
  console.log(`Ingest mode: ${deferEmbed ? "defer-embedding (fast import)" : "embed-during-import"}`);

  const tabs = [`${channelUrl}/videos`, `${channelUrl}/streams`];
  const map = new Map<string, Video>();

  for (const tab of tabs) {
    try {
      const rows = await listFromTab(tab, ytdlpPath);
      for (const v of rows) {
        const year = parseYear(v.uploadDate);
        if (year && year < startYear) continue;
        map.set(v.id, v);
      }
      console.log(`Listed ${rows.length} entries from ${tab}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Failed listing ${tab}: ${detail}`);
    }
  }

  const videos = Array.from(map.values());
  console.log(`Candidate videos: ${videos.length}`);

  const resumeIndexed = new Set<string>();
  let previousEntries: Array<{ id: string; title: string; status: "indexed" | "skipped" | "failed"; reason?: string; chunks?: number }> = [];
  if (resumeEnabled) {
    try {
      const previous = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
        entries?: Array<{ id?: string; title?: string; status?: string; reason?: string; chunks?: number }>;
      };
      previousEntries = (previous.entries ?? [])
        .filter((e): e is { id: string; title: string; status: "indexed" | "skipped" | "failed"; reason?: string; chunks?: number } =>
          typeof e.id === "string" && typeof e.title === "string" && (e.status === "indexed" || e.status === "skipped" || e.status === "failed")
        );
      for (const e of previous.entries ?? []) {
        if (e.id && e.status === "indexed") resumeIndexed.add(e.id);
      }
      if (resumeIndexed.size > 0) {
        console.log(`Resume enabled: ${resumeIndexed.size} previously indexed videos will be skipped.`);
      }
    } catch {
      // no previous report; continue
    }
  }

  let indexedVideos = 0;
  let indexedChunks = 0;
  const report: Array<{ id: string; title: string; status: "indexed" | "skipped" | "failed"; reason?: string; chunks?: number }> = [];

  for (const video of videos) {
    const docId = `youtube-fruit-heights-${video.id}`;
    if (resumeEnabled && (resumeIndexed.has(video.id) || (await hasIndexedChunksForDoc(docId)))) {
      console.log(`Skipping ${video.id}; already indexed.`);
      report.push({ id: video.id, title: video.title, status: "indexed", reason: "resume_already_indexed" });
      continue;
    }

    if (skipIds.has(video.id)) {
      console.log(`Skipping ${video.id} by config.`);
      report.push({ id: video.id, title: video.title, status: "skipped", reason: "configured_skip" });
      continue;
    }
    console.log(`Processing ${video.id} (${video.title})...`);
    let transcript = "";

    try {
      console.log(`Downloading captions for ${video.id}...`);
      transcript = await downloadCaptions(video, ytdlpPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Caption fetch failed for ${video.id}: ${detail}`);
    }

    if (!transcript && fallbackTranscribe) {
      try {
        console.log(`No captions for ${video.id}, using audio transcription fallback...`);
        const audioPath = await downloadAudio(video, ytdlpPath);
        transcript = await transcribeWithOpenAI(audioPath, fallbackModel);
        await fs.rm(path.dirname(audioPath), { recursive: true, force: true }).catch(() => undefined);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        report.push({ id: video.id, title: video.title, status: "failed", reason: `fallback_error: ${detail}` });
        continue;
      }
    }

    const chunks = splitChunks(transcript, chunkSize, chunkOverlap, minChunkChars);
    if (chunks.length === 0) {
      report.push({ id: video.id, title: video.title, status: "skipped", reason: "no_transcript_text" });
      continue;
    }

    for (let i = 0; i < chunks.length; i += 1) {
      const text = `Video: ${video.title}\nUpload Date: ${video.uploadDate ?? "unknown"}\nURL: ${video.url}\n\n${chunks[i]}`;
      const chunk: Chunk = {
        id: `yt-${video.id}-c${i + 1}`,
        doc_id: docId,
        doc_title: `Fruit Heights YouTube Meeting: ${video.title}`,
        page: 1,
        paragraph: i + 1,
        text,
        quote: text.slice(0, 220),
        source_type: "web",
        url: video.url,
      };
      if (await isChunkCurrent({ id: chunk.id, text: chunk.text })) {
        continue;
      }
      if (deferEmbed) {
        await upsertChunkWithoutEmbedding(chunk);
        indexedChunks += 1;
      } else {
        const embedding = await embedText(text);
        await upsertChunk(chunk, embedding);
        indexedChunks += 1;
      }
    }

    indexedVideos += 1;
    report.push({ id: video.id, title: video.title, status: "indexed", chunks: chunks.length });
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: "direct",
        channelUrl,
        startYear,
        fallbackTranscribe,
        indexedVideos,
        indexedChunks,
        totalCandidates: videos.length,
        entries: (() => {
          const merged = new Map<string, { id: string; title: string; status: "indexed" | "skipped" | "failed"; reason?: string; chunks?: number }>();
          for (const e of previousEntries) merged.set(e.id, e);
          for (const e of report) {
            const prev = merged.get(e.id);
            if (!prev) {
              merged.set(e.id, e);
              continue;
            }
            if (e.status === "indexed" || prev.status !== "indexed") {
              merged.set(e.id, e);
            }
          }
          return Array.from(merged.values());
        })(),
      },
      null,
      2
    )
  );

  console.log(`Done. Indexed ${indexedVideos} videos and ${indexedChunks} chunks.`);
  console.log(`Report: ${reportPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
