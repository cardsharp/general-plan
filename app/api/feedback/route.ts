import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FEEDBACK_CATEGORIES, deleteFeedback, getFeedbackSummary, listFeedback, recordFeedback } from "@/lib/feedback-store";

const postSchema = z.object({
  responseId: z.string().min(3).max(200),
  vote: z.enum(["up", "down"]),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  details: z.string().max(2000).optional(),
  question: z.string().max(1500).optional(),
  answerExcerpt: z.string().max(2500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = postSchema.parse(await request.json());

    if (body.vote === "up" && body.category) {
      return NextResponse.json(
        { error: "Category is only valid for thumbs-down feedback." },
        { status: 400 }
      );
    }
    if (body.vote === "down" && !body.category) {
      return NextResponse.json(
        { error: "Category is required for thumbs-down feedback." },
        { status: 400 }
      );
    }

    await recordFeedback(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const weeksRaw = request.nextUrl.searchParams.get("weeks");
    const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(500, Number(limitRaw))) : 200;
    const weeks = Number.isFinite(Number(weeksRaw)) ? Math.max(1, Math.min(104, Number(weeksRaw))) : 12;

    const [summary, items] = await Promise.all([getFeedbackSummary(weeks), listFeedback(limit)]);
    return NextResponse.json({ summary, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = z.object({ responseId: z.string().min(3).max(200) }).parse(await request.json());
    const deleted = await deleteFeedback(body.responseId);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
