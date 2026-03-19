import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { GoogleGenAI } from "@google/genai";
import { embedText } from "../lib/embeddings";
import { upsertChunk } from "../lib/vector-store";
import { Chunk } from "../lib/types";

const PDF_PATH = process.argv[2] || "Fruit Heights General Plan FINAL (1).pdf";
const execFileAsync = promisify(execFile);
const ENABLE_VISION = process.env.PDF_VISION_ENRICH === "true";
const VISION_MODEL = process.env.PDF_VISION_MODEL || "gemini-2.5-flash";
const START_PAGE = Math.max(1, Number(process.env.PDF_INGEST_START_PAGE || process.argv[3] || "1"));

function splitParagraphs(raw: string): string[] {
  return raw
    .split(/\n{2,}/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length > 80);
}

async function renderPageImage(pdfPath: string, pageNumber: number): Promise<string | null> {
  const prefix = path.join(os.tmpdir(), `fh-page-${Date.now()}-${pageNumber}`);
  try {
    await execFileAsync("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-png", pdfPath, prefix]);
    const expected = `${prefix}-${pageNumber}.png`;
    await fs.access(expected);
    return expected;
  } catch {
    return null;
  }
}

async function extractVisionText(imagePath: string): Promise<string | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;

  const image = await fs.readFile(imagePath);
  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model: VISION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Extract map labels, chart text, legends, callouts, and visible planning statements from this page image. " +
              "Return only factual extracted text in concise paragraphs. Do not infer missing values.",
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: image.toString("base64"),
            },
          },
        ],
      },
    ],
  });

  const text = res.text?.trim() ?? "";
  return text.length > 50 ? text : null;
}

async function run() {
  const fullPath = path.resolve(PDF_PATH);
  const data = await fs.readFile(fullPath);
  const loadingTask = getDocument({ data: new Uint8Array(data) });
  const pdf = await loadingTask.promise;

  let totalChunks = 0;

  for (let pageNumber = START_PAGE; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const raw = text.items
      .map((item) => {
        if ("str" in item) return item.str;
        return "";
      })
      .join("\n");

    const paragraphs = splitParagraphs(raw);

    for (let i = 0; i < paragraphs.length; i += 1) {
      const para = paragraphs[i];
      const quote = para.slice(0, 220);
      const chunk: Chunk = {
        id: `fh-plan-p${pageNumber}-para${i + 1}`,
        doc_id: "fruit-heights-general-plan",
        doc_title: "Fruit Heights General Plan",
        page: pageNumber,
        paragraph: i + 1,
        text: para,
        quote,
        source_type: "plan",
      };

      const embedding = await embedText(`${chunk.doc_title} page ${chunk.page} paragraph ${chunk.paragraph}\n${chunk.text}`);
      await upsertChunk(chunk, embedding);
      totalChunks += 1;
    }

    if (ENABLE_VISION) {
      const imagePath = await renderPageImage(fullPath, pageNumber);
      if (imagePath) {
        const visionText = await extractVisionText(imagePath);
        await fs.unlink(imagePath).catch(() => undefined);

        if (visionText) {
          const visionParagraphs = splitParagraphs(visionText);
          for (let i = 0; i < visionParagraphs.length; i += 1) {
            const para = visionParagraphs[i];
            const paragraph = 1000 + i + 1;
            const chunk: Chunk = {
              id: `fh-plan-p${pageNumber}-vision${i + 1}`,
              doc_id: "fruit-heights-general-plan",
              doc_title: "Fruit Heights General Plan (Vision Extract)",
              page: pageNumber,
              paragraph,
              text: para,
              quote: para.slice(0, 220),
              source_type: "plan",
            };

            const embedding = await embedText(
              `${chunk.doc_title} page ${chunk.page} paragraph ${chunk.paragraph}\n${chunk.text}`
            );
            await upsertChunk(chunk, embedding);
            totalChunks += 1;
          }
        }
      }
    }

    console.log(`Indexed page ${pageNumber}/${pdf.numPages} (${paragraphs.length} paragraphs)`);
  }

  console.log(`Done. Indexed ${totalChunks} chunks from ${fullPath} (start page: ${START_PAGE})`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
