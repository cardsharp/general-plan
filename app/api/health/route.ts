import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, name: "Explore the Fruit Heights City Plan" });
}
