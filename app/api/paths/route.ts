import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

type Entry = {
  name: string;
  fullPath: string;
  isDir: boolean;
  bytes: number | null;
  children?: Array<{
    name: string;
    fullPath: string;
    isDir: boolean;
    bytes: number | null;
  }>;
};

function statEntry(fullPath: string) {
  try {
    const st = fs.statSync(fullPath);
    return { isDir: st.isDirectory(), bytes: st.size };
  } catch {
    return { isDir: false, bytes: null };
  }
}

function listOneLevel(dirPath: string, maxEntries = 200): Entry[] {
  try {
    const dirents = fs.readdirSync(dirPath, { withFileTypes: true }).slice(0, maxEntries);
    return dirents
      .map((d) => {
        const fullPath = path.join(dirPath, d.name);
        const st = statEntry(fullPath);
        const entry: Entry = {
          name: d.name,
          fullPath,
          isDir: d.isDirectory() || st.isDir,
          bytes: st.bytes,
        };

        if (entry.isDir) {
          try {
            entry.children = fs
              .readdirSync(fullPath, { withFileTypes: true })
              .slice(0, maxEntries)
              .map((c) => {
                const childPath = path.join(fullPath, c.name);
                const cst = statEntry(childPath);
                return {
                  name: c.name,
                  fullPath: childPath,
                  isDir: c.isDirectory() || cst.isDir,
                  bytes: cst.bytes,
                };
              });
          } catch {
            entry.children = [];
          }
        }

        return entry;
      })
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  } catch {
    return [];
  }
}

export async function GET() {
  const rootsToCheck = Array.from(
    new Set([
      "/",
      "/app",
      "/data",
      process.cwd(),
      process.env.RAILWAY_VOLUME_MOUNT_PATH || "",
      path.dirname(path.resolve(process.env.SQLITE_PATH || "./data/app.db")),
    ].filter(Boolean))
  );

  const roots = rootsToCheck.map((root) => ({
    root,
    entries: listOneLevel(root),
  }));

  return NextResponse.json({
    ok: true,
    cwd: process.cwd(),
    sqlitePathRaw: process.env.SQLITE_PATH || "./data/app.db",
    sqlitePathResolved: path.resolve(process.env.SQLITE_PATH || "./data/app.db"),
    railwayVolumeMountPath: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
    roots,
  });
}

