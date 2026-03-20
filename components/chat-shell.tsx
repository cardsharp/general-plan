"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "@/lib/config";

type Citation = {
  id: string;
  label: string;
  docTitle?: string;
  sourceType?: "plan" | "web";
  quote: string;
  url: string | null;
};

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  theme?: string;
  nextOptions?: string[];
};

type FeedbackCategory =
  | "Incorrect or incomplete"
  | "Not what I asked for"
  | "Slow or buggy"
  | "Style or tone"
  | "Safety or legal concern"
  | "Other";

const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "Incorrect or incomplete",
  "Not what I asked for",
  "Slow or buggy",
  "Style or tone",
  "Safety or legal concern",
  "Other",
];

type FeedbackState = {
  vote: "up" | "down";
  category?: FeedbackCategory;
  details?: string;
};

type FeedbackDraft = {
  turnId: string;
  category: FeedbackCategory;
  details: string;
};

type Section = {
  title: string | null;
  nodes: ReactNode[];
  plainText: string[];
};

function pickRandomItems(items: readonly string[], count: number) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

type CoverageItem = {
  key: string;
  label: string;
  matched: boolean;
};

function inferCoverage(text: string, citations?: Citation[]): CoverageItem[] {
  const lower = text.toLowerCase();
  return [
    {
      key: "plan",
      label: "Plan evidence",
      matched: (citations?.length ?? 0) > 0,
    },
    {
      key: "limits",
      label: "Data limits",
      matched: /insufficient|missing|not enough|unclear|cannot determine/.test(lower),
    },
    {
      key: "impact",
      label: "Resident impact",
      matched: /housing|zoning|density|golf course|trail|property|development/.test(lower),
    },
    {
      key: "stats",
      label: "Stats lens",
      matched: /sample|confidence|bias|statistical|survey|margin of error/.test(lower),
    },
  ];
}

function sectionKind(title: string | null) {
  if (!title) return "general";
  const lower = title.toLowerCase();
  if (/what the plan says|plan says|plan evidence/.test(lower)) return "plan";
  if (/what other sources say|supporting documents add|supporting context|supporting evidence/.test(lower)) return "support";
  if (/risk|concern|warning|impact/.test(lower)) return "risk";
  if (/evidence|quote|source|fact|finding/.test(lower)) return "evidence";
  if (/next|ask|action|option|recommend/.test(lower)) return "next";
  return "general";
}

function SectionIcon({ kind }: { kind: "plan" | "support" | "risk" | "evidence" | "next" | "general" }) {
  if (kind === "plan") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 3h12v14H4z" />
        <path d="M7 7h6M7 10h6M7 13h4" />
      </svg>
    );
  }
  if (kind === "support") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h12M4 10h12M4 14h12" />
        <circle cx="6" cy="6" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="6" cy="10" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="6" cy="14" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "risk") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m10 2 8 14H2z" />
        <path d="M10 7v4" />
        <circle cx="10" cy="14" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "evidence") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="3" width="12" height="14" rx="1.5" />
        <path d="M7 7h6M7 10h6M7 13h4" />
      </svg>
    );
  }
  if (kind === "next") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 10h11" />
        <path d="m11 6 4 4-4 4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function reporterTake(title: string | null, text: string, index: number) {
  const kind = sectionKind(title);
  if (kind === "plan") return "Hot take: This is the core plan language to anchor on.";
  if (kind === "support") return "Hot take: Context helps, but the plan still leads the story.";
  if (kind === "risk") return "Hot take: Watch this one closely before decisions harden.";
  if (kind === "evidence") return "Hot take: This is the part worth quoting directly.";
  if (kind === "next") return "Hot take: Best follow-up questions start right here.";
  if (/statistical|sample|survey|confidence|margin of error/i.test(text)) {
    return "Hot take: Good story, but check the math behind the headline.";
  }
  const fallback = [
    "Hot take: The details here matter more than the slogans.",
    "Hot take: This section is where policy meets real life.",
    "Hot take: Keep an eye on what this implies over time.",
  ];
  return fallback[index % fallback.length] ?? fallback[0];
}

type CitationKind = "plan" | "council" | "planning" | "policy" | "other";

function classifyCitationKind(citation: Citation): CitationKind {
  const title = (citation.docTitle ?? citation.label).toLowerCase();
  if (citation.sourceType === "plan" || /general plan/.test(title)) return "plan";
  if (/city council|council meeting/.test(title)) return "council";
  if (/planning commission|planning meeting/.test(title)) return "planning";
  if (/utah|davis county|code|ordinance|statute|policy|zoning/.test(title)) return "policy";
  return "other";
}

