"use client";

import { useEffect, useState } from "react";

type Row = { theme: string; count: number };

export function ThemeStats() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setRows(d.themes || []))
      .catch(() => setRows([]));
  }, []);

  return (
    <section className="mt-6 rounded-3xl glass p-4 sm:p-6">
      <h2 className="font-display text-lg text-pine sm:text-xl">Top Community Question Themes</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No data yet. Ask a few questions to populate this.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.theme} className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm">
              <span>{row.theme}</span>
              <span className="font-bold text-alpine">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
