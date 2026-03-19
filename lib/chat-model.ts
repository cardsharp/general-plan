import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

export async function runChatModel(input: {
  system: string;
  user: string;
}): Promise<string> {
  const provider = process.env.CHAT_PROVIDER || "gemini";

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");
    const client = new OpenAI({ apiKey: key });
    const res = await client.responses.create({
      model: process.env.CHAT_MODEL || "gpt-4.1",
      input: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    });
    return res.output_text;
  }

  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Missing GOOGLE_API_KEY");

  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model: process.env.CHAT_MODEL || "gemini-3-flash-preview",
    config: { systemInstruction: input.system },
    contents: input.user,
  });

  return res.text ?? "";
}
