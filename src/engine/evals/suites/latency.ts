/**
 * Latency per node (p50 / p95) on every scenario, plus the 100-row budget
 * batch from spec 13.2. These are wall-clock numbers from whatever machine
 * runs the suite, so they are reported with their environment and excluded
 * from the committed-results drift check.
 */
import type { SuiteEnv, SuiteResult } from "../types";
import type { BatchInput, NodeId } from "../../types";
import { createRun, runToPause } from "../../agent/graph";
import { scenarioConfig, ERP_PURCHASE_ORDERS, VENDOR_MASTER } from "../../data/scenarios";
import { baseConfig } from "../../config";
import { fixedClock, now } from "../../clock";
import { percentile, round } from "../stats";
import { createRng } from "../../seed";
import { generateDriftedFile } from "../../data/generators";
import { sha256Hex } from "../../hash";

const NODES: NodeId[] = [1, 2, 3, 4, 5];

export async function latencySuite(env: SuiteEnv, reps = 5): Promise<SuiteResult> {
  if (!env.loadScenario) throw new Error("latency suite needs a scenario loader");
  const t0 = now();
  const perNode: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const perScenario: Record<string, Record<number, number>> = {};
  let done = 0;
  const totalSteps = 5 * reps + 20;
  for (const id of [1, 2, 3, 4, 5] as const) {
    const input = await env.loadScenario(id);
    for (let r = 0; r < reps; r++) {
      const clock = fixedClock();
      const run = await runToPause(createRun(input, scenarioConfig(id), { clock, runId: `run_lat_${id}_${r}` }), { clock, nonce: () => "a8f92c" }, { stopBefore: 6 });
      for (const n of NODES) {
        const ms = run.state.nodeMs[n];
        if (ms !== undefined) perNode[n].push(ms);
      }
      if (r === reps - 1) perScenario[`scenario-${id}`] = Object.fromEntries(NODES.map((n) => [n, round(run.state.nodeMs[n] ?? 0, 2)]));
      env.progress?.(++done, totalSteps);
    }
  }
  // Budget batch: one 100-row drifted file, nodes 1-5, 20 repetitions.
  const rng = createRng(env.seed ^ 0x100);
  const f = generateDriftedFile(rng, { rows: 100, difficulty: "medium" });
  const batch: BatchInput = {
    files: [{ id: "batch-100", name: "batch_100_rows.csv", kind: "csv", text: f.csv, sha256: sha256Hex(f.csv) }],
    pdfs: [],
    notes: [],
    erp: ERP_PURCHASE_ORDERS,
    vendorMaster: VENDOR_MASTER,
    ledger: [],
  };
  const batchNode: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (let r = 0; r < 20; r++) {
    const clock = fixedClock();
    const run = await runToPause(createRun(batch, baseConfig("sandbox"), { clock, runId: `run_batch_${r}` }), { clock, nonce: () => "a8f92c" }, { stopBefore: 6 });
    for (const n of NODES) batchNode[n].push(run.state.nodeMs[n] ?? 0);
    env.progress?.(++done, totalSteps);
  }
  const timing: Record<string, number> = {};
  for (const n of NODES) {
    timing[`node${n}P50Ms`] = round(percentile(perNode[n], 50), 3);
    timing[`node${n}P95Ms`] = round(percentile(perNode[n], 95), 3);
    timing[`batch100Node${n}P95Ms`] = round(percentile(batchNode[n], 95), 3);
  }
  return {
    id: "latency",
    title: "Latency per node",
    cases: 5 * reps + 20,
    seed: env.seed ^ 0x100,
    metrics: { scenarios: 5, repetitions: reps, batchRows: 100, batchRepetitions: 20, lastRunByScenario: perScenario },
    timing,
    ms: round(now() - t0, 1),
    environment: env.environment ?? "node",
  };
}
