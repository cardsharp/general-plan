import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/sqlite";

export async function GET() {
  try {
    const db = getSqlite();
    const total = (db.prepare("select count(*) as c from document_chunks").get() as { c: number }).c;
    const pending = (
      db.prepare("select count(*) as c from document_chunks where embedding_blob is null").get() as { c: number }
    ).c;

    return NextResponse.json({
      ok: true,
      name: "Explore the Fruit Heights City Plan",
      sqlitePath: process.env.SQLITE_PATH || "./data/app.db",
      enforceCitationGuard: process.env.ENFORCE_CITATION_GUARD === "true",
      chatDebug: process.env.CHAT_DEBUG === "true",
      embedPrimaryProvider: process.env.EMBED_PRIMARY_PROVIDER || process.env.EMBED_PROVIDER || "google",
      chunkCounts: {
        total,
        pending,
        embedded: total - pending,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        name: "Explore the Fruit Heights City Plan",
        error: error instanceof Error ? error.message : "Health check failed",
      },
      { status: 500 }
    );
  }
}
