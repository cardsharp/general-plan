import OpenAI from "openai";

let lastGoogleEmbedAt = 0;
let loggedConfig = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(raw: string) {
  try {
    const data = JSON.parse(raw) as {
      error?: {
        details?: Array<{ ["@type"]?: string; retryDelay?: string }>;
      };
    };
    const details = data.error?.details ?? [];
    const retry = details.find((d) => typeof d.retryDelay === "string")?.retryDelay;
    if (!retry) return null;
    const m = retry.match(/^(\d+)s$/);
    if (!m) return null;
    return Number(m[1]) * 1000;
  } catch {
    return null;
  }
}

type EmbedProvider = "ollama" | "openai" | "google" | "openai_compatible" | "nomic";

type EmbedTarget = {
  provider: EmbedProvider;
  model?: string;
  baseURL?: string;
  apiKey?: string;
};

const EMBED_DEBUG = process.env.EMBED_DEBUG === "true";

function looksFallbackEligible(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /(429|rate.?limit|quota|resource_exhausted|fetch failed|econnreset|timed? ?out|etimedout|eai_again|enotfound|502|503|504)/i.test(
    detail
  );
}

function normalizeNomicTextEndpoint(base?: string) {
  const b = normalizeBase(base || "https://api-atlas.nomic.ai/v1/embedding/text");
  if (/\/v1\/embedding\/text$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return `${b}/embedding/text`;
  return `${b}/v1/embedding/text`;
}

function normalizeBase(base?: string) {
  return (base || "").trim().replace(/\/+$/, "");
}

function normalizeOllamaBase(base?: string) {
  const trimmed = normalizeBase(base);
  return trimmed.replace(/\/api$/i, "");
}

function readTarget(prefix: "EMBED_PRIMARY" | "EMBED_FALLBACK"): EmbedTarget | null {
  const provider = process.env[`${prefix}_PROVIDER`]?.trim() as EmbedProvider | undefined;
  if (!provider) return null;

  return {
    provider,
    model: process.env[`${prefix}_MODEL`]?.trim() || undefined,
    baseURL: process.env[`${prefix}_BASE_URL`]?.trim() || undefined,
    apiKey: process.env[`${prefix}_API_KEY`]?.trim() || undefined,
  };
}

function readLegacyPrimary(): EmbedTarget {
  const provider = (process.env.EMBED_PROVIDER || "google").trim() as EmbedProvider;
  if (provider === "nomic") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "nomic-embed-text-v1.5",
      baseURL: process.env.EMBED_BASE_URL || "https://api-atlas.nomic.ai/v1/embedding/text",
      apiKey: process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      model: process.env.OLLAMA_EMBED_MODEL || process.env.EMBED_MODEL || "nomic-embed-text",
      baseURL: process.env.OLLAMA_BASE_URL || process.env.EMBED_BASE_URL || "http://127.0.0.1:11434",
      apiKey: process.env.OLLAMA_API_KEY || process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "openai_compatible") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "nomic-embed-text-v1.5",
      baseURL: process.env.EMBED_BASE_URL || undefined,
      apiKey: process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "openai") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "text-embedding-3-large",
      baseURL: process.env.OPENAI_BASE_URL || process.env.EMBED_BASE_URL || undefined,
      apiKey: process.env.OPENAI_API_KEY || undefined,
    };
  }

  return {
    provider: "google",
    model: process.env.EMBED_MODEL || "text-embedding-004",
    apiKey: process.env.GOOGLE_API_KEY || undefined,
  };
}

