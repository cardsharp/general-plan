"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "@/lib/config";

type Citation = {
  id: string;
  label: string;
  quote: string;
  url: string | null;
};

type Turn = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  theme?: string;
  nextOptions?: string[];
};

function stripCitationArtifacts(text: string) {
  const noInlineCitations = text.replace(/\[(?:p|page)\s*[x]+\s*(?:¶|para(?:graph)?)\s*[y]+\]/gi, "");

  const sourcesStart = noInlineCitations.search(
    /(^|\n)\s*(?:\*\*)?\s*sources\s*:?\s*(?:\*\*)?\s*(\n|$)/i
  );
  const trimmed = sourcesStart >= 0 ? noInlineCitations.slice(0, sourcesStart) : noInlineCitations;
  return trimmed.trim();
}

function citationKey(page: string, paragraph: string) {
  return `p${page}-q${paragraph}`.toLowerCase();
}

function parseCitationKeyFromLabel(label: string) {
  const m = label.match(/\[p\s*(\d+)\s*¶\s*(\d+)\]/i);
  if (!m) return null;
  return citationKey(m[1], m[2]);
}

function SourceIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 6.5H6a3.5 3.5 0 0 0 0 7h2.5" />
      <path d="M12 13.5h2a3.5 3.5 0 0 0 0-7h-2.5" />
      <path d="M7.5 10h5" />
    </svg>
  );
}

