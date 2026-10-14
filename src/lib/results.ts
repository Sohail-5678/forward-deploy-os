/**
 * Typed access to benchmarks/results.json. Every headline number on the site
 * is read from here (rule T1) or computed live; none is typed by hand.
 */
import raw from "../../benchmarks/results.json";
import type { BenchResults } from "@/engine/evals/run";

export const RESULTS = raw as unknown as BenchResults;

type M = Record<string, unknown>;
const m = (id: keyof BenchResults["suites"]) => (RESULTS.suites[id]?.metrics ?? {}) as M;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export const pct = (x: number | undefined, digits = 1) => (x === undefined ? "n/a" : `${(x * 100).toFixed(digits).replace(/\.0$/, "")}%`);

export function headline() {
  const drift = m("drift");
  const dis = m("distillation");
  const sel = m("selectors");
  const cal = m("calibration");
  const inj = m("injection");
  const guard = m("guard");
  const idem = m("idempotency");
  const dates = m("dates");
  const inv = m("invariants");
  const fixtures = (dis.fixtures ?? {}) as Record<string, { ratio: number }>;
  return {
    mappingAccuracy: num(drift.fieldMappingAccuracy),
    baselineMappingAccuracy: num(drift.baselineFieldMappingAccuracy),
    healRate: num(drift.fullFileHealRate),
    baselineHealRate: num(drift.baselineFullFileHealRate),
    driftFiles: RESULTS.suites.drift?.cases,
    mcnemarP: (drift.mcnemar as { pValue?: number } | undefined)?.pValue,
    compressionMedian: num(dis.medianRatio),
    compressionInvoice: num(dis.invoiceFormRatio),
    compressionMax: Object.values(fixtures).length ? Math.max(...Object.values(fixtures).map((f) => f.ratio)) : undefined,
    taskSuccess: num(dis.taskSuccessRate),
    distillCases: RESULTS.suites.distillation?.cases,
    selectorHealRate: num(sel.healRate),
    wrongElements: num(sel.wrongElements),
    selectorBaseline: num(sel.baselineSuccessRate),
    selectorCases: RESULTS.suites.selectors?.cases,
    combinedHeal: (sel.combined as { healRate?: number } | undefined)?.healRate,
    combinedAsk: (sel.combined as { humanEscalationRate?: number } | undefined)?.humanEscalationRate,
    ece: num(cal.ece),
    brier: num(cal.brier),
    baselineEce: num(cal.baselineEce),
    baselineBrier: num(cal.baselineBrier),
    calibrationCases: RESULTS.suites.calibration?.cases,
    calibrationSeed: RESULTS.suites.calibration?.seed,
    detectionRate: num(inj.detectionRate),
    falsePositiveRate: num(inj.falsePositiveRate),
    injectionCases: RESULTS.suites.injection?.cases,
    guardBlocked: num(guard.blockedRate),
    guardPlans: num(guard.maliciousPlans),
    duplicatePostings: num(idem.duplicatePostings),
    duplicatesPrevented: num(idem.duplicatesPrevented),
    idemBatches: num(idem.batches),
    datesEscalated: num(dates.correctlyEscalatedRate),
    invariantDetection: num(inv.detectionRate),
    seed: RESULTS.seed,
    generatedAt: RESULTS.generatedAt,
  };
}

export const ratio = (x: number | undefined) => (x === undefined ? "n/a" : `${x >= 10 ? Math.round(x) : x.toFixed(1)}x`);
