import OpenAI from "openai";

let _client = null;

export function ai() {
  if (_client) return _client;
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key.startsWith("sk-")) throw new Error("OPENAI_API_KEY missing or malformed");
  _client = new OpenAI({ apiKey: key });
  return _client;
}

export const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";
export const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

export async function embed(texts) {
  const res = await ai().embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function chatJSON(system, user, { temperature = 0.85, maxTokens = 1024 } = {}) {
  const res = await ai().chat.completions.create({
    model: CHAT_MODEL,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  let raw = (res.choices[0].message.content || "").trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(raw);
}
