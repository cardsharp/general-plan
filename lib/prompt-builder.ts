import { Chunk } from "@/lib/types";

export function buildContext(chunks: Chunk[]) {
  return chunks
    .map(
      (chunk) =>
        `[${chunk.source_type.toUpperCase()} | ${chunk.doc_title} | p${chunk.page} ¶${chunk.paragraph}]\n` +
        `${chunk.text}\n` +
        `Quote candidate: "${chunk.quote}"\n` +
        (chunk.url ? `URL: ${chunk.url}\n` : "")
    )
    .join("\n---\n");
}

export function buildUserPrompt(question: string, context: string) {
  return `Question:\n${question}\n\nEvidence:\n${context}\n\nAnswer with citations.`;
}
