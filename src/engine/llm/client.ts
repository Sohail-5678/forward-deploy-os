/**
 * Transport-agnostic LLM client used by the engine. In the browser it calls
 * this app's own /api/llm/* routes (the provider key never reaches the
 * client); on the server the routes call the provider. Every failure mode
 * (no key, cap reached, invalid JSON, provider down) returns a fallback
 * result and the engine continues deterministically, saying so (spec 12).
 */
import type { BindableField } from "../types";

export type LlmResult<T> = { ok: true; data: T; model: string; ms: number } | { ok: false; reason: string; ms: number };

export interface LlmClient {
  mapSchema(req: { columns: { name: string; samples: string[] }[]; targets: { key: string; kind: string; description: string }[] }): Promise<LlmResult<{ source: string; target: string; reason?: string }[]>>;
  extractInvoice(req: { text: string; docName: string }): Promise<LlmResult<Record<string, unknown>>>;
  planActions(req: { distilled: string[]; fields: BindableField[]; page: string }): Promise<LlmResult<unknown[]>>;
}

/** Client for the app's own API routes (same origin). `byok` is an optional user key sent per request. */
export function createHttpLlmClient(opts: { baseUrl?: string; byok?: () => string | undefined; fetchImpl?: typeof fetch } = {}): LlmClient {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? "";
  async function call<T>(task: string, body: unknown): Promise<LlmResult<T>> {
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const key = opts.byok?.();
      if (key) headers["x-groq-key"] = key;
      const res = await f(`${base}/api/llm/${task}`, { method: "POST", headers, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; model?: string; error?: { code: string; message: string } } | null;
      if (!res.ok || !json?.ok) return { ok: false, reason: json?.error?.message ?? `HTTP ${res.status}`, ms: Date.now() - t0 };
      return { ok: true, data: json.data as T, model: json.model ?? "unknown", ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "network error", ms: Date.now() - t0 };
    }
  }
  return {
    mapSchema: (req) => call("map-schema", req),
    extractInvoice: (req) => call("extract-invoice", req),
    planActions: async (req) => {
      const r = await call<{ actions: unknown[] }>("plan-actions", req);
      return r.ok ? { ...r, data: r.data.actions } : r;
    },
  };
}