function renderInlineMarkdown(
  input: string,
  citations: Citation[] | undefined,
  onOpenSources: (items: Citation[]) => void
) {
  const nodes: Array<string | ReactNode> = [];
  const citationsByKey = new Map<string, Citation[]>();
  for (const c of citations ?? []) {
    const key = parseCitationKeyFromLabel(c.label);
    if (!key) continue;
    const list = citationsByKey.get(key) ?? [];
    list.push(c);
    citationsByKey.set(key, list);
  }

  const pattern =
    /(\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|(\[(?:(?:[A-Za-z]+\s+)?(?:p|page)\s*\.?\s*\d+\s*(?:¶|para(?:graph)?)\s*\.?\s*\d+\s*(?:,\s*)?)+\]))/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > last) nodes.push(input.slice(last, match.index));
    if (match[2]) {
      nodes.push(
        <a key={`md-${key++}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline">
          {match[1].slice(1, match[1].indexOf("]"))}
        </a>
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={`md-${key++}`} className="font-semibold">
          {match[3]}
        </strong>
      );
    } else if (match[4]) {
      const citationText = match[4];
      const pairs = Array.from(citationText.matchAll(/(?:p|page)\s*\.?\s*(\d+)\s*(?:¶|para(?:graph)?)\s*\.?\s*(\d+)/gi));
      const matchedById = new Map<string, Citation>();

      for (const pair of pairs) {
        const page = pair[1];
        const paragraph = pair[2];
        if (!page || !paragraph) continue;
        const found = citationsByKey.get(citationKey(page, paragraph)) ?? [];
        for (const c of found) matchedById.set(c.id, c);
      }

      const matched = matchedById.size > 0 ? Array.from(matchedById.values()) : citations ?? [];
      nodes.push(
        <button
          key={`cite-${key++}`}
          type="button"
          onClick={() => onOpenSources(matched)}
          className="mx-1 inline-flex items-center text-[#4e525a] hover:text-[#1f2125]"
          aria-label="Open sources"
        >
          <SourceIcon />
        </button>
      );
    }
    last = pattern.lastIndex;
  }

  if (last < input.length) nodes.push(input.slice(last));
  return nodes;
}

function renderMarkdownBlocks(text: string, citations: Citation[] | undefined, onOpenSources: (items: Citation[]) => void) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push(
        <ul key={`blk-${key++}`} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item, citations, onOpenSources)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push(
        <ol key={`blk-${key++}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item, citations, onOpenSources)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const heading = line.replace(/^#{1,3}\s+/, "");
      out.push(
        <h3 key={`blk-${key++}`} className="font-semibold">
          {renderInlineMarkdown(heading, citations, onOpenSources)}
        </h3>
      );
      i += 1;
      continue;
    }

    out.push(
      <p key={`blk-${key++}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(line, citations, onOpenSources)}
      </p>
    );
    i += 1;
  }

  return out;
}

export function ChatShell() {
  const thinkingPhrases = useMemo(
    () => [
      "Thinking...",
      "Pondering the policy puzzle...",
      "Connecting planning dots...",
      "Consulting the digital filing cabinet...",
      "Cross-checking the fine print...",
      "Parsing civic tea leaves...",
      "Running the zoning brain gears...",
      "Looking for the exact page and line...",
      "Gathering receipts (with citations)...",
      "Translating planner-speak to human-speak...",
    ],
    []
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [thinkingText, setThinkingText] = useState(thinkingPhrases[0]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sourcePanel, setSourcePanel] = useState<{ citations: Citation[] } | null>(null);
  const starters = useMemo(() => APP_CONFIG.starters, []);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  function openSources(citations: Citation[]) {
    setSourcePanel({ citations: citations.length ? citations : [] });
  }

  const started = turns.length > 0;

  useEffect(() => {
    if (!started) return;
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, started]);

  useEffect(() => {
    if (!loading) {
      setThinkingText(thinkingPhrases[0]);
      return;
    }

    const id = window.setInterval(() => {
      setThinkingText((prev) => {
        const options = thinkingPhrases.filter((p) => p !== prev);
        return options[Math.floor(Math.random() * options.length)] ?? thinkingPhrases[0];
      });
    }, 1500);

    return () => window.clearInterval(id);
  }, [loading, thinkingPhrases]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setTurns((old) => [...old, { role: "user", text: question }]);
    setLoading(true);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat request failed");

      setTurns((old) => [
        ...old,
        {
          role: "assistant",
          text: data.answer,
          citations: data.citations,
          theme: data.theme,
          nextOptions: Array.isArray(data.nextOptions) ? data.nextOptions : [],
        },
      ]);
    } catch (error) {
      setTurns((old) => [
        ...old,
        {
          role: "assistant",
          text: `I hit an error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await ask(input);
  }

  if (!started) {
    return (
      <section className="flex min-h-screen flex-col items-center justify-center pb-24 pt-14">
        <div className="w-full max-w-3xl">
          <h1 className="text-3xl text-[#970747] sm:text-4xl" style={{ fontFamily: "Lora, serif" }}>
            Chat with the Fruit Heights City Plan
          </h1>
          <p className="mt-3 text-sm text-[#222429] sm:text-base">
            A tool to help explore the plan, related City Council and Planning Committee meetings, and relevant city,
            county, and state policies.
          </p>

          <h2 className="mt-10 text-2xl text-[#970747] sm:text-3xl" style={{ fontFamily: "Lora, serif" }}>
            Where do you want to begin?
          </h2>

          <form onSubmit={onSubmit} className="mt-5">
            <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about the plan, meetings, zoning, or policy..."
              className="flex-1 rounded-full bg-white px-5 py-4 text-base text-[#222429] outline-none ring-1 ring-slate-300 transition focus:ring-2 focus:ring-[#970747]/35"
            />
              <button
                type="submit"
                disabled={loading}
                aria-label="Send"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#2d7f3b] text-white transition hover:bg-[#266e33] disabled:opacity-60"
              >
                {loading ? (
                  "..."
                ) : (
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 15V5" />
                    <path d="m5.5 9.5 4.5-4.5 4.5 4.5" />
                  </svg>
                )}
              </button>
            </div>
          </form>

          <p className="mt-6 text-sm text-[#666a73]">Need ideas? Try one of these to get started.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => ask(starter)}
                className="rounded-lg border border-[#d6d9df] bg-white px-3 py-2 text-sm font-semibold text-[#4e525a] shadow-sm transition hover:bg-slate-50 hover:border-[#b8bec8]"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-screen flex-col pb-4 pt-4">
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-auto pb-28 pt-6">
        {turns.map((turn, idx) => (
          <article key={`${turn.role}-${idx}`} className="mb-8">
            <div className="mb-2 text-xs uppercase tracking-wide text-[#666a73]">{turn.role === "user" ? "You" : "Assistant"}</div>
            <div
              className={`relative text-[15px] leading-7 text-[#1f2125] ${
                turn.role === "assistant" ? "rounded-2xl bg-[#f0f2f4] p-4" : "whitespace-pre-wrap"
              }`}
            >
              {turn.role === "assistant"
                ? renderMarkdownBlocks(stripCitationArtifacts(turn.text), turn.citations, openSources)
                : turn.text}
            </div>
            {turn.theme ? <div className="mt-2 text-xs font-semibold text-[#666a73]">Theme: {turn.theme}</div> : null}
            {turn.role === "assistant" && turn.nextOptions?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {turn.nextOptions.slice(0, 3).map((option, optionIdx) => (
                  <button
                    key={`${option}-${optionIdx}`}
                    type="button"
                    onClick={() => ask(option)}
                    className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#3c4048] ring-1 ring-slate-300 transition hover:bg-slate-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
            {turn.role === "assistant" && turn.citations?.length ? (
              <button
                type="button"
                aria-label="Open sources"
                onClick={() => openSources(turn.citations ?? [])}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#4e525a] underline hover:text-[#1f2125]"
              >
                <SourceIcon />
                <span>Sources</span>
                <span aria-hidden="true">▾</span>
              </button>
            ) : null}
          </article>
        ))}
        {loading ? (
          <article className="mb-8">
            <div className="mb-2 text-xs uppercase tracking-wide text-[#666a73]">Assistant</div>
            <div className="relative whitespace-pre-wrap text-[15px] italic leading-7 text-[#4e525a]">{thinkingText}</div>
          </article>
        ) : null}
        <div ref={messageEndRef} />
      </div>

      <form onSubmit={onSubmit} className="fixed bottom-0 left-0 right-0 bg-[#f7f7f8] px-4 pb-5 pt-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message"
            className="flex-1 rounded-full bg-white px-5 py-3 text-sm text-[#222429] outline-none ring-1 ring-slate-300 focus:ring-2 focus:ring-[#970747]/35"
          />
          <button
            type="submit"
            disabled={loading}
            aria-label="Send"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#2d7f3b] text-white transition hover:bg-[#266e33] disabled:opacity-60"
          >
            {loading ? (
              "..."
            ) : (
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 15V5" />
                <path d="m5.5 9.5 4.5-4.5 4.5 4.5" />
              </svg>
            )}
          </button>
        </div>
      </form>

      {sourcePanel ? (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSourcePanel(null)} role="presentation">
          <div className="absolute left-1/2 top-20 w-[min(92vw,36rem)] -translate-x-1/2 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg text-[#970747]" style={{ fontFamily: "Lora, serif" }}>
                Sources
              </h3>
              <button
                type="button"
                onClick={() => setSourcePanel(null)}
                className="bg-slate-100 px-2 py-1 text-xs text-[#4e525a] hover:bg-slate-200"
              >
                Close
              </button>
            </div>
            <ul className="max-h-[58vh] space-y-2 overflow-auto text-sm">
              {sourcePanel.citations.map((c) => (
                <li key={c.id} className="bg-slate-50 p-2 text-[#222429]">
                  <p className="font-semibold">{c.label}</p>
                  <p className="mt-1 text-xs">&quot;{c.quote}&quot;</p>
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs font-semibold text-[#2d7f3b] underline"
                    >
                      Open source link
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