function citationKindLabel(kind: CitationKind) {
  if (kind === "plan") return "General Plan";
  if (kind === "council") return "City Council Meeting";
  if (kind === "planning") return "Planning Meeting";
  if (kind === "policy") return "Policy / Law";
  return "Other Source";
}

function CitationTypeIcon({ kind }: { kind: CitationKind }) {
  if (kind === "plan") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="3" width="12" height="14" rx="1.5" />
        <path d="M7 7h6M7 10h6M7 13h4" />
      </svg>
    );
  }
  if (kind === "council") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 16h12" />
        <path d="M6 16V9h8v7" />
        <path d="m3 9 7-4 7 4" />
      </svg>
    );
  }
  if (kind === "planning") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="8" cy="8" r="4" />
        <path d="M11 11 16 16" />
      </svg>
    );
  }
  if (kind === "policy") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M6 3h8v14l-4-2-4 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function citationKindTone(kind: CitationKind) {
  if (kind === "plan") return "bg-[#f4e4ee] text-[#7a2f59]";
  if (kind === "council") return "bg-[#e7eefc] text-[#274a9b]";
  if (kind === "planning") return "bg-[#e8f3ed] text-[#2d7f3b]";
  if (kind === "policy") return "bg-[#f3efe5] text-[#83631a]";
  return "bg-slate-200 text-slate-700";
}

function sectionCardTone(kind: string) {
  if (kind === "plan") return "border-[#dba4c2] bg-[#fff9fc]";
  if (kind === "support") return "border-[#c8d4ec] bg-[#f8faff]";
  return "border-[#ead5e2] bg-white/80";
}

