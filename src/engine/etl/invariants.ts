/**
 * The 5 runtime invariant checks (spec 8.2). Before any row leaves quarantine,
 * the TransformSpec is applied to the whole batch and these must hold.
 * (Named "invariant checks", not property tests: rule T3.)
 */
import type { ContractDef, InvariantResult, LedgerEntry, TransformSpec } from "../types";
import type { ParsedTable } from "./csv";
import type { TransformOutput } from "./schema-healer";
import { applyNormalizers, canonicalNormalizers, independentMoneyCents, renderCanonical } from "./normalizers";
import { idempotencyKey } from "./idempotency";
import { now } from "../clock";

export interface InvariantInput {
  table: ParsedTable;
  spec: TransformSpec;
  contract: ContractDef;
  output: TransformOutput;
  ledger: LedgerEntry[];
  fiscalWindow: { start: string; end: string };
  /** Optional second application of the spec, used to prove key stability. */
  reapply?: () => TransformOutput;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function timed(name: InvariantResult["name"], fn: () => Omit<InvariantResult, "name" | "ms">): InvariantResult {
  const t0 = now();
  const r = fn();
  return { name, ...r, ms: Math.round((now() - t0) * 1000) / 1000 };
}

export function runInvariants(input: InvariantInput): InvariantResult[] {
  const { table, spec, contract, output } = input;
  const fieldByKey = new Map(contract.fields.map((f) => [f.key, f]));
  const mappingFor = (canonical: string) => {
    const f = contract.fields.find((x) => x.canonical === canonical);
    return f ? spec.mappings.find((m) => m.target === f.key) : undefined;
  };

  const rowCount = timed("ROW_COUNT_CONSERVED", () => {
    const n = table.rows.length;
    const missing: number[] = [];
    const both: number[] = [];
    for (let i = 0; i < n; i++) {
      const out = output.outputs.has(i);
      const failed = output.failedRows.has(i);
      if (!out && !failed) missing.push(i);
      if (out && failed) both.push(i);
    }
    const transformed = output.outputs.size;
    const rejected = output.failedRows.size;
    const passed = missing.length === 0 && both.length === 0 && transformed + rejected === n;
    return {
      passed,
      detail: `${n} rows in, ${transformed} transformed + ${rejected} rejected = ${transformed + rejected} out${missing.length ? `; ${missing.length} silently dropped` : ""}`,
      offendingRows: [...missing, ...both],
    };
  });

  const moneySum = timed("MONEY_SUM_CONSERVED", () => {
    const moneyMappings = spec.mappings.filter((m) => fieldByKey.get(m.target)?.kind === "money");
    if (moneyMappings.length === 0) return { passed: true, detail: "no money field mapped", offendingRows: [] };
    let sumIn = 0;
    let sumOut = 0;
    const offending: number[] = [];
    for (const [idx, values] of output.outputs) {
      for (const m of moneyMappings) {
        const raw = table.rows[idx]?.[m.source] ?? "";
        const independent = independentMoneyCents(raw);
        const transformed = Number(values[m.target]);
        if (independent === null) {
          offending.push(idx);
          continue;
        }
        sumIn += independent;
        sumOut += transformed;
        if (independent !== transformed) offending.push(idx);
      }
    }
    const passed = offending.length === 0 && sumIn === sumOut;
    return { passed, detail: `sum in = ${fmt(sumIn)} cents, sum out = ${fmt(sumOut)} cents`, offendingRows: [...new Set(offending)] };
  });

  const primaryKey = timed("PRIMARY_KEY_VALID", () => {
    const inv = mappingFor("invoice_number");
    const ven = mappingFor("vendor_id");
    if (!inv) return { passed: false, detail: "invoice_number is not mapped", offendingRows: [...output.outputs.keys()] };
    const offending = new Set<number>();
    const seen = new Map<string, number[]>();
    let empty = 0;
    let ledgerConflicts = 0;
    for (const [idx, values] of output.outputs) {
      const invoice = String(values[inv.target] ?? "").trim();
      const vendor = ven ? String(values[ven.target] ?? "") : "";
      if (!invoice) {
        empty++;
        offending.add(idx);
        continue;
      }
      const key = `${vendor}|${invoice}`;
      seen.set(key, [...(seen.get(key) ?? []), idx]);
      const posted = input.ledger.find((e) => e.invoice_number === invoice && (!vendor || e.vendor_id === vendor));
      if (posted) {
        const po = mappingFor("po_number");
        const amt = mappingFor("gross_amount_usd");
        const myKey = idempotencyKey({ vendor_id: vendor, po_number: po ? String(values[po.target]) : "", invoice_number: invoice, gross_amount_cents: amt ? Number(values[amt.target]) : 0 });
        const theirKey = idempotencyKey({ vendor_id: posted.vendor_id, po_number: posted.po_number, invoice_number: posted.invoice_number, gross_amount_cents: posted.amount_cents });
        // Same key = an exact replay; node 7 prevents the duplicate. Different key = a real conflict.
        if (myKey !== theirKey) {
          ledgerConflicts++;
          offending.add(idx);
        }
      }
    }
    let dups = 0;
    for (const rows of seen.values()) {
      if (rows.length > 1) {
        dups += rows.length;
        rows.forEach((r) => offending.add(r));
      }
    }
    return {
      passed: offending.size === 0,
      detail: `${seen.size} unique keys, ${empty} empty, ${dups} duplicated, ${ledgerConflicts} conflicting with the portal ledger`,
      offendingRows: [...offending].sort((a, b) => a - b),
    };
  });

  const datesInWindow = timed("DATES_IN_WINDOW", () => {
    const dateMappings = spec.mappings.filter((m) => fieldByKey.get(m.target)?.kind === "date");
    const { start, end } = input.fiscalWindow;
    let total = 0;
    const offending: number[] = [];
    for (const [idx, values] of output.outputs) {
      for (const m of dateMappings) {
        const v = values[m.target];
        if (v === undefined) continue;
        total++;
        const s = String(v);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < start || s > end) offending.push(idx);
      }
    }
    return {
      passed: offending.length === 0,
      detail: `${total - offending.length}/${total} dates within ${start} … ${end}`,
      offendingRows: [...new Set(offending)],
    };
  });

