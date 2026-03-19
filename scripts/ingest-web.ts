import "dotenv/config";
import crypto from "node:crypto";
import { embedText } from "../lib/embeddings";
import { deleteWebChunksByUrl, getWebSourceState, upsertChunk, upsertWebSourceState } from "../lib/vector-store";
import { Chunk } from "../lib/types";

const SOURCES = (process.env.WEB_SOURCES || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

function clean(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, size = 1200): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function hashText(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function run() {
  if (SOURCES.length === 0) {
    throw new Error("Set WEB_SOURCES to comma-separated URLs for county/state docs.");
  }

  let count = 0;

  for (const url of SOURCES) {
    const previous = await getWebSourceState(url);
    const headers: Record<string, string> = {};
    if (previous?.etag) headers["If-None-Match"] = previous.etag;
    if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;

    const res = await fetch(url, { headers });
    const nextEtag = res.headers.get("etag") ?? previous?.etag;
    const nextLastModified = res.headers.get("last-modified") ?? previous?.lastModified;

    if (res.status === 304) {
      await upsertWebSourceState({
        url,
        etag: nextEtag ?? undefined,
        lastModified: nextLastModified ?? undefined,
        contentHash: previous?.contentHash,
        didIndex: false,
      });
      console.log(`Skipped ${url} (not modified: 304)`);
      continue;
    }

    if (!res.ok) {
      console.warn(`Skipped ${url}: ${res.status}`);
      await upsertWebSourceState({
        url,
        etag: nextEtag ?? undefined,
        lastModified: nextLastModified ?? undefined,
        contentHash: previous?.contentHash,
        didIndex: false,
      });
      continue;
    }

    const html = await res.text();
    const text = clean(html);
    const contentHash = hashText(text);

    if (previous?.contentHash && previous.contentHash === contentHash) {
      await upsertWebSourceState({
        url,
        etag: nextEtag ?? undefined,
        lastModified: nextLastModified ?? undefined,
        contentHash,
        didIndex: false,
      });
      console.log(`Skipped ${url} (content unchanged)`);
      continue;
    }

    const removed = await deleteWebChunksByUrl(url);
    if (removed > 0) {
      console.log(`Removed ${removed} existing chunk(s) for ${url}`);
    }

    const bits = chunk(text);

    for (let i = 0; i < bits.length; i += 1) {
      const part = bits[i];
      const id = `web-${Buffer.from(url).toString("base64url")}-${i + 1}`;
      const docTitle = new URL(url).hostname;
      const c: Chunk = {
        id,
        doc_id: `web-${docTitle}`,
        doc_title: docTitle,
        page: 1,
        paragraph: i + 1,
        text: part,
        quote: part.slice(0, 200),
        source_type: "web",
        url,
      };

      const embedding = await embedText(`${url}\n${part}`);
      await upsertChunk(c, embedding);
      count += 1;
    }

    await upsertWebSourceState({
      url,
      etag: nextEtag ?? undefined,
      lastModified: nextLastModified ?? undefined,
      contentHash,
      didIndex: true,
    });

    console.log(`Indexed ${url} (${bits.length} chunks)`);
  }

  console.log(`Done. Indexed ${count} web chunks.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
