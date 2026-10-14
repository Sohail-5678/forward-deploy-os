import { headline, pct, ratio } from "./results";

export interface Tile {
  id: string;
  value: string;
  label: string;
  detail: string;
  cases?: number;
  seed?: number;
  tone?: "cyan" | "violet" | "ok";
}

/** Headline tiles, every number read from benchmarks/results.json (rule T1). */
export function headlineTiles(): Tile[] {
  const h = headline();
  return [
    { id: "drift", value: pct(h.mappingAccuracy), label: "fields mapped correctly", detail: `exact-name baseline ${pct(h.baselineMappingAccuracy)}; full-file heal ${pct(h.healRate)} vs ${pct(h.baselineHealRate)}`, cases: h.driftFiles, seed: h.seed, tone: "violet" },
    { id: "distillation", value: ratio(h.compressionMedian), label: "smaller than raw HTML", detail: `median on portal pages; up to ${ratio(h.compressionMax)} on enterprise fixtures; ${pct(h.taskSuccess)} task success`, cases: h.distillCases, seed: h.seed, tone: "cyan" },
    { id: "selectors", value: pct(h.selectorHealRate), label: "broken selectors healed", detail: `${h.wrongElements ?? "n/a"} wrong-element actions; recorded CSS-id baseline ${pct(h.selectorBaseline)}`, cases: h.selectorCases, seed: h.seed, tone: "ok" },
    { id: "calibration", value: h.ece !== undefined ? h.ece.toFixed(3) : "n/a", label: "expected calibration error", detail: `Brier ${h.brier}; uncalibrated heuristic ECE ${h.baselineEce}`, cases: h.calibrationCases, seed: h.calibrationSeed, tone: "violet" },
    { id: "guard", value: pct(h.guardBlocked), label: "malicious actions blocked", detail: `by the always-on guard, ${h.guardPlans ?? "n/a"} plans; the scanner alone detects ${pct(h.detectionRate)} at ${pct(h.falsePositiveRate)} false positives`, cases: h.guardPlans, seed: h.seed, tone: "cyan" },
    { id: "idempotency", value: String(h.duplicatePostings ?? "n/a"), label: "duplicate postings", detail: `${h.duplicatesPrevented ?? "n/a"} duplicates prevented across ${h.idemBatches ?? "n/a"} replayed batches`, cases: h.idemBatches, seed: h.seed, tone: "ok" },
  ];
}
