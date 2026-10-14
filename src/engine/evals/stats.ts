/** Small statistics helpers for the benchmark suites. */

/** Complementary error function (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/**
 * McNemar's test on paired binary outcomes (with continuity correction).
 * b = ours succeeded and baseline failed, c = ours failed and baseline succeeded.
 */
export function mcnemar(b: number, c: number): { b: number; c: number; chi2: number; pValue: number } {
  if (b + c === 0) return { b, c, chi2: 0, pValue: 1 };
  const chi2 = (Math.abs(b - c) - 1) ** 2 / (b + c);
  // chi-square with 1 degree of freedom: P(X > chi2) = erfc(sqrt(chi2 / 2))
  const pValue = erfc(Math.sqrt(chi2 / 2));
  return { b, c, chi2: round(chi2, 4), pValue: pValue < 1e-12 ? 0 : Number(pValue.toPrecision(3)) };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function rate(n: number, d: number): number {
  return d === 0 ? 0 : round(n / d, 4);
}
