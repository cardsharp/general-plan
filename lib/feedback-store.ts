import { getSqlite } from "@/lib/sqlite";

export const FEEDBACK_CATEGORIES = [
  "Incorrect or incomplete",
  "Not what I asked for",
  "Slow or buggy",
  "Style or tone",
  "Safety or legal concern",
  "Other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackVote = "up" | "down";

export type FeedbackInput = {
  responseId: string;
  vote: FeedbackVote;
  category?: FeedbackCategory;
  details?: string;
  question?: string;
  answerExcerpt?: string;
};

export type FeedbackItem = {
  id: number;
  responseId: string;
  vote: FeedbackVote;
  category: string | null;
  details: string | null;
  question: string | null;
  answerExcerpt: string | null;
  createdAt: string;
};

type RawFeedbackItem = {
  id: number;
  response_id: string;
  vote: FeedbackVote;
  category: string | null;
  details: string | null;
  question: string | null;
  answer_excerpt: string | null;
  created_at: string;
};

export async function recordFeedback(input: FeedbackInput) {
  const db = getSqlite();
  const tx = db.transaction(() => {
    db.prepare("delete from response_feedback where response_id = ?").run(input.responseId);
    db.prepare(
      `
      insert into response_feedback (
        response_id, vote, category, details, question, answer_excerpt
      ) values (?, ?, ?, ?, ?, ?)
      `
    ).run(
      input.responseId,
      input.vote,
      input.category ?? null,
      input.details?.trim() || null,
      input.question?.trim() || null,
      input.answerExcerpt?.trim() || null
    );
  });
  tx();
}

export async function deleteFeedback(responseId: string) {
  const db = getSqlite();
  const result = db.prepare("delete from response_feedback where response_id = ?").run(responseId);
  return result.changes;
}

export async function listFeedback(limit = 200): Promise<FeedbackItem[]> {
  const db = getSqlite();
  const rows = db
    .prepare(
      `
      select id, response_id, vote, category, details, question, answer_excerpt, created_at
      from response_feedback
      order by datetime(created_at) desc, id desc
      limit ?
      `
    )
    .all(limit) as RawFeedbackItem[];

  return rows.map((row) => ({
    id: row.id,
    responseId: row.response_id,
    vote: row.vote,
    category: row.category,
    details: row.details,
    question: row.question,
    answerExcerpt: row.answer_excerpt,
    createdAt: row.created_at,
  }));
}

export async function getFeedbackSummary(weeks = 12) {
  const db = getSqlite();
  const overall = db
    .prepare(
      `
      select
        count(*) as total,
        sum(case when vote = 'up' then 1 else 0 end) as up,
        sum(case when vote = 'down' then 1 else 0 end) as down
      from response_feedback
      `
    )
    .get() as { total: number; up: number | null; down: number | null };

  const byCategory = db
    .prepare(
      `
      select coalesce(category, 'Uncategorized') as category, count(*) as count
      from response_feedback
      where vote = 'down'
      group by category
      order by count desc, category asc
      `
    )
    .all() as Array<{ category: string; count: number }>;

  const byWeek = db
    .prepare(
      `
      select
        strftime('%Y-W%W', created_at) as week,
        count(*) as total,
        sum(case when vote = 'up' then 1 else 0 end) as up,
        sum(case when vote = 'down' then 1 else 0 end) as down
      from response_feedback
      group by week
      order by week desc
      limit ?
      `
    )
    .all(weeks) as Array<{ week: string; total: number; up: number | null; down: number | null }>;

  return {
    overall: {
      total: overall.total ?? 0,
      up: overall.up ?? 0,
      down: overall.down ?? 0,
    },
    byCategory,
    byWeek: byWeek.map((row) => ({
      week: row.week,
      total: row.total,
      up: row.up ?? 0,
      down: row.down ?? 0,
    })),
  };
}
