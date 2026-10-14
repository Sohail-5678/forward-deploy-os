/**
 * "Fuzz this transform": a real fast-check property test run in the browser
 * against the current TransformSpec. Random canonical records are rendered
 * into the source formats the spec claims to understand, healed back, and
 * must round-trip exactly with every invariant passing. fast-check shrinks
 * any failure to a minimal counterexample.
 */
import fc from "fast-check";
import type { ContractDef, FieldKind, TransformSpec } from "@/engine/types";
import { applySpec } from "@/engine/etl/schema-healer";
import { runInvariants } from "@/engine/etl/invariants";
import { renderDate, renderMoney, renderRate, type DateRender, type MoneyFormat } from "@/engine/data/render";
import { formatIban } from "@/engine/iban";
import { VENDOR_MASTER } from "@/engine/data/scenarios";
import { DEFAULT_FISCAL_WINDOW } from "@/engine/config";
import type { FuzzResult } from "@/lib/worker-protocol";

const DATE_RENDER: Record<string, DateRender> = {
  "YYYY-MM-DD": "iso",
  "DD.MM.YYYY": "dotted",
  "DD/MM/YYYY": "slash_dmy",
  "MM/DD/YYYY": "slash_mdy",
  YYYYMMDD: "compact",
};

function arbForKind(kind: FieldKind): fc.Arbitrary<string | number> {
  switch (kind) {
    case "vendorId":
      return fc.integer({ min: 1000, max: 9999 }).map((n) => `V-${n}`);
    case "customerId":
      return fc.integer({ min: 1000, max: 9999 }).map((n) => `C-${n}`);
    case "poNumber":
      return fc.integer({ min: 10000, max: 99999 }).map((n) => `PO-${n}`);
    case "invoiceNumber":
      return fc.tuple(fc.constantFrom("INV", "BILL"), fc.constantFrom("AG", "GF", "MC", "TX"), fc.integer({ min: 1, max: 99999 })).map(([a, b, n]) => `${a}-${b}-${n}`);
    case "date":
      return fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2027, 11, 31) }).map((t) => new Date(t).toISOString().slice(0, 10));
    case "money":
      return fc.integer({ min: 1, max: 99_999_999 });
    case "rate":
      return fc.integer({ min: 0, max: 2500 }).map((bps) => bps / 10000);
    case "int":
      return fc.integer({ min: 1, max: 999 });
    case "iban":
      return fc.constantFrom(...VENDOR_MASTER.map((v) => v.iban));
    case "text":
      return fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[\r\n,"]/g, "x").trim() || "x");
  }
}

export function fuzzTransform(spec: TransformSpec, contract: ContractDef, numRuns: number, seed: number, onProgress: (done: number) => void): FuzzResult {
  const t0 = performance.now();
  const mappings = spec.mappings.filter((m) => contract.fields.some((f) => f.key === m.target));
  if (spec.dateDecision?.status === "ambiguous") {
    return { numRuns: 0, passed: 0, failed: true, ms: 0, seed, counterexample: { record: {}, row: {}, error: "The date format is still ambiguous; a human must decide before this transform can be fuzzed.", shrinks: 0 } };
  }
  const fieldArbs: Record<string, fc.Arbitrary<string | number>> = {};
  const renderArbs: Record<string, fc.Arbitrary<string>> = {};
  for (const m of mappings) {
    const field = contract.fields.find((f) => f.key === m.target)!;
    fieldArbs[m.target] = arbForKind(field.kind);
    const ops = m.normalizers.map((n) => n.op);
    const currency = m.normalizers.find((n) => n.op === "parseCurrency") as { locale: "en-US" | "de-DE" } | undefined;
    const date = m.normalizers.find((n) => n.op === "parseDate") as { format: string } | undefined;
    if (currency) renderArbs[m.target] = currency.locale === "de-DE" ? fc.constant("de") : fc.constantFrom<MoneyFormat>("canonical", "usd_suffix", "usd_prefix", "dollar", "plain_commas");
    else if (date) renderArbs[m.target] = fc.constant(DATE_RENDER[date.format] ?? "iso");
    else if (ops.includes("parsePercent")) renderArbs[m.target] = fc.constantFrom("percent", "percent_space", "fraction");
    else if (ops.includes("removeWhitespace")) renderArbs[m.target] = fc.constantFrom("spaced", "compact");
    else if (ops.includes("upper")) renderArbs[m.target] = fc.constantFrom("canonical", "lower", "padded");
    else renderArbs[m.target] = fc.constant("plain");
  }
  const render = (kind: FieldKind, value: string | number, how: string): string => {
    switch (kind) {
      case "money":
        return renderMoney(Number(value), how as MoneyFormat);
      case "date":
        return renderDate(String(value), how as DateRender);
      case "rate":
        return renderRate(Number(value), how as "percent" | "percent_space" | "fraction");
      case "iban":
        return how === "spaced" ? formatIban(String(value)) : String(value);
      case "int":
        return String(value);
      default:
        return how === "lower" ? String(value).toLowerCase() : how === "padded" ? `  ${value} ` : String(value);
    }
  };
  let done = 0;
  let lastError = "";
  let lastRow: Record<string, string> = {};
  const property = fc.property(fc.record(fieldArbs), fc.record(renderArbs), (rec, how) => {
    done++;
    if (done % 15 === 0) onProgress(done);
    const row: Record<string, string> = {};
    for (const h of spec.unmappedSource) row[h] = "";
    for (const m of mappings) {
      const field = contract.fields.find((f) => f.key === m.target)!;
      row[m.source] = render(field.kind, rec[m.target], how[m.target]);
    }
    lastRow = row;
    const table = { fileId: "fuzz", headers: Object.keys(row), rows: [row], delimiter: ",", bom: false, lineEnding: "\n" as const, warnings: [] };
    const out = applySpec(table, spec, contract);
    const values = out.outputs.get(0);
    if (!values) {
      lastError = out.errors.map((e) => `${e.field}: ${e.message}`).join("; ") || "row rejected";
      return false;
    }
    for (const m of mappings) {
      if (values[m.target] !== rec[m.target]) {
        lastError = `${m.target}: expected ${JSON.stringify(rec[m.target])}, got ${JSON.stringify(values[m.target])}`;
        return false;
      }
    }
    const inv = runInvariants({ table, spec, contract, output: out, ledger: [], fiscalWindow: { ...DEFAULT_FISCAL_WINDOW } });
    const failed = inv.find((i) => !i.passed);
    if (failed) {
      lastError = `${failed.name}: ${failed.detail}`;
      return false;
    }
    return true;
  });
  const result = fc.check(property, { numRuns, seed });
  onProgress(numRuns);
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  if (!result.failed) return { numRuns, passed: result.numRuns, failed: false, ms, seed };
  // Re-evaluate the shrunk counterexample to report its row and error.
  const [rec, how] = result.counterexample as [Record<string, string | number>, Record<string, string>];
  const row: Record<string, string> = {};
  for (const m of mappings) {
    const field = contract.fields.find((f) => f.key === m.target)!;
    row[m.source] = render(field.kind, rec[m.target], how[m.target]);
  }
  void lastRow;
  return { numRuns, passed: Math.max(0, result.numRuns - 1), failed: true, ms, seed, counterexample: { record: rec, row, error: lastError, shrinks: result.numShrinks } };
}
