"use client";
import type { HumanDecision } from "@/engine/types";

export class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiCallError("The server could not be reached.", 0, "NETWORK");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !json) throw new ApiCallError(json?.error?.message ?? `Request failed (${res.status}).`, res.status, json?.error?.code ?? "HTTP_ERROR");
  return json;
}

export interface SignResult {
  stateSha256: string;
  signature: string;
  signedAt: string;
  secretMode: "configured" | "ephemeral-dev";
}

export function signCheckpoint(runId: string, atNode: number, state: unknown) {
  return post<SignResult>("/api/checkpoint/sign", { runId, atNode, state });
}

export function verifyCheckpoint(checkpoint: { runId: string; atNode: number; state: unknown; stateSha256: string; signature: string; signedAt?: string }, decisions: HumanDecision[]) {
  return post<{ ok: true; stateSha256: string; decisionsSha256: string; verifiedAt: string }>("/api/checkpoint/verify", { checkpoint, decisions });
}

export interface Health {
  status: string;
  version: string;
  commit: string;
  mode: "deterministic" | "llm-assisted";
  model: string | null;
  llm: { configured: boolean; dailyCap: number; usedToday: number; promptGuard: boolean };
  checkpointSigning: "configured" | "ephemeral-dev" | "missing";
  slack: boolean;
  rateLimit: "upstash" | "memory";
}

export async function getHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export function notifySlack(body: { runId: string; scenarioId: number | "sandbox"; invoiceNumber: string; vendorName: string; amountCents: number; poAmountCents?: number; rules: string[]; confidence: number }) {
  return post<{ ok: true }>("/api/notify/slack", body);
}
