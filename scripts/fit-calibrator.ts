/**
 * Fits the logistic-regression calibrator on 70% of the calibration set and
 * evaluates it on the held-out 30% (Brier score, ECE with 10 bins), next to
 * the uncalibrated heuristic baseline. Writes src/engine/agent/calibration.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { FEATURE_NAMES, brierScore, expectedCalibrationError, fitLogistic, heuristicScore, sigmoid, toArray, type CalibrationModel } from "../src/engine/agent/calibrator";
import type { CalibrationCase } from "../src/engine/evals/calibration-data";
import { createRng } from "../src/engine/seed";

async function main() {
  const raw = JSON.parse(await readFile("benchmarks/calibration-set.json", "utf8")) as { seed: number; cases: CalibrationCase[] };
  const rng = createRng(raw.seed ^ 0x5eed);
  const shuffled = rng.shuffle(raw.cases);
  const cut = Math.floor(shuffled.length * 0.7);
  const train = shuffled.slice(0, cut);
  const test = shuffled.slice(cut);

  const model = fitLogistic(train.map((c) => ({ x: toArray(c.features), y: c.label })), { epochs: 4000, lr: 0.8, l2: 5e-4 });
  const preds = test.map((c) => {
    const x = toArray(c.features);
    let z = model.bias;
    x.forEach((v, i) => (z += model.weights[i] * v));
    return sigmoid(z);
  });
  const labels = test.map((c) => c.label);
  const base = test.map((c) => heuristicScore(c.features));
  const { ece, reliability } = expectedCalibrationError(preds, labels);
  const baselineEce = expectedCalibrationError(base, labels).ece;

  const out: CalibrationModel = {
    features: FEATURE_NAMES,
    weights: model.weights,
    bias: model.bias,
    trainedOn: train.length,
    heldOut: test.length,
    seed: raw.seed,
    metrics: {
      brier: Math.round(brierScore(preds, labels) * 10000) / 10000,
      ece,
      baselineBrier: Math.round(brierScore(base, labels) * 10000) / 10000,
      baselineEce,
      reliability,
    },
    fittedAt: "scripts/fit-calibrator.ts",
  };
  await writeFile("src/engine/agent/calibration.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Fitted on ${train.length}, held out ${test.length}. Brier ${out.metrics.brier} (baseline ${out.metrics.baselineBrier}), ECE ${out.metrics.ece} (baseline ${out.metrics.baselineEce}).`);
  console.log("weights:", FEATURE_NAMES.map((n, i) => `${n}=${model.weights[i]}`).join(" "), "bias", model.bias);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
