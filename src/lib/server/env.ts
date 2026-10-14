import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Server-only configuration. Secrets are read from environment variables and
 * never sent to the client (no NEXT_PUBLIC_ prefix on any secret).
 */

type Globals = typeof globalThis & { __fdosEphemeralSecret?: string; __fdosCanary?: string; __fdosWarned?: boolean };
const g = globalThis as Globals;

export const isProduction = process.env.NODE_ENV === "production";

export type SecretMode = "configured" | "ephemeral-dev" | "missing";

/** HMAC key for checkpoints. Production requires CHECKPOINT_SECRET; development gets an ephemeral one. */
export function checkpointSecret(): { secret: string; mode: SecretMode } | null {
  const configured = process.env.CHECKPOINT_SECRET;
  if (configured && configured.length >= 32 && !configured.startsWith("replace-with")) return { secret: configured, mode: "configured" };
  if (isProduction) return null;
  if (!g.__fdosEphemeralSecret) {
    g.__fdosEphemeralSecret = randomBytes(32).toString("hex");
    if (!g.__fdosWarned) {
      g.__fdosWarned = true;
      console.warn("[forwarddeploy-os] CHECKPOINT_SECRET is not set: using an ephemeral development secret. Set it in production (npm run secret).");
    }
  }
  return { secret: g.__fdosEphemeralSecret, mode: "ephemeral-dev" };
}

export function secretMode(): SecretMode {
  return checkpointSecret()?.mode ?? "missing";
}

export function groqConfig(): { apiKey: string; model: string } | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" };
}

export function groqModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

export function llmDailyCap(): number {
  const n = Number(process.env.LLM_DAILY_CAP ?? 300);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 300;
}

/** Canary token for the LLM system prompt: from env, or generated once per server instance. */
export function canaryToken(): string {
  if (process.env.CANARY_TOKEN && process.env.CANARY_TOKEN.length >= 8) return process.env.CANARY_TOKEN;
  if (!g.__fdosCanary) g.__fdosCanary = `CNRY-${randomBytes(8).toString("hex")}`;
  return g.__fdosCanary;
}

export function slackWebhook(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL;
  // Only real Slack incoming webhooks; never a URL a client could choose.
  return url && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url) ? url : null;
}

export function upstash(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token && /^https:\/\//.test(url) ? { url: url.replace(/\/$/, ""), token } : null;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, "");
}

export function commitSha(): string {
  return (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local").slice(0, 7);
}
