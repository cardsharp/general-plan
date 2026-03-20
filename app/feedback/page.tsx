"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackItem = {
  id: number;
  responseId: string;
  vote: "up" | "down";
  category: string | null;
  details: string | null;
  question: string | null;
  answerExcerpt: string | null;
  createdAt: string;
};

type FeedbackSummary = {
  overall: { total: number; up: number; down: number };
  byCategory: Array<{ category: string; count: number }>;
  byWeek: Array<{ week: string; total: number; up: number; down: number }>;
};

export default function FeedbackPage() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/feedback?limit=300&weeks=16", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load feedback");
        if (!mounted) return;
        setSummary(data.summary as FeedbackSummary);
        setItems((data.items as FeedbackItem[]) ?? []);
      } catch (error) {
        if (!mounted) return;
        console.error(error);
        setSummary(null);
        setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const overallPct = useMemo(() => {
    if (!summary || summary.overall.total === 0) return 0;
    return Math.round((summary.overall.up / summary.overall.total) * 100);
  }, [summary]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl text-[#970747]" style={{ fontFamily: "Lora, serif" }}>
        Feedback Dashboard
      </h1>
      <p className="mt-2 text-sm text-[#4e525a]">
        Overall response quality and weekly trends from thumbs-up/down feedback.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-[#666a73]">Loading feedback...</p>
      ) : !summary ? (
        <p className="mt-8 text-sm text-red-700">Could not load feedback summary.</p>
      ) : (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-4">
            <StatCard label="Total" value={String(summary.overall.total)} />
            <StatCard label="Thumbs Up" value={String(summary.overall.up)} />
            <StatCard label="Thumbs Down" value={String(summary.overall.down)} />
            <StatCard label="Approval" value={`${overallPct}%`} />
          </section>

          <section className="mt-7 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-[#970747]">By Week</h2>
              <div className="mt-3 space-y-2 text-sm">
                {summary.byWeek.length === 0 ? (
                  <p className="text-[#666a73]">No weekly data yet.</p>
                ) : (
                  summary.byWeek.map((row) => (
                    <div key={row.week} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-[#222429]">{row.week}</span>
                      <span className="text-[#4e525a]">Total {row.total}</span>
                      <span className="text-green-700">👍 {row.up}</span>
                      <span className="text-red-700">👎 {row.down}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-[#970747]">Downvote Categories</h2>
              <div className="mt-3 space-y-2 text-sm">
                {summary.byCategory.length === 0 ? (
                  <p className="text-[#666a73]">No downvote categories yet.</p>
                ) : (
                  summary.byCategory.map((row) => (
                    <div key={row.category} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-[#222429]">{row.category}</span>
                      <span className="text-[#4e525a]">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="mt-7 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-[#970747]">Recent Feedback</h2>
              <ul className="mt-3 max-h-[60vh] space-y-2 overflow-auto">
                {items.length === 0 ? (
                  <li className="text-sm text-[#666a73]">No feedback submitted yet.</li>
                ) : (
                  items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={`w-full rounded border px-3 py-2 text-left text-sm ${
                          selectedId === item.id ? "border-[#970747] bg-[#fff8fc]" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#222429]">
                            {item.vote === "up" ? "👍 Thumbs Up" : `👎 ${item.category ?? "Thumbs Down"}`}
                          </span>
                          <span className="text-xs text-[#666a73]">{item.createdAt}</span>
                        </div>
                        {item.details ? <p className="mt-1 line-clamp-2 text-[#4e525a]">{item.details}</p> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-[#970747]">Details</h2>
              {!selected ? (
                <p className="mt-3 text-sm text-[#666a73]">Click a feedback row to inspect details.</p>
              ) : (
                <div className="mt-3 space-y-3 text-sm text-[#222429]">
                  <Field label="Vote" value={selected.vote === "up" ? "Thumbs Up" : "Thumbs Down"} />
                  <Field label="Category" value={selected.category ?? "—"} />
                  <Field label="Created" value={selected.createdAt} />
                  <Field label="Response ID" value={selected.responseId} />
                  <Field label="Question" value={selected.question ?? "—"} />
                  <Field label="Answer Excerpt" value={selected.answerExcerpt ?? "—"} />
                  <Field label="Details" value={selected.details ?? "—"} multiline />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-[#666a73]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#222429]">{value}</p>
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[#666a73]">{label}</p>
      <p className={`mt-1 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</p>
    </div>
  );
}