  const idempotent = timed("IDEMPOTENT", () => {
    const offending = new Set<number>();
    let changes = 0;
    for (const [idx, values] of output.outputs) {
      for (const m of spec.mappings) {
        const field = fieldByKey.get(m.target);
        if (!field || values[m.target] === undefined) continue;
        const rendered = renderCanonical(field.kind, values[m.target]);
        const again = applyNormalizers(canonicalNormalizers(field.kind), rendered);
        if (!again.ok || again.value !== values[m.target]) {
          changes++;
          offending.add(idx);
        }
      }
    }
    // Keys must be stable across two independent applications of the spec.
    const second = input.reapply ? input.reapply() : null;
    let stable = 0;
    const keyFor = (vals: Record<string, string | number>) => {
      const g = (c: string) => {
        const m = mappingFor(c);
        return m ? vals[m.target] : undefined;
      };
      return idempotencyKey({ vendor_id: String(g("vendor_id") ?? ""), po_number: String(g("po_number") ?? ""), invoice_number: String(g("invoice_number") ?? ""), gross_amount_cents: Number(g("gross_amount_usd") ?? 0) });
    };
    for (const [idx, values] of output.outputs) {
      const other = second ? second.outputs.get(idx) : values;
      if (other && keyFor(values) === keyFor(other)) stable++;
      else offending.add(idx);
    }
    return {
      passed: offending.size === 0,
      detail: `re-applied to ${output.outputs.size} canonical rows: ${changes} changes; ${stable}/${output.outputs.size} keys stable`,
      offendingRows: [...offending].sort((a, b) => a - b),
    };
  });

  return [rowCount, moneySum, primaryKey, datesInWindow, idempotent];
}
