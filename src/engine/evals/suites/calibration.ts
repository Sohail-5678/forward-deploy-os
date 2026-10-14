/**
 * Calibration suite and the single fitting procedure shared with
 * scripts/fit-calibrator.ts, so the live re-run reproduces the committed model.
 */
import type { SuiteEnv, SuiteResult } from "../types";
import { generateCalibrationSet, type CalibrationCase } from "../calibration-data";
import { brierScore, expectedCalibrationError, FEATURE_NAMES, fitLogistic, heuristicScore, sigmoid, thresholdTradeoff, toArray, type CalibrationModel } from "../../agent/calibrator";
import { createRng } from "../../seed";
import { now } from "../../clock";
import { round } from "../stats";

export const CALIBRATION_SEED = 8_312_026;
export const CALIBRATION_SIZE = 1000;
export const TRADEOFF_THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.99];

export function fitCalibration(cases: CalibrationCase[], seed: number) {
  const rng = createRng(seed ^ 0x5eed);
  const shuffled = rng.shuffle(cases);
  const cut = Math.floor(shuffled.length * 0.7);
  const train = shuffled.slice(0, cut);
  const test = shuffled.slice(cut);
  const model = fitLogistic(train.map((c) => ({ x: toArray(c.features), y: c.label })), { epochs: 4000, lr: 0.8, l2: 5e-4 });
  const preds = test.map((c) => {
    let z = model.bias;
    toArray(c.features).forEach((v, i) => (z += model.weights[i] * v));
    return sigmoid(z);
  });
  const labels = test.map((c) => c.label);
  const base = test.map((c) => heuristicScore(c.features));
  const cal = expectedCalibrationError(preds, labels);
  const baseCal = expectedCalibrationError(base, labels);
  const out: CalibrationModel = {
    features: FEATURE_NAMES,
    weights: model.weights,
    bias: model.bias,
    trainedOn: train.length,
    heldOut: test.length,
    seed,
    metrics: {
      brier: round(brierScore(preds, labels)),
      ece: cal.ece,
      baselineBrier: round(brierScore(base, labels)),
      baselineEce: baseCal.ece,
      reliability: cal.reliability,
    },
    fittedAt: "scripts/fit-calibrator.ts",
  };
  return { model: out, preds, labels, base, baselineReliability: baseCal.reliability };
}

export function calibrationSuite(env: SuiteEnv): SuiteResult {
  const t0 = now();
  const cases = generateCalibrationSet(CALIBRATION_SEED, CALIBRATION_SIZE);
  env.progress?.(1, 3);
  const fit = fitCalibration(cases, CALIBRATION_SEED);
  env.progress?.(2, 3);
  const tradeoff = thresholdTradeoff(fit.preds, fit.labels, TRADEOFF_THRESHOLDS);
  const baseTradeoff = thresholdTradeoff(fit.base, fit.labels, TRADEOFF_THRESHOLDS);
  env.progress?.(3, 3);
  const safe = cases.filter((c) => c.label === 1).length;
  return {
    id: "calibration",
    title: "Reconciliation and calibration",
    cases: cases.length,
    seed: CALIBRATION_SEED,
    baseline: "uncalibrated heuristic score (fraction of agreeing fields)",
    metrics: {
      heldOut: fit.model.heldOut,
      trainedOn: fit.model.trainedOn,
      safeFraction: round(safe / cases.length),
      brier: fit.model.metrics.brier,
      ece: fit.model.metrics.ece,
      baselineBrier: fit.model.metrics.baselineBrier,
      baselineEce: fit.model.metrics.baselineEce,
      reliability: fit.model.metrics.reliability,
      baselineReliability: fit.baselineReliability,
      tradeoff,
      baselineTradeoff: baseTradeoff,
      weights: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, fit.model.weights[i]])),
      bias: fit.model.bias,
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}
