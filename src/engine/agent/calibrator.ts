/**
 * Calibrated confidence (spec 8.3). Logistic regression in plain TypeScript,
 * fitted by scripts/fit-calibrator.ts on a seeded, labeled synthetic set
 * (70% train / 30% held out). Coefficients and the held-out Brier score and
 * ECE live in calibration.json; "calibrated" is only claimed because that
 * file exists and reports its error (rule T3).
 */
import calibration from "./calibration.json";

export const FEATURE_NAMES = [
  "agree_frac",
  "amount_abs_delta_log",
  "amount_rel_delta",
  "pdf_csv_amount_mismatch",
  "mapping_score",
  "normalizer_load",
  "pdf_missing_frac",
  "pdf_ambiguity",
  "has_pdf",
  "vendor_known",
  "payee_match",
  "po_found",
  "security_signal",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

export interface CalibrationModel {
  features: readonly string[];
  weights: number[];
  bias: number;
  trainedOn: number;
  heldOut: number;
  seed: number;
  metrics: {
    brier: number;
    ece: number;
    baselineBrier: number;
    baselineEce: number;
    reliability: { bin: number; predicted: number; observed: number; count: number }[];
  };
  fittedAt: string;
}

export const MODEL = calibration as CalibrationModel;

export function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function toArray(f: FeatureVector): number[] {
  return FEATURE_NAMES.map((n) => f[n]);
}

export function predict(f: FeatureVector, model: Pick<CalibrationModel, "weights" | "bias"> = MODEL): number {
  const x = toArray(f);
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += (model.weights[i] ?? 0) * x[i];
  return sigmoid(z);
}

/** Uncalibrated baseline: fraction of agreeing fields. */
export function heuristicScore(f: FeatureVector): number {
  return f.agree_frac;
}

// ---------------------------------------------------------------------------
// Fitting and evaluation (used by the fit script and the live benchmark)
// ---------------------------------------------------------------------------

export interface LabeledExample {
  x: number[];
  y: 0 | 1;
}

export function fitLogistic(train: LabeledExample[], opts: { epochs?: number; lr?: number; l2?: number } = {}): { weights: number[]; bias: number } {
  const epochs = opts.epochs ?? 1500;
  const lr = opts.lr ?? 0.5;
  const l2 = opts.l2 ?? 1e-3;
  const d = train[0]?.x.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const n = train.length;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (const ex of train) {
      let z = b;
      for (let i = 0; i < d; i++) z += w[i] * ex.x[i];
      const err = sigmoid(z) - ex.y;
      for (let i = 0; i < d; i++) gw[i] += err * ex.x[i];
      gb += err;
    }
    for (let i = 0; i < d; i++) w[i] -= lr * (gw[i] / n + l2 * w[i]);
    b -= lr * (gb / n);
  }
  return { weights: w.map((v) => Math.round(v * 1e6) / 1e6), bias: Math.round(b * 1e6) / 1e6 };
}

export function brierScore(preds: number[], labels: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) s += (preds[i] - labels[i]) ** 2;
  return preds.length ? s / preds.length : 0;
}

/** Expected Calibration Error with equal-width bins (default 10). */
export function expectedCalibrationError(preds: number[], labels: number[], bins = 10) {
  const table = Array.from({ length: bins }, (_, i) => ({ bin: i, sumP: 0, sumY: 0, count: 0 }));
  for (let i = 0; i < preds.length; i++) {
    const b = Math.min(bins - 1, Math.floor(preds[i] * bins));
    table[b].sumP += preds[i];
    table[b].sumY += labels[i];
    table[b].count++;
  }
  let ece = 0;
  const reliability = table.map((t) => {
    const predicted = t.count ? t.sumP / t.count : 0;
    const observed = t.count ? t.sumY / t.count : 0;
    ece += (t.count / Math.max(1, preds.length)) * Math.abs(predicted - observed);
    return { bin: t.bin, predicted: round(predicted), observed: round(observed), count: t.count };
  });
  return { ece: round(ece), reliability };
}

export function thresholdTradeoff(preds: number[], labels: number[], thresholds: number[]) {
  return thresholds.map((t) => {
    let auto = 0;
    let wrong = 0;
    for (let i = 0; i < preds.length; i++) {
      if (preds[i] >= t) {
        auto++;
        if (labels[i] === 0) wrong++;
      }
    }
    return { threshold: t, autoPostRate: round(auto / Math.max(1, preds.length)), errorRate: round(auto ? wrong / auto : 0), autoPosted: auto, wrong };
  });
}

const round = (x: number) => Math.round(x * 10000) / 10000;
