/**
 * ETL suites: schema drift healing (200 seeded files, exact-name baseline,
 * McNemar), ambiguous dates (40 files that must escalate, plus 40 decidable
 * controls), and invariant detection of planted bugs (100 files).
 */
import type { SuiteEnv, SuiteResult } from "../types";
import { createRng } from "../../seed";
import { generateDriftedFile } from "../../data/generators";
import { parseCsv } from "../../etl/csv";
import { applySpec, healFile, synthesizeSpec } from "../../etl/schema-healer";
import { exactNameMatcher } from "../../etl/matcher";
import { CONTRACT_V1 } from "../../etl/contract";
import { runInvariants } from "../../etl/invariants";
import { DEFAULT_FISCAL_WINDOW } from "../../config";
import { mcnemar, rate, round } from "../stats";
import { now } from "../../clock";
import type { CanonicalField } from "../../types";
import { CANONICAL_FIELDS } from "../../etl/contract";

const fiscalWindow = { ...DEFAULT_FISCAL_WINDOW };

export function driftSuite(env: SuiteEnv, files = 200): SuiteResult {
  const t0 = now();
  const rng = createRng(env.seed ^ 0xd41f7);
  let fieldsTotal = 0;
  let fieldsOk = 0;
  let baseFieldsOk = 0;
  let healed = 0;
  let baseHealed = 0;
  let b = 0;
  let c = 0;
  const byDifficulty: Record<string, { files: number; healed: number }> = {};
  const perField: Record<string, { ok: number; total: number }> = {};
  for (let i = 0; i < files; i++) {
    const difficulty = i % 10 < 4 ? "easy" : i % 10 < 7 ? "medium" : "hard";
    const r = rng.fork(`file-${i}`);
    const f = generateDriftedFile(r, { rows: r.int(4, 18), difficulty });
    const table = parseCsv(f.csv, `bench-${i}`);
    const { spec } = synthesizeSpec(table, CONTRACT_V1);
    const truthBySource = f.truth;
    let fileOk = true;
    let baseOk = true;
    const baseline = exactNameMatcher(table.headers, CONTRACT_V1);
    for (const field of CANONICAL_FIELDS) {
      const trueSource = Object.entries(truthBySource).find(([, v]) => v === field)?.[0];
      const predicted = spec.mappings.find((m) => m.target === field)?.source;
      const basePred = baseline.find((m) => m.target === field)?.source;
      fieldsTotal++;
      perField[field] ??= { ok: 0, total: 0 };
      perField[field].total++;
      if (predicted && predicted === trueSource) {
        fieldsOk++;
        perField[field].ok++;
      } else fileOk = false;
      if (basePred && basePred === trueSource) baseFieldsOk++;
      else baseOk = false;
    }
    // A file is healed only if every field mapped correctly AND every row came out with the true values.
    let rowsOk = false;
    if (fileOk) {
      const h = healFile(table, CONTRACT_V1, { ledger: [], fiscalWindow });
      rowsOk =
        h.promoted.length === f.records.length &&
        h.promoted.every((p, k) => JSON.stringify(p.invoice) === JSON.stringify(f.records[k]));
    }
    const ours = fileOk && rowsOk;
    // Baseline heals a file only when every column already had its canonical name and canonical formats.
    const baseFormatsCanonical = f.formats.money === "canonical" && f.formats.date === "iso" && f.formats.rate === "fraction" && f.formats.iban === "compact" && f.formats.id === "canonical";
    const theirs = baseOk && baseFormatsCanonical;
    if (ours) healed++;
    if (theirs) baseHealed++;
    if (ours && !theirs) b++;
    if (!ours && theirs) c++;
    const d = (byDifficulty[difficulty] ??= { files: 0, healed: 0 });
    d.files++;
    if (ours) d.healed++;
    env.progress?.(i + 1, files);
  }
  return {
    id: "drift",
    title: "Schema drift healing",
    cases: files,
    seed: env.seed,
    baseline: "exact-name matcher",
    metrics: {
      fieldMappingAccuracy: rate(fieldsOk, fieldsTotal),
      baselineFieldMappingAccuracy: rate(baseFieldsOk, fieldsTotal),
      fullFileHealRate: rate(healed, files),
      baselineFullFileHealRate: rate(baseHealed, files),
      mcnemar: mcnemar(b, c),
      byDifficulty: Object.fromEntries(Object.entries(byDifficulty).map(([k, v]) => [k, { files: v.files, healRate: rate(v.healed, v.files) }])),
      perField: Object.fromEntries(Object.entries(perField).map(([k, v]) => [k, rate(v.ok, v.total)])) as Record<CanonicalField, number>,
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}

export function datesSuite(env: SuiteEnv, files = 40): SuiteResult {
  const t0 = now();
  const rng = createRng(env.seed ^ 0xda7e5);
  let escalated = 0;
  let guessed = 0;
  let controlsOk = 0;
  let controlFalseEscalations = 0;
  for (let i = 0; i < files; i++) {
    const r = rng.fork(`amb-${i}`);
    const f = generateDriftedFile(r, { rows: r.int(2, 12), difficulty: "easy", ambiguousDates: true, formats: { date: i % 2 ? "slash_dmy" : "slash_mdy" } });
    const h = healFile(parseCsv(f.csv, `amb-${i}`), CONTRACT_V1, { ledger: [], fiscalWindow });
    if (h.spec.dateDecision?.status === "ambiguous" && h.promoted.length === 0) escalated++;
    else guessed++;
    const rc = rng.fork(`ctl-${i}`);
    const ctl = generateDriftedFile(rc, { rows: rc.int(2, 12), difficulty: "easy", formats: { date: i % 2 ? "slash_dmy" : "slash_mdy" } });
    const hc = healFile(parseCsv(ctl.csv, `ctl-${i}`), CONTRACT_V1, { ledger: [], fiscalWindow });
    if (hc.spec.dateDecision?.status === "decided" && hc.promoted.every((p, k) => p.invoice.invoice_date === ctl.records[k].invoice_date)) controlsOk++;
    if (hc.spec.dateDecision?.status === "ambiguous") controlFalseEscalations++;
    env.progress?.(i + 1, files);
  }
  return {
    id: "dates",
    title: "Ambiguous dates",
    cases: files,
    seed: env.seed,
    metrics: {
      correctlyEscalatedRate: rate(escalated, files),
      guessed,
      decidableControls: files,
      decidableControlsCorrect: rate(controlsOk, files),
      falseEscalations: controlFalseEscalations,
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}

type Bug = "dropped-row" | "rounding" | "duplicate-key";
const EXPECTED: Record<Bug, string> = { "dropped-row": "ROW_COUNT_CONSERVED", rounding: "MONEY_SUM_CONSERVED", "duplicate-key": "PRIMARY_KEY_VALID" };

export function invariantsSuite(env: SuiteEnv, files = 100): SuiteResult {
  const t0 = now();
  const rng = createRng(env.seed ^ 0x1a7a);
  const stats: Record<Bug, { planted: number; detected: number; detectedByExpected: number }> = {
    "dropped-row": { planted: 0, detected: 0, detectedByExpected: 0 },
    rounding: { planted: 0, detected: 0, detectedByExpected: 0 },
    "duplicate-key": { planted: 0, detected: 0, detectedByExpected: 0 },
  };
  let cleanFalseAlarms = 0;
  for (let i = 0; i < files; i++) {
    const bug: Bug = (["dropped-row", "rounding", "duplicate-key"] as const)[i % 3];
    const r = rng.fork(`inv-${i}`);
    const f = generateDriftedFile(r, { rows: r.int(3, 15), difficulty: "easy" });
    const table = parseCsv(f.csv, `inv-${i}`);
    const { spec } = synthesizeSpec(table, CONTRACT_V1);
    const clean = applySpec(table, spec, CONTRACT_V1);
    const cleanResults = runInvariants({ table, spec, contract: CONTRACT_V1, output: clean, ledger: [], fiscalWindow });
    if (cleanResults.some((x) => !x.passed)) cleanFalseAlarms++;
    // Plant one bug in a copy of the transform output (a buggy transform).
    const out = { outputs: new Map(clean.outputs), errors: [...clean.errors], failedRows: new Set(clean.failedRows) };
    const keys = [...out.outputs.keys()];
    if (keys.length < 2) continue;
    const victim = keys[r.int(0, keys.length - 1)];
    const moneyTarget = spec.mappings.find((m) => m.target === "gross_amount_usd")?.target ?? "gross_amount_usd";
    const invTarget = spec.mappings.find((m) => m.target === "invoice_number")?.target ?? "invoice_number";
    if (bug === "dropped-row") out.outputs.delete(victim);
    if (bug === "rounding") {
      const row = { ...out.outputs.get(victim)! };
      const cents = Number(row[moneyTarget]);
      const rounded = Math.round(cents / 100) * 100;
      row[moneyTarget] = rounded === cents ? cents + 1 : rounded;
      out.outputs.set(victim, row);
    }
    if (bug === "duplicate-key") {
      const other = keys.find((k) => k !== victim)!;
      const row = { ...out.outputs.get(victim)! };
      row[invTarget] = out.outputs.get(other)![invTarget];
      out.outputs.set(victim, row);
    }
    const results = runInvariants({ table, spec, contract: CONTRACT_V1, output: out, ledger: [], fiscalWindow });
    stats[bug].planted++;
    if (results.some((x) => !x.passed)) stats[bug].detected++;
    if (results.find((x) => x.name === EXPECTED[bug])?.passed === false) stats[bug].detectedByExpected++;
    env.progress?.(i + 1, files);
  }
  const planted = Object.values(stats).reduce((s, v) => s + v.planted, 0);
  const detected = Object.values(stats).reduce((s, v) => s + v.detected, 0);
  return {
    id: "invariants",
    title: "Invariant checks on planted bugs",
    cases: files,
    seed: env.seed,
    metrics: {
      detectionRate: rate(detected, planted),
      perBug: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { planted: v.planted, detectionRate: rate(v.detected, v.planted), caughtByExpectedInvariant: rate(v.detectedByExpected, v.planted) }])),
      cleanFileFalseAlarms: cleanFalseAlarms,
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}