function readLegacyFallback(): EmbedTarget | null {
  const provider = process.env.EMBED_FALLBACK_PROVIDER?.trim() as EmbedProvider | undefined;
  if (!provider) return null;

  if (provider === "nomic") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "nomic-embed-text-v1.5",
      baseURL: process.env.EMBED_BASE_URL || "https://api-atlas.nomic.ai/v1/embedding/text",
      apiKey: process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      model: process.env.OLLAMA_EMBED_MODEL || process.env.EMBED_MODEL || "nomic-embed-text",
      baseURL: process.env.OLLAMA_BASE_URL || process.env.EMBED_BASE_URL || "http://127.0.0.1:11434",
      apiKey: process.env.OLLAMA_API_KEY || process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "openai_compatible") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "nomic-embed-text-v1.5",
      baseURL: process.env.EMBED_BASE_URL || undefined,
      apiKey: process.env.EMBED_API_KEY || undefined,
    };
  }

  if (provider === "openai") {
    return {
      provider,
      model: process.env.EMBED_MODEL || "text-embedding-3-large",
      baseURL: process.env.OPENAI_BASE_URL || process.env.EMBED_BASE_URL || undefined,
      apiKey: process.env.OPENAI_API_KEY || undefined,
    };
  }

  return {
    provider: "google",
    model: process.env.EMBED_MODEL || "text-embedding-004",
    apiKey: process.env.GOOGLE_API_KEY || undefined,
  };
}

function getEmbeddingTargets() {
  const primary = readTarget("EMBED_PRIMARY") || readLegacyPrimary();
  const fallback = readTarget("EMBED_FALLBACK") || readLegacyFallback();
  return { primary, fallback };
}

async function embedWithOllama(input: string, target: EmbedTarget): Promise<number[]> {
  const base = normalizeOllamaBase(target.baseURL || "http://127.0.0.1:11434");
  const model = target.model || "nomic-embed-text";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;

  const candidates = [
    {
      url: `${base}/api/embed`,
      body: { model, input },
    },
    {
      url: `${base}/api/embeddings`,
      body: { model, prompt: input },
    },
  ];

  let lastError = "";
  for (const candidate of candidates) {
    const res = await fetch(candidate.url, {
      method: "POST",
      headers,
      body: JSON.stringify(candidate.body),
    });

    if (!res.ok) {
      const detail = await res.text();
      lastError = `${res.status} ${detail}`;
      if (res.status === 404) continue;
      throw new Error(`Ollama embeddings request failed: ${lastError}`);
    }

    const data = (await res.json()) as {
      embedding?: number[];
      embeddings?: number[][];
    };
    const vector = data.embedding ?? data.embeddings?.[0];
    if (!vector || vector.length === 0) {
      throw new Error("Ollama embeddings response missing vector values");
    }
    return vector;
  }

  throw new Error(`Ollama embeddings request failed: ${lastError || "No compatible endpoint found"}`);
}

async function embedWithOpenAI(input: string, target: EmbedTarget): Promise<number[]> {
  if (!target.apiKey) {
    throw new Error("Missing API key for OpenAI-compatible embeddings");
  }

  const client = new OpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseURL || undefined,
  });
  const model = target.model || "text-embedding-3-large";
  const res = await client.embeddings.create({ model, input });
  return res.data[0].embedding;
}

async function embedWithGoogle(input: string, target: EmbedTarget): Promise<number[]> {
  const key = target.apiKey || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error("Missing GOOGLE_API_KEY (or EMBED_PRIMARY_API_KEY/EMBED_FALLBACK_API_KEY) for embeddings");
  }

  const model = target.model || "text-embedding-004";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:embedContent?key=${encodeURIComponent(key)}`;
  const minIntervalMs = Number(process.env.GOOGLE_EMBED_MIN_INTERVAL_MS || "700");
  const maxAttempts = Number(process.env.GOOGLE_EMBED_MAX_ATTEMPTS || "6");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const now = Date.now();
    const waitForInterval = Math.max(0, minIntervalMs - (now - lastGoogleEmbedAt));
    if (waitForInterval > 0) {
      await sleep(waitForInterval);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: input }] },
          taskType: "RETRIEVAL_DOCUMENT",
        }),
      });
      lastGoogleEmbedAt = Date.now();
    } catch (error) {
      if (attempt < maxAttempts) {
        const backoff = Math.min(60_000, 2_000 * attempt);
        const detail = error instanceof Error ? error.message : "Unknown network error";
        console.warn(
          `Embedding network error (${detail}). Waiting ${Math.ceil(backoff / 1000)}s before retry ${
            attempt + 1
          }/${maxAttempts}.`
        );
        await sleep(backoff);
        continue;
      }
      throw error;
    }

    if (res.ok) {
      const data = (await res.json()) as { embedding?: { values?: number[] } };
      const values = data.embedding?.values;
      if (!values || values.length === 0) {
        throw new Error("Google embeddings response missing vector values");
      }
      return values;
    }

    const detail = await res.text();
    if (res.status === 429 && attempt < maxAttempts) {
      const retryDelay = parseRetryDelayMs(detail);
      const backoff = Math.min(60_000, 2_000 * attempt);
      const waitMs = Math.max(retryDelay ?? 0, backoff);
      console.warn(`Embedding rate-limited. Waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt + 1}/${maxAttempts}.`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Google embeddings request failed: ${res.status} ${detail}`);
  }

  throw new Error("Google embeddings request failed after retries.");
}

