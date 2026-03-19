import { NextResponse } from "next/server";
import { getSqlite } from "@/lib/sqlite";
import fs from "node:fs";
import crypto from "node:crypto";

function fileMeta(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    const buf = fs.readFileSync(filePath);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    return {
      exists: true,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      sha256: sha,
    };
  } catch {
    return {
      exists: false,
    };
  }
}

export async function GET() {
  try {
    const db = getSqlite();
    const sqlitePath = process.env.SQLITE_PATH || "./data/app.db";
    const total = (db.prepare("select count(*) as c from document_chunks").get() as { c: number }).c;
    const pending = (
      db.prepare("select count(*) as c from document_chunks where embedding_blob is null").get() as { c: number }
    ).c;
    const dbList = db.prepare("pragma database_list").all() as Array<{
      seq: number;
      name: string;
      file: string;
    }>;

    return NextResponse.json({
      ok: true,
      name: "Explore the Fruit Heights City Plan",
      sqlitePath,
      enforceCitationGuard: process.env.ENFORCE_CITATION_GUARD === "true",
      chatDebug: process.env.CHAT_DEBUG === "true",
      embedPrimaryProvider: process.env.EMBED_PRIMARY_PROVIDER || process.env.EMBED_PROVIDER || "google",
      dbFileMeta: fileMeta(sqlitePath),
      pragmaDatabaseList: dbList,
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
