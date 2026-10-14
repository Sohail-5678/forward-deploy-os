import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { appendAudit, verifyAuditChain } from "@/engine/agent/audit";
import { canonicalJSON, sha256Hex } from "@/engine/hash";
import { fixedClock } from "@/engine/clock";
import type { AuditEntry } from "@/engine/types";

const opts = { seed: 20261014, numRuns: 200 };
const json = fc.jsonValue().map((v) => JSON.parse(JSON.stringify(v)) as unknown);

function shuffleKeys(v: unknown, rnd: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rnd));
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x, rnd)]));
  }
  return v;
}

describe("integrity properties (fast-check)", () => {
  it("canonical JSON ignores key order and round-trips", () => {
    fc.assert(
      fc.property(json, fc.integer(), (v, seed) => {
        let s = seed >>> 0;
        const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        expect(canonicalJSON(shuffleKeys(v, rnd))).toBe(canonicalJSON(v));
        expect(JSON.parse(canonicalJSON(v))).toEqual(v);
      }),
      opts,
    );
  });

  const entry = fc.record({ actor: fc.constantFrom("engine", "human:Test Operator", "guard"), kind: fc.constantFrom("RUN_STARTED", "SPEC_SYNTHESIZED", "ESCALATED", "HUMAN_DECISION", "POSTED"), data: json });

  it("an appended hash chain always verifies", () => {
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 30 }), (entries) => {
        const clock = fixedClock();
        let log: AuditEntry[] = [];
        for (const e of entries) log = appendAudit(log, e as Parameters<typeof appendAudit>[1], clock);
        expect(verifyAuditChain(log)).toEqual({ valid: true, checked: entries.length });
      }),
      opts,
    );
  });

  it("editing any entry breaks the chain exactly there", () => {
    fc.assert(
      fc.property(fc.array(entry, { minLength: 2, maxLength: 20 }), fc.nat(), (entries, pick) => {
        const clock = fixedClock();
        let log: AuditEntry[] = [];
        for (const e of entries) log = appendAudit(log, e as Parameters<typeof appendAudit>[1], clock);
        const i = pick % log.length;
        const tampered = log.map((e, k) => (k === i ? { ...e, data: { tampered: sha256Hex(String(k)) } } : e));
        const verdict = verifyAuditChain(tampered);
        expect(verdict.valid).toBe(false);
        expect(verdict.brokenAt).toBe(i);
      }),
      opts,
    );
  });
});