function stripCitationArtifacts(text: string) {
  const noInlineCitations = text.replace(/\[(?:p|page)\s*[x]+\s*(?:¶|para(?:graph)?)\s*[y]+\]/gi, "");

  const sourcesStart = noInlineCitations.search(
    /(^|\n)\s*(?:\*\*)?\s*sources\s*:?\s*(?:\*\*)?\s*(\n|$)/i
  );
  const trimmed = sourcesStart >= 0 ? noInlineCitations.slice(0, sourcesStart) : noInlineCitations;
  const noBlockquoteMarkers = trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n");
  return noBlockquoteMarkers.trim();
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

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 11V5.5c0-.8.3-1.5.9-2.1L11 2l1.3 1.3c.5.5.7 1.2.6 1.9l-.5 3.8H18a2 2 0 0 1 2 2.4l-1 6A2 2 0 0 1 17 19H9" />
      <path d="M5 10h4v9H5z" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M15 13v5.5c0 .8-.3 1.5-.9 2.1L13 22l-1.3-1.3c-.5-.5-.7-1.2-.6-1.9l.5-3.8H6a2 2 0 0 1-2-2.4l1-6A2 2 0 0 1 7 5h8" />
      <path d="M15 5h4v9h-4z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5h1.7V5c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.2V11H8v3h2.4v8h3.1z" />
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

function renderMarkdownBlocks(
  text: string,
  citations: Citation[] | undefined,
  onOpenSources: (items: Citation[]) => void
) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const sections: Section[] = [{ title: null, nodes: [], plainText: [] }];
  const current = () => sections[sections.length - 1];
  const pushNode = (node: ReactNode, plain = "") => {
    const target = current();
    target.nodes.push(node);
    if (plain.trim()) target.plainText.push(plain.trim());
  };
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
      pushNode(
        <ul key={`blk-${key++}`} className="list-disc space-y-2 pl-5">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item, citations, onOpenSources)}</li>
          ))}
        </ul>,
        items.join(" ")
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      pushNode(
        <ol key={`blk-${key++}`} className="list-decimal space-y-2 pl-5">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item, citations, onOpenSources)}</li>
          ))}
        </ol>,
        items.join(" ")
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const heading = line.replace(/^#{1,3}\s+/, "");
      sections.push({ title: heading, nodes: [], plainText: [] });
      i += 1;
      continue;
    }

    const boldTitleMatch = line.match(/^\*\*([^*]+)\*\*:?$/);
    if (boldTitleMatch) {
      const boldHeading = boldTitleMatch[1] ?? "";
      sections.push({ title: boldHeading, nodes: [], plainText: [] });
      i += 1;
      continue;
    }

    pushNode(
      <p key={`blk-${key++}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(line, citations, onOpenSources)}
      </p>,
      line
    );
    i += 1;
  }

  return sections
    .filter((s) => s.nodes.length > 0)
    .map((section, idx) => {
      if (!section.title) return <div key={`sec-${idx}`}>{section.nodes}</div>;
      const kind = sectionKind(section.title);
      return (
        <div key={`sec-${idx}`} className="mb-3">
          <section className={`rounded-xl border p-3 sm:p-4 ${sectionCardTone(kind)}`}>
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-[#970747]">
              <SectionIcon kind={kind} />
              {renderInlineMarkdown(section.title, citations, onOpenSources)}
            </h3>
            <div className="space-y-2">{section.nodes}</div>
            <div className="mt-2 ml-4 rounded-md border-l-2 border-l-[#2d7f3b] bg-[#f4e4ee] px-3 py-2 text-sm italic text-[#7b3a5c]">
              {reporterTake(section.title, section.plainText.join(" "), idx)}
            </div>
          </section>
        </div>
      );
    });
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
  const [starters, setStarters] = useState<string[]>(() => APP_CONFIG.starters.slice(0, 3));
  const [feedbackByTurn, setFeedbackByTurn] = useState<Record<string, FeedbackState>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const latestAssistantRef = useRef<HTMLElement | null>(null);
  const homeInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  function openSources(citations: Citation[]) {
    setSourcePanel({ citations: citations.length ? citations : [] });
  }

  const started = turns.length > 0;

  useEffect(() => {
    if (!started) return;
    const last = turns[turns.length - 1];
    if (!last || last.role !== "assistant") return;
    latestAssistantRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  useEffect(() => {
    setStarters(pickRandomItems(APP_CONFIG.starters, 3));
  }, []);

  useEffect(() => {
    if (started) return;
    homeInputRef.current?.focus();
  }, [started]);

  useEffect(() => {
    if (!started || loading) return;
    chatInputRef.current?.focus();
  }, [started, loading, turns.length]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setTurns((old) => [...old, { id: `u-${Date.now()}-${old.length}`, role: "user", text: question }]);
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
          id: `a-${Date.now()}-${old.length}`,
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
          id: `a-${Date.now()}-${old.length}`,
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

  function shareOnFacebook() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  function priorUserQuestion(index: number) {
    for (let i = index - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (turn?.role === "user") return turn.text;
    }
    return "";
  }

  async function submitFeedback(inputFeedback: {
    turnId: string;
    vote: "up" | "down";
    category?: FeedbackCategory;
    details?: string;
  }) {
    const turnIndex = turns.findIndex((t) => t.id === inputFeedback.turnId);
    const turn = turnIndex >= 0 ? turns[turnIndex] : null;
    if (!turn || turn.role !== "assistant") return;
    setSendingFeedback(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseId: inputFeedback.turnId,
          vote: inputFeedback.vote,
          category: inputFeedback.category,
          details: inputFeedback.details,
          question: priorUserQuestion(turnIndex),
          answerExcerpt: turn.text.slice(0, 1200),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Feedback submit failed");
      setFeedbackByTurn((old) => ({
        ...old,
        [inputFeedback.turnId]: {
          vote: inputFeedback.vote,
          category: inputFeedback.category,
          details: inputFeedback.details,
        },
      }));
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to submit feedback.");
    } finally {
      setSendingFeedback(false);
    }
  }

  async function clearFeedback(turnId: string) {
    setSendingFeedback(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseId: turnId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Feedback remove failed");
      setFeedbackByTurn((old) => {
        const next = { ...old };
        delete next[turnId];
        return next;
      });
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Failed to remove feedback.");
    } finally {
      setSendingFeedback(false);
    }
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
              ref={homeInputRef}
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
          <article
            key={turn.id}
            className="mb-8"
            ref={turn.role === "assistant" && idx === turns.length - 1 ? latestAssistantRef : undefined}
          >
            <div className="mb-2 text-xs uppercase tracking-wide text-[#666a73]">{turn.role === "user" ? "You" : "Assistant"}</div>
            <div
              className={`relative text-[15px] leading-7 text-[#1f2125] ${
                turn.role === "assistant" ? "rounded-2xl bg-[#f0f2f4] p-4" : "whitespace-pre-wrap"
              }`}
            >
              {turn.role === "assistant" ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {inferCoverage(turn.text, turn.citations).map((item) => (
                    <span
                      key={item.key}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${
                        item.matched
                          ? "border-[#cc8db1] bg-white text-[#7a2f59]"
                          : "border-slate-300 bg-slate-100 text-[#7a7f88]"
                      }`}
                    >
                      <span aria-hidden="true">{item.matched ? "✓" : "○"}</span>
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>
              ) : null}
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
            {turn.role === "assistant" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#4e525a]">
                {turn.citations?.length ? (
                  <button
                    type="button"
                    aria-label="Open sources"
                    onClick={() => openSources(turn.citations ?? [])}
                    className="inline-flex items-center gap-1 underline hover:text-[#1f2125]"
                  >
                    <SourceIcon />
                    <span>Sources</span>
                  </button>
                ) : (
                  <span>Sources</span>
                )}
                <span aria-hidden="true" className="text-slate-400">|</span>
                <span>Leave Feedback</span>
                <button
                  type="button"
                  aria-label="Thumbs up"
                  onClick={() =>
                    feedbackByTurn[turn.id]?.vote === "up"
                      ? clearFeedback(turn.id)
                      : submitFeedback({ turnId: turn.id, vote: "up" })
                  }
                  disabled={sendingFeedback}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ${
                    feedbackByTurn[turn.id]?.vote === "up"
                      ? "bg-[#970747] text-white ring-[#970747]"
                      : "bg-white text-[#4e525a] ring-slate-300 hover:bg-slate-50 hover:text-[#1f2125]"
                  }`}
                  title="Thumbs up"
                >
                  <ThumbUpIcon />
                </button>
                <button
                  type="button"
                  aria-label="Thumbs down"
                  onClick={() => {
                    if (feedbackByTurn[turn.id]?.vote === "down") {
                      void clearFeedback(turn.id);
                      return;
                    }
                    setFeedbackDraft({
                      turnId: turn.id,
                      category: feedbackByTurn[turn.id]?.category ?? "Incorrect or incomplete",
                      details: feedbackByTurn[turn.id]?.details ?? "",
                    });
                  }}
                  disabled={sendingFeedback}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ${
                    feedbackByTurn[turn.id]?.vote === "down"
                      ? "bg-[#970747] text-white ring-[#970747]"
                      : "bg-white text-[#4e525a] ring-slate-300 hover:bg-slate-50 hover:text-[#1f2125]"
                  }`}
                  title="Thumbs down"
                >
                  <ThumbDownIcon />
                </button>
                <span aria-hidden="true" className="text-slate-400">|</span>
                <button
                  type="button"
                  aria-label="Share on Facebook"
                  onClick={shareOnFacebook}
                  className="inline-flex items-center gap-1 hover:text-[#1f2125]"
                  title="Share this tool on Facebook"
                >
                  <span>Share on Facebook</span>
                  <FacebookIcon />
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {loading ? (
          <article className="mb-8">
            <div className="mb-2 text-xs uppercase tracking-wide text-[#666a73]">Assistant</div>
            <div className="relative whitespace-pre-wrap text-[15px] italic leading-7 text-[#4e525a]">{thinkingText}</div>
          </article>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="fixed bottom-0 left-0 right-0 bg-[#f7f7f8] px-4 pb-5 pt-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <input
            ref={chatInputRef}
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
              {sourcePanel.citations.map((c) => {
                const kind = classifyCitationKind(c);
                return (
                <li key={c.id} className="bg-slate-50 p-2 text-[#222429]">
                  <p className="flex items-center gap-2 font-semibold">
                    <span
                      title={citationKindLabel(kind)}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${citationKindTone(kind)}`}
                    >
                      <CitationTypeIcon kind={kind} />
                    </span>
                    <span>{c.label}</span>
                  </p>
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
              );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {feedbackDraft ? (
        <div className="fixed inset-0 z-50 bg-black/25" onClick={() => setFeedbackDraft(null)} role="presentation">
          <div
            className="absolute left-1/2 top-24 w-[min(92vw,34rem)] -translate-x-1/2 rounded bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg text-[#970747]" style={{ fontFamily: "Lora, serif" }}>
              Tell us what went wrong
            </h3>
            <p className="mt-1 text-sm text-[#4e525a]">Select a category and optionally share details.</p>
            <div className="mt-3 space-y-2">
              {FEEDBACK_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFeedbackDraft((old) => (old ? { ...old, category } : old))}
                  className={`mr-2 mt-2 inline-flex rounded-full px-3 py-1.5 text-sm ring-1 ${
                    feedbackDraft.category === category
                      ? "bg-[#f4e4ee] text-[#7a2f59] ring-[#d6a0be]"
                      : "bg-white text-[#4e525a] ring-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-sm font-semibold text-[#4e525a]">Share Details (optional)</label>
            <textarea
              value={feedbackDraft.details}
              onChange={(e) => setFeedbackDraft((old) => (old ? { ...old, details: e.target.value } : old))}
              rows={4}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-[#222429] outline-none focus:ring-2 focus:ring-[#970747]/30"
              placeholder="What was missing, wrong, or unhelpful?"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFeedbackDraft(null)}
                className="rounded bg-slate-100 px-3 py-1.5 text-sm text-[#4e525a] hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingFeedback}
                onClick={async () => {
                  const draft = feedbackDraft;
                  if (!draft) return;
                  await submitFeedback({
                    turnId: draft.turnId,
                    vote: "down",
                    category: draft.category,
                    details: draft.details,
                  });
                  setFeedbackDraft(null);
                }}
                className="rounded bg-[#2d7f3b] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#266e33] disabled:opacity-60"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
