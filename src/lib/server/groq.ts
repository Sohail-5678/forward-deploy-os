import "server-only";
import type { ZodType } from "zod";
import { canaryToken, groqConfig, groqModel, llmDailyCap } from "./env";
import { incrementDaily, peekDaily } from "./rate-limit";
import { ApiError } from "./http";
import { containsCanary } from "@/engine/security/canary";
import { secureNonce } from "@/engine/security/spotlighting";
import type { PromptPair } from "@/engine/llm/prompts";

/**
 * Optional Groq LLM calls (spec 12). Server-side only; the browser never sees
 * the owner key. A visitor may bring their own Groq key (BYOK) in a header for
 * one request: it is used for that call only, never stored or logged, and it
 * bypasses the site's daily cap (it is their quota).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const BYOK_RE = /^gsk_[A-Za-z0-9]{20,120}$/;

export function resolveKey(req: Request): { apiKey: string; model: string; byok: boolean } {
  const byok = req.headers.get("x-groq-key");
  if (byok) {
    if (!BYOK_RE.test(byok)) throw new ApiError(400, "INVALID_KEY_FORMAT", "That does not look like a Groq API key (gsk_...).");
    return { apiKey: byok, model: groqModel(), byok: true };
  }
  const cfg = groqConfig();
  if (!cfg) throw new ApiError(503, "LLM_NOT_CONFIGURED", "No LLM key is configured; running in deterministic mode.");
  return { ...cfg, byok: false };
}

export async function enforceDailyCap(byok: boolean): Promise<void> {
  if (byok) return;
  const cap = llmDailyCap();
  if (peekDaily("llm") >= cap) throw new ApiError(429, "LLM_CAP_REACHED", `The site's daily LLM cap (${cap}) is reached; continuing in deterministic mode.`);
  const n = await incrementDaily("llm");
  if (n > cap) throw new ApiError(429, "LLM_CAP_REACHED", `The site's daily LLM cap (${cap}) is reached; continuing in deterministic mode.`);
}

async function chat(apiKey: string, model: string, messages: { role: "system" | "user" | "assistant"; content: string }[], maxTokens: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, "LLM_UNAVAILABLE", "The LLM provider did not respond; continuing in deterministic mode.");
  }
  if (res.status === 401 || res.status === 403) throw new ApiError(401, "LLM_KEY_REJECTED", "The LLM provider rejected the API key.");
  if (res.status === 429) throw new ApiError(429, "LLM_PROVIDER_LIMIT", "The LLM provider rate-limited this key; continuing in deterministic mode.");
  if (!res.ok) throw new ApiError(503, "LLM_UNAVAILABLE", `The LLM provider returned ${res.status}; continuing in deterministic mode.`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Run one task: spotlighted prompt -> JSON -> Zod. Invalid output is retried
 * once with the validation error; then the caller falls back. The canary
 * check runs on every response.
 */
export async function runLlmTask<T>(req: Request, build: (canary: string, nonce: string) => PromptPair, schema: ZodType<T>, maxTokens = 900): Promise<{ data: T; model: string }> {
  const { apiKey, model, byok } = resolveKey(req);
  await enforceDailyCap(byok);
  const canary = canaryToken();
  const prompt = build(canary, secureNonce());
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  let lastError = "invalid JSON";
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat(apiKey, model, messages, maxTokens);
    if (containsCanary(content, canary)) throw new ApiError(422, "CANARY_TRIPPED", "The model output contained the canary token; the response was discarded.");
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      lastError = "the response was not valid JSON";
      messages.push({ role: "assistant", content: content.slice(0, 2000) }, { role: "user", content: `That was not valid JSON (${lastError}). Reply with only the JSON object.` });
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { data: parsed.data, model };
    lastError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    messages.push({ role: "assistant", content: content.slice(0, 2000) }, { role: "user", content: `The JSON failed validation (${lastError}). Fix it and reply with only the JSON object.` });
  }
  throw new ApiError(422, "LLM_INVALID_OUTPUT", `The model output failed validation twice (${lastError}); using deterministic logic.`);
}

/** Optional Llama Prompt Guard 2 signal (preview model on Groq), behind ENABLE_PROMPT_GUARD. */
export async function promptGuardScore(req: Request, text: string): Promise<{ score: number; model: string } | null> {
  if (process.env.ENABLE_PROMPT_GUARD !== "1") return null;
  const { apiKey, byok } = resolveKey(req);
  await enforceDailyCap(byok);
  const model = process.env.PROMPT_GUARD_MODEL || "meta-llama/llama-prompt-guard-2-86m";
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text.slice(0, 4000) }], temperature: 0, max_tokens: 8 }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const out = (data?.choices?.[0]?.message?.content ?? "").trim();
  const num = Number(out);
  if (Number.isFinite(num)) return { score: Math.max(0, Math.min(1, num)), model };
  if (/malicious|jailbreak|injection/i.test(out)) return { score: 1, model };
  if (/benign/i.test(out)) return { score: 0, model };
  return null;
}

export function llmStatus() {
  return { configured: !!groqConfig(), model: groqModel(), dailyCap: llmDailyCap(), usedToday: peekDaily("llm"), promptGuard: process.env.ENABLE_PROMPT_GUARD === "1" };
}
