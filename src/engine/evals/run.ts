/**
 * Benchmark orchestrator, used by `npm run bench` (Node + jsdom) and by the
 * live re-run in the browser. Every headline number on the site comes from
 * this output (rule T1).
 */
import type { SuiteEnv, SuiteId, SuiteResult } from "./types";
import { datesSuite, driftSuite, invariantsSuite } from "./suites/etl";
import { calibrationSuite } from "./suites/calibration";
import { guardSuite, injectionSuite } from "./suites/security";
import { distillationSuite, idempotencySuite, selectorSuite } from "./suites/browser";
import { latencySuite } from "./suites/latency";

export const BENCH_SEED = 20261014;
export const RESULTS_FORMAT = "forwarddeploy-os/benchmarks@1";

export interface Budget {
  item: string;
  target: string;
  measured: string;
  met: boolean | null;
  source: string;
}

export interface BenchResults {
  format: typeof RESULTS_FORMAT;
  generatedAt: string;
  seed: number;
  environment: { runtime: string; platform: string; note: string };
  suites: Partial<Record<SuiteId, SuiteResult>>;
  budgets: Budget[];
  web?: { lighthouse?: Record<string, number>; lcpMs?: number; measuredAt?: string; url?: string; note?: string };
}

export async function runSuite(id: SuiteId, env: SuiteEnv): Promise<SuiteResult> {
  switch (id) {
    case "drift":
      return driftSuite(env);
    case "dates":
      return datesSuite(env);
    case "invariants":
      return invariantsSuite(env);
    case "calibration":
      return calibrationSuite(env);
    case "injection":
      return injectionSuite(env);
    case "guard":
      return guardSuite(env);
    case "distillation":
      return distillationSuite(env);
    case "selectors":
      return selectorSuite(env);
    case "idempotency":
      return idempotencySuite(env);
    case "latency":
      return latencySuite(env);
  }
}

function fmtMs(x: number | undefined) {
  return x === undefined ? "not measured" : `${x.toFixed(x < 10 ? 2 : 1)} ms`;
}

export function computeBudgets(suites: BenchResults["suites"], web?: BenchResults["web"]): Budget[] {
  const lat = suites.latency?.timing ?? {};
  const batchP95 = [1, 2, 3, 4, 5].map((n) => lat[`batch100Node${n}P95Ms`]).filter((v): v is number => typeof v === "number");
  const worst = batchP95.length ? Math.max(...batchP95) : undefined;
  const distill = suites.distillation?.timing?.distillP95Ms;
  const heal = suites.selectors?.timing?.healP95Ms;
  const env = suites.latency?.environment ?? "node";
  const budgets: Budget[] = [
    { item: "Nodes 1-5, 100-row batch (p95, worst node)", target: "under 50 ms per node", measured: fmtMs(worst), met: worst === undefined ? null : worst < 50, source: `latency suite (${env})` },
    { item: "Distillation of one portal page (p95)", target: "under 20 ms", measured: fmtMs(distill), met: distill === undefined ? null : distill < 20, source: "distillation suite (jsdom in Node; browsers are faster)" },
    { item: "Selector heal, one element (p95)", target: "under 20 ms", measured: fmtMs(heal), met: heal === undefined ? null : heal < 20, source: "selector suite" },
  ];
  const lh = web?.lighthouse;
  budgets.push({ item: "Landing page LCP", target: "under 2.5 s", measured: web?.lcpMs !== undefined ? `${(web.lcpMs / 1000).toFixed(2)} s` : "not measured", met: web?.lcpMs === undefined ? null : web.lcpMs < 2500, source: web?.lcpMs !== undefined ? `Lighthouse (${web.url ?? "local"})` : "npm run lighthouse -- <url>" });
  budgets.push({
    item: "Lighthouse performance / accessibility / best practices",
    target: ">= 90 / >= 95 / >= 95",
    measured: lh ? `${lh.performance} / ${lh.accessibility} / ${lh.bestPractices}` : "not measured",
    met: lh ? lh.performance >= 90 && lh.accessibility >= 95 && lh.bestPractices >= 95 : null,
    source: lh ? `Lighthouse (${web?.url ?? "local"})` : "npm run lighthouse -- <url>",
  });
  budgets.push({ item: "Console playback", target: "60 fps on a mid-range laptop", measured: "shown live in the console", met: null, source: "frame meter in the console" });
  return budgets;
}

/** Fields that depend on wall-clock time or the machine; excluded from the committed-results check. */
export function deterministicView(r: BenchResults): unknown {
  const suites: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(r.suites)) {
    if (!s || id === "latency") continue;
    suites[id] = { id: s.id, cases: s.cases, seed: s.seed, metrics: s.metrics };
  }
  return suites;
}