async function embedWithNomic(input: string, target: EmbedTarget): Promise<number[]> {
  const apiKey = target.apiKey;
  if (!apiKey) {
    throw new Error("Missing API key for Nomic embeddings");
  }

  const endpoint = normalizeNomicTextEndpoint(target.baseURL);
  const model = target.model || "nomic-embed-text-v1.5";
  const taskType = process.env.NOMIC_TASK_TYPE || "search_document";
  const dimensionalityRaw = process.env.NOMIC_DIMENSIONALITY || "";
  const dimensionality = dimensionalityRaw ? Number(dimensionalityRaw) : undefined;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      texts: [input],
      task_type: taskType,
      ...(Number.isFinite(dimensionality) ? { dimensionality } : {}),
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Nomic embeddings request failed: ${res.status} ${raw}`);
  }

  const data = JSON.parse(raw) as { embeddings?: number[][] };
  const vector = data.embeddings?.[0];
  if (!vector || vector.length === 0) {
    throw new Error("Nomic embeddings response missing vector values");
  }
  return vector;
}

async function embedWithTarget(input: string, target: EmbedTarget): Promise<number[]> {
  if (target.provider === "nomic") return embedWithNomic(input, target);
  if (target.provider === "ollama") return embedWithOllama(input, target);
  if (target.provider === "openai") return embedWithOpenAI(input, target);
  if (target.provider === "openai_compatible") {
    if (!target.baseURL) throw new Error("Missing base URL for openai_compatible embedding target");
    return embedWithOpenAI(input, target);
  }
  return embedWithGoogle(input, target);
}

function targetDebugString(label: string, target: EmbedTarget | null) {
  if (!target) return `[embed] ${label}=none`;
  const base = target.baseURL ? ` base=${target.baseURL}` : "";
  const model = target.model ? ` model=${target.model}` : "";
  return `[embed] ${label}=${target.provider}${base}${model}`;
}

export async function embedText(input: string): Promise<number[]> {
  const { primary, fallback } = getEmbeddingTargets();
  const fallbackOnAnyError = process.env.EMBED_FALLBACK_ON_ANY_ERROR === "true";
  const startedAt = Date.now();

  if (!loggedConfig && EMBED_DEBUG) {
    loggedConfig = true;
    console.log(targetDebugString("primary", primary));
    console.log(targetDebugString("fallback", fallback));
  }

  try {
    const vector = await embedWithTarget(input, primary);
    if (EMBED_DEBUG) {
      console.log(`[embed] provider=${primary.provider} ok ms=${Date.now() - startedAt}`);
    }
    return vector;
  } catch (error) {
    if (!fallback || fallback.provider === primary.provider && normalizeBase(fallback.baseURL) === normalizeBase(primary.baseURL) && (fallback.model || "") === (primary.model || "")) {
      throw error;
    }
    if (!fallbackOnAnyError && !looksFallbackEligible(error)) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Primary embedding target failed: ${detail}`);
    console.warn(`Falling back to embedding target: ${fallback.provider}${fallback.baseURL ? ` (${fallback.baseURL})` : ""}`);

    const vector = await embedWithTarget(input, fallback);
    if (EMBED_DEBUG) {
      console.log(`[embed] provider=${fallback.provider} ok ms=${Date.now() - startedAt}`);
    }
    return vector;
  }
}
