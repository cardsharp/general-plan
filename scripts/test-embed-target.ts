import "dotenv/config";

function mask(key: string) {
  if (!key) return "(empty)";
  if (key.length <= 8) return `${"*".repeat(Math.max(0, key.length - 2))}${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function trimSlash(v: string) {
  return v.replace(/\/+$/, "");
}

async function probe(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const body = text.length > 240 ? `${text.slice(0, 240)}...` : text;
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

async function run() {
  const baseRaw = process.env.EMBED_PRIMARY_BASE_URL || process.env.OLLAMA_BASE_URL || "";
  const base = trimSlash(baseRaw).replace(/\/api$/i, "");
  const key = process.env.EMBED_PRIMARY_API_KEY || process.env.OLLAMA_API_KEY || "";
  const model = process.env.EMBED_PRIMARY_MODEL || process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

  if (!baseRaw) {
    throw new Error("Missing EMBED_PRIMARY_BASE_URL (or OLLAMA_BASE_URL).");
  }

  console.log(`Base: ${baseRaw}`);
  console.log(`Normalized base: ${base}`);
  console.log(`Model: ${model}`);
  console.log(`Key len: ${key.length}`);
  console.log(`Key mask: ${mask(key)}`);

  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  const checks = [
    { name: "GET /api/version", url: `${base}/api/version`, init: { method: "GET", headers } },
    { name: "GET /api/tags", url: `${base}/api/tags`, init: { method: "GET", headers } },
    {
      name: "POST /api/embed",
      url: `${base}/api/embed`,
      init: {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: "Auth test embedding input." }),
      },
    },
    {
      name: "POST /api/embeddings",
      url: `${base}/api/embeddings`,
      init: {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "Auth test embedding input." }),
      },
    },
  ];

  for (const c of checks) {
    const r = await probe(c.url, c.init);
    console.log(`\n${c.name}`);
    console.log(`status=${r.status} ok=${r.ok}`);
    console.log(`body=${r.body}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
