import "server-only";
import { upstash } from "./env";

/**
 * Rate limiting for API routes. With Upstash Redis configured, limits are
 * shared across serverless instances (fixed one-minute windows). Without it,
 * an in-memory token bucket per instance is used: best effort only, because
 * serverless instances do not share memory (documented in the README).
 */

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  backend: "upstash" | "memory";
}

type Bucket = { tokens: number; updated: number };
const g = globalThis as typeof globalThis & { __fdosBuckets?: Map<string, Bucket> };
const buckets = (g.__fdosBuckets ??= new Map());

function memoryLimit(key: string, max: number, windowMs: number): LimitResult {
  const now = Date.now();
  const refillPerMs = max / windowMs;
  const b = buckets.get(key) ?? { tokens: max, updated: now };
  b.tokens = Math.min(max, b.tokens + (now - b.updated) * refillPerMs);
  b.updated = now;
  const allowed = b.tokens >= 1;
  if (allowed) b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 20_000) {
    // Keep memory bounded on long-lived instances.
    for (const [k, v] of buckets) if (now - v.updated > windowMs * 2) buckets.delete(k);
  }
  return { allowed, remaining: Math.floor(b.tokens), resetMs: allowed ? 0 : Math.ceil((1 - b.tokens) / refillPerMs), backend: "memory" };
}

async function upstashLimit(cfg: { url: string; token: string }, key: string, max: number, windowMs: number): Promise<LimitResult> {
  const window = Math.floor(Date.now() / windowMs);
  const redisKey = `fdos:rl:${key}:${window}`;
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(windowMs * 2)],
    ]),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const json = (await res.json()) as { result: number }[];
  const count = Number(json[0]?.result ?? 0);
  const resetMs = windowMs - (Date.now() % windowMs);
  return { allowed: count <= max, remaining: Math.max(0, max - count), resetMs: count <= max ? 0 : resetMs, backend: "upstash" };
}

export async function rateLimit(key: string, max: number, windowMs = 60_000): Promise<LimitResult> {
  const cfg = upstash();
  if (cfg) {
    try {
      return await upstashLimit(cfg, key, max, windowMs);
    } catch {
      // Redis unreachable: fall back to the per-instance limiter instead of failing open.
    }
  }
  return memoryLimit(key, max, windowMs);
}

/** Daily counter for the LLM cost cap. */
const daily = new Map<string, number>();
export async function incrementDaily(name: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `fdos:daily:${name}:${day}`;
  const cfg = upstash();
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, "172800"],
        ]),
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return Number(((await res.json()) as { result: number }[])[0]?.result ?? 0);
    } catch {
      /* fall through */
    }
  }
  const n = (daily.get(key) ?? 0) + 1;
  daily.set(key, n);
  return n;
}

export function peekDaily(name: string): number {
  const day = new Date().toISOString().slice(0, 10);
  return daily.get(`fdos:daily:${name}:${day}`) ?? 0;
}

export function rateLimitBackend(): "upstash" | "memory" {
  return upstash() ? "upstash" : "memory";
}
