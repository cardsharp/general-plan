import { APP_CONFIG } from "@/lib/config";

const keymap: Array<{ theme: string; words: string[] }> = [
  { theme: "Trails and transportation", words: ["trail", "road", "street", "transport", "sidewalk"] },
  { theme: "Housing density and land use", words: ["housing", "density", "zoning", "land use", "residential"] },
  { theme: "Golf course and recreation", words: ["golf", "recreation", "course", "clubhouse"] },
  { theme: "Public input and survey validity", words: ["feedback", "public", "survey", "sample", "statistical"] },
  { theme: "Parks and open space", words: ["park", "open space", "green", "tree"] },
  { theme: "Economic development", words: ["economic", "business", "tax", "commercial", "jobs"] }
];

export function classifyTheme(question: string): string {
  const lower = question.toLowerCase();
  const found = keymap.find((item) => item.words.some((w) => lower.includes(w)));
  return found?.theme ?? APP_CONFIG.themeTaxonomy[0];
}
