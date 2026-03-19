import { NextResponse } from "next/server";
import { topThemes } from "@/lib/vector-store";

export async function GET() {
  try {
    const themes = await topThemes(12);
    return NextResponse.json({ themes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
