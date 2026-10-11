import type { Env } from "./env";

export const MODEL = "@cf/microsoft/resnet-50";

/** ImageNet classes that count as "cat" for this site (domestic cats first, big cats accepted too). */
const CAT_WORDS = new Set([
  "tabby", "tabby cat", "tiger cat", "persian cat", "siamese cat", "siamese", "egyptian cat",
  "lynx", "catamount", "cougar", "puma", "mountain lion", "panther", "leopard", "snow leopard",
  "ounce", "jaguar", "lion", "tiger", "cheetah", "cat",
]);

export interface Label { label: string; score: number }
export interface Verdict {
  confidence: number;   // summed probability of cat-like classes (0..1)
  labels: Label[];      // model output, highest first
  model: string;
}

function isCatLabel(label: string): boolean {
  return label
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .some((part) => CAT_WORDS.has(part) || /\bcat\b/.test(part));
}

/** Classify a small JPEG/PNG/WebP thumbnail with Workers AI. */
export async function classifyCat(env: Env, image: ArrayBuffer): Promise<Verdict> {
  const out = await env.AI.run("@cf/microsoft/resnet-50", { image: [...new Uint8Array(image)] });
  const labels = (Array.isArray(out) ? out : [])
    .map((l) => ({ label: String(l.label ?? ""), score: Number(l.score) || 0 }))
    .sort((a, b) => b.score - a.score);
  const confidence = Math.min(1, labels.filter((l) => isCatLabel(l.label)).reduce((s, l) => s + l.score, 0));
  return { confidence, labels: labels.slice(0, 5), model: MODEL };
}

/**
 * Captioning. Two options:
 *  - Llama 3.2 Vision writes Turkish directly in one call, but Cloudflare gates it behind a license prompt that
 *    the account owner must accept once (run the model with prompt "agree" from the dashboard playground).
 *  - LLaVA (ungated) describes in English, then a small text model translates. Default.
 */
export const USE_LLAMA_VISION = false; // license is accepted on the account, but its Turkish captions were worse than LLaVA + translate (2026-10-12)
const DESCRIBE_PROMPT =
  "Describe the cat in this photo in one sentence of 8 to 16 words: fur color and pattern, pose, what it is doing, and the setting. Output only the sentence.";
const TURKISH_PROMPT =
  "Bu fotoğraftaki kediyi Türkçe olarak tek bir cümleyle betimle (8-16 kelime): tüy rengi ve deseni, duruşu, ne yaptığı, ortam. Yalnızca cümleyi yaz.";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^["'“”\s]+|["'“”\s]+$/g, "").slice(0, 200);
}

/** One-line Turkish description of a cat photo, for page titles and alt text. */
export async function captionCat(env: Env, image: ArrayBuffer): Promise<string> {
  const bytes = [...new Uint8Array(image)];
  if (USE_LLAMA_VISION) {
    const out = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: TURKISH_PROMPT, image: bytes, max_tokens: 60, temperature: 0.4 });
    return clean(typeof out === "object" && out && "response" in out ? String(out.response ?? "") : "");
  }
  const described = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: bytes, prompt: DESCRIBE_PROMPT, max_tokens: 60 });
  const en = clean(String(described.description ?? ""));
  if (!en) return "";
  const translated = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
    messages: [
      { role: "system", content: "Translate the user's English photo caption into one natural, concise Turkish sentence. Reply with only the Turkish sentence, no quotes." },
      { role: "user", content: en },
    ],
    max_tokens: 80,
    temperature: 0.2,
  });
  const tr = typeof translated === "object" && translated && "response" in translated ? clean(String(translated.response ?? "")) : "";
  return tr || en;
}

/** Decision thresholds for user uploads. */
export const AUTO_LIVE_CONFIDENCE = 0.5;   // publish immediately
export const MIN_PENDING_CONFIDENCE = 0.08; // below this we do not even keep the file
