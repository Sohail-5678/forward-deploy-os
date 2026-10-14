/**
 * Tamper-evident audit log: a hash chain where
 *   hash = sha256(prevHash + canonicalJSON(entry without hash)).
 * Editing any entry breaks every hash after it. This is tamper evidence, not
 * a cryptographic identity signature (rule T3).
 */
import type { AuditEntry } from "../types";
import type { Clock } from "../clock";
import { canonicalJSON, sha256Hex } from "../hash";

export const GENESIS_HASH = "0".repeat(64);

export function hashEntry(base: Omit<AuditEntry, "hash">): string {
  return sha256Hex(base.prevHash + canonicalJSON(base));
}

export function appendAudit(log: AuditEntry[], entry: { actor: AuditEntry["actor"]; kind: string; data: unknown }, clock: Clock): AuditEntry[] {
  const prev = log[log.length - 1];
  const base: Omit<AuditEntry, "hash"> = {
    seq: log.length,
    at: clock.iso(),
    actor: entry.actor,
    kind: entry.kind,
    data: entry.data,
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return [...log, { ...base, hash: hashEntry(base) }];
}

export interface ChainVerdict {
  valid: boolean;
  checked: number;
  brokenAt?: number;
  reason?: string;
}

export function verifyAuditChain(log: AuditEntry[]): ChainVerdict {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i) return { valid: false, checked: i, brokenAt: i, reason: `entry ${i} has seq ${e.seq}` };
    if (e.prevHash !== prevHash) return { valid: false, checked: i, brokenAt: i, reason: `entry ${i} does not point at the previous hash` };
    const { hash, ...base } = e;
    const expected = hashEntry(base);
    if (expected !== hash) return { valid: false, checked: i, brokenAt: i, reason: `entry ${i} content does not match its hash` };
    prevHash = hash;
  }
  return { valid: true, checked: log.length };
}

/** Deterministic override code bound from the audit entry of an APPROVE_OVERRIDE decision. */
export function overrideCodeFromAudit(entry: AuditEntry): string {
  return `OVR-${entry.hash.slice(0, 6).toUpperCase()}`;
}
