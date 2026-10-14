import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJSON } from "@/engine/hash";

/**
 * HMAC-SHA256 checkpoint signing (spec 8.4). The server computes the state
 * hash itself; on resume it recomputes the hash from the submitted state and
 * checks the signature, so a state edited after suspension is rejected.
 *
 * Trust boundary: the engine runs in the visitor's browser, so a signature
 * proves that the state a human approves is exactly the state that was
 * suspended. It does not prove the browser computed that state honestly; the
 * policy re-check below catches the most important inconsistency.
 */

export function stateSha256(state: unknown): string {
  return createHash("sha256").update(canonicalJSON(state)).digest("hex");
}

function mac(secret: string, runId: string, atNode: number, sha: string): string {
  return createHmac("sha256", secret).update(`fdos-checkpoint-v1|${runId}|${atNode}|${sha}`).digest("hex");
}

export function signCheckpoint(secret: string, runId: string, atNode: number, state: unknown) {
  const sha = stateSha256(state);
  return { stateSha256: sha, signature: mac(secret, runId, atNode, sha), signedAt: new Date().toISOString() };
}

export type VerifyResult = { ok: true; stateSha256: string } | { ok: false; code: "CHECKPOINT_TAMPERED" | "BAD_SIGNATURE"; message: string };

export function verifyCheckpoint(secret: string, cp: { runId: string; atNode: number; state: unknown; stateSha256: string; signature: string }): VerifyResult {
  const recomputed = stateSha256(cp.state);
  if (recomputed !== cp.stateSha256) {
    return { ok: false, code: "CHECKPOINT_TAMPERED", message: `The checkpoint state was modified after it was signed (expected ${cp.stateSha256.slice(0, 12)}…, got ${recomputed.slice(0, 12)}…). Resume rejected.` };
  }
  const expected = Buffer.from(mac(secret, cp.runId, cp.atNode, recomputed), "hex");
  const given = Buffer.from(cp.signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, code: "BAD_SIGNATURE", message: "The checkpoint signature does not verify. Resume rejected." };
  }
  return { ok: true, stateSha256: recomputed };
}

interface LooseState {
  runId?: unknown;
  status?: unknown;
  pending?: { id?: unknown; kind?: unknown; options?: { choice?: unknown }[] }[];
  n4?: { reconciliations?: { recordId?: unknown; policyHits?: { rule?: unknown }[] }[] };
  n5?: { approved?: { recordId?: unknown; approval?: unknown }[] };
}

/** Refuse to sign a state whose policy gate contradicts its own reconciliations (rule S3). */
export function policyIntegrity(state: unknown, runId: string): string | null {
  const s = state as LooseState;
  if (s.runId !== runId) return "runId does not match the state";
  if (s.status !== "SUSPENDED_HITL") return "only a run suspended for a human can be signed";
  if (!Array.isArray(s.pending) || s.pending.length === 0) return "a suspended run must have pending escalations";
  const hardHit = new Set(
    (s.n4?.reconciliations ?? [])
      .filter((r) => (r.policyHits ?? []).some((h) => h.rule !== "LOW_CONFIDENCE"))
      .map((r) => String(r.recordId)),
  );
  for (const a of s.n5?.approved ?? []) {
    if (a.approval === "auto" && hardHit.has(String(a.recordId))) return `record ${String(a.recordId)} has a hard policy hit but was auto-approved`;
  }
  return null;
}

/** Decisions must answer pending escalations with one of the offered options. */
export function decisionsMatch(state: unknown, decisions: { escalationId: string; choice: string }[]): string | null {
  const s = state as LooseState;
  const pending = s.pending ?? [];
  for (const d of decisions) {
    const esc = pending.find((p) => p.id === d.escalationId);
    if (!esc) return `no pending escalation ${d.escalationId}`;
    if (!(esc.options ?? []).some((o) => o.choice === d.choice)) return `"${d.choice}" is not an option for ${d.escalationId}`;
  }
  return null;
}
