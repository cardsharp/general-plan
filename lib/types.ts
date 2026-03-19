export type Chunk = {
  id: string;
  doc_id: string;
  doc_title: string;
  page: number;
  paragraph: number;
  text: string;
  quote: string;
  source_type: "plan" | "web";
  url?: string;
};

export type ThemeEvent = {
  question: string;
  theme: string;
  created_at?: string;
};
