/**
 * Fits the logistic-regression calibrator on 70% of the seeded calibration set
 * and evaluates it on the held-out 30% (Brier score, ECE with 10 bins), next
 * to the uncalibrated heuristic baseline. Writes src/engine/agent/calibration.json.
 * The procedure lives in the engine so the live benchmark re-run reproduces it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fitCalibration } from "../src/engine/evals/suites/calibration";
import type { CalibrationCase } from "../src/engine/evals/calibration-data";

async function main() {
  const raw = JSON.parse(await readFile("benchmarks/calibration-set.json", "utf8")) as { seed: number; cases: CalibrationCase[] };
  const { model } = fitCalibration(raw.cases, raw.seed);
  await writeFile("src/engine/agent/calibration.json", JSON.stringify(model, null, 2) + "\n");
  console.log(`Fitted on ${model.trainedOn}, held out ${model.heldOut}. Brier ${model.metrics.brier} (baseline ${model.metrics.baselineBrier}), ECE ${model.metrics.ece} (baseline ${model.metrics.baselineEce}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
