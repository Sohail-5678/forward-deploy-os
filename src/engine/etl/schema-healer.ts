/**
 * Schema healer (spec 8.1): detect drift against the contract, synthesize a
 * declarative TransformSpec, apply it with the fixed normalizer interpreter.
 * Healing outputs data, never code (rule S1).
 */
import type {
  CanonicalField,
  ContractDef,
  ContractField,
  DateDecision,
  DateFormat,
  DriftError,
  DriftReport,
  FieldMapping,
  FileHealResult,
  HealedRecord,
  InvoiceRecord,
  LedgerEntry,
  Normalizer,
  QuarantinedRow,
  RowError,
  TransformSpec,
} from "../types";
import type { ParsedTable } from "./csv";
import { canonicalJSON, sha256Hex } from "../hash";
import { classifyValue, profileColumn } from "./value-profile";
import { matchColumns, MAPPING_THRESHOLD, scorePair, type PairScore } from "./matcher";
import { applyNormalizers, renderCanonical, validateCanonicalValue } from "./normalizers";
import { inferDateFormat } from "./date-format";
import { idempotencyKey } from "./idempotency";
import { runInvariants } from "./invariants";
import { normalizeIban } from "../iban";

const MAX_REPORTED_ERRORS = 60;

export function rowHash(raw: Record<string, string>): string {
  return sha256Hex(canonicalJSON(raw));
}

// ---------------------------------------------------------------------------
// Node 2: drift detection
// ---------------------------------------------------------------------------

export function detectDrift(table: ParsedTable, contract: ContractDef): DriftReport {
  const errors: DriftError[] = [];
  const headers = table.headers;
  const keys = new Set(contract.fields.map((f) => f.key));
  const failedRows = new Map<number, string[]>();
  const addRowReason = (row: number, reason: string) => {
    const list = failedRows.get(row) ?? [];
    if (!list.includes(reason)) list.push(reason);
    failedRows.set(row, list);
  };

  const missingRequired = contract.fields.filter((f) => f.required && !headers.includes(f.key));
  for (const f of missingRequired) errors.push({ code: "MISSING_REQUIRED_COLUMN", column: f.key, detail: `required column "${f.key}" not found` });
  for (const h of headers) if (!keys.has(h)) errors.push({ code: "UNEXPECTED_COLUMN", column: h, detail: `column "${h}" is not in ${contract.version}` });

  const profiles = headers.map((h) => profileColumn(h, table.rows.map((r) => r[h] ?? "")));

  // Format drift from value fingerprints, for every column (renamed or not).
  for (const p of profiles) {
    const sample = p.samples[0];
    switch (p.dominant) {
      case "DOTTED_DATE":
      case "COMPACT_DATE":
        errors.push({ code: "DATE_FORMAT_DRIFT", column: p.column, sample, detail: "dates are not ISO 8601" });
        break;
      case "SLASH_DATE": {
        const inf = inferDateFormat(table.rows.map((r) => r[p.column] ?? ""));
        if (inf.status === "ambiguous") errors.push({ code: "AMBIGUOUS_DATE_FORMAT", column: p.column, sample, detail: inf.reason });
        else errors.push({ code: "DATE_FORMAT_DRIFT", column: p.column, sample, detail: "dates are not ISO 8601" });
        break;
      }
      case "CURRENCY_STRING":
        errors.push({ code: "CURRENCY_STRING_CONTAMINATION", column: p.column, sample, detail: "amounts contain currency symbols or separators" });
        break;
      case "PERCENT":
        errors.push({ code: "PERCENT_STRING", column: p.column, sample, detail: "rates are percent strings" });
        break;
    }
  }

  // Strict per-row validation for columns that already carry contract names.
  let reported = 0;
  table.rows.forEach((row, idx) => {
    if (missingRequired.length > 0) addRowReason(idx, `missing required columns: ${missingRequired.map((f) => f.key).join(", ")}`);
    for (const f of contract.fields) {
      if (!headers.includes(f.key)) continue;
      const raw = row[f.key] ?? "";
      if (raw.trim() === "") {
        if (f.required) {
          addRowReason(idx, `${f.key} is empty`);
          if (reported++ < MAX_REPORTED_ERRORS) errors.push({ code: "TYPE_MISMATCH", column: f.key, row: idx, sample: "", detail: "required value is empty" });
        }
        continue;
      }
      const v = validateCanonicalValue(f.kind, raw);
      if (!v.ok) {
        addRowReason(idx, `${f.key}: ${v.message}`);
        if (v.code === "TYPE_MISMATCH" && reported++ < MAX_REPORTED_ERRORS) errors.push({ code: v.code, column: f.key, row: idx, sample: raw, detail: v.message });
      }
    }
  });

  // Duplicate keys in an exactly named invoice column.
  const invField = contract.fields.find((f) => f.canonical === "invoice_number");
  if (invField && headers.includes(invField.key)) {
    const seen = new Map<string, number>();
    table.rows.forEach((row, idx) => {
      const k = (row[invField.key] ?? "").trim().toUpperCase();
      if (!k) return;
      if (seen.has(k)) {
        errors.push({ code: "DUPLICATE_KEY", column: invField.key, row: idx, sample: k, detail: `also in row ${seen.get(k)}` });
        addRowReason(idx, `duplicate invoice number ${k}`);
        addRowReason(seen.get(k)!, `duplicate invoice number ${k}`);
      } else seen.set(k, idx);
    });
  }

  const quarantined: QuarantinedRow[] = [...failedRows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowIndex, reasons]) => ({ rowIndex, sha256: rowHash(table.rows[rowIndex]), raw: table.rows[rowIndex], reasons }));

  return { contractVersion: contract.version, fileId: table.fileId, errors, quarantined, profiles };
}

// ---------------------------------------------------------------------------
// Node 3: synthesis
// ---------------------------------------------------------------------------

const ID_PATTERNS: Partial<Record<ContractField["kind"], string>> = {
  vendorId: "(V-\\d{3,})",
  customerId: "(C-\\d{3,})",
  poNumber: "(PO-\\d{3,})",
};

function detectMoneyLocale(values: string[]): "en-US" | "de-DE" {
  let de = 0;
  let en = 0;
  for (const v of values) {
    const s = v.replace(/[^\d.,]/g, "");
    if (/\d,\d{2}$/.test(s) || /\d\.\d{3},/.test(s)) de++;
    else if (/\d\.\d{2}$/.test(s) || /\d,\d{3}/.test(s)) en++;
  }
  return de > en ? "de-DE" : "en-US";
}

export function chooseNormalizers(field: ContractField, values: string[], dateFormat?: DateFormat): Normalizer[] {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  switch (field.kind) {
    case "vendorId":
    case "customerId":
    case "poNumber": {
      const fam = field.kind === "vendorId" ? "VENDOR_ID" : field.kind === "customerId" ? "CUSTOMER_ID" : "PO_ID";
      const direct = nonEmpty.filter((v) => classifyValue(v) === fam).length;
      const pattern = ID_PATTERNS[field.kind]!;
      if (direct < nonEmpty.length) {
        const re = new RegExp(pattern, "i");
        const embedded = nonEmpty.filter((v) => re.test(v)).length;
        if (embedded > direct) return [{ op: "trim" }, { op: "upper" }, { op: "regexExtract", pattern, group: 1 }];
      }
      return [{ op: "trim" }, { op: "upper" }];
    }
    case "invoiceNumber":
      return [{ op: "trim" }, { op: "upper" }];
    case "date":
      return dateFormat ? [{ op: "trim" }, { op: "parseDate", format: dateFormat }] : [{ op: "trim" }];
    case "money":
      return [{ op: "trim" }, { op: "parseCurrency", locale: detectMoneyLocale(nonEmpty) }];
    case "rate":
      return [{ op: "trim" }, { op: "parsePercent" }];
    case "int":
      return [{ op: "trim" }, { op: "parseInt" }];
    case "iban":
      return [{ op: "trim" }, { op: "removeWhitespace" }, { op: "upper" }];
    case "text":
      return [{ op: "trim" }];
  }
}

export interface SynthesisOptions {
  dateOverride?: DateFormat;
  /** Mappings proposed by the optional LLM; validated and re-scored before use. */
  proposals?: { source: string; target: string; proposedBy: "llm" | "human" }[];
  sampleSize?: number;
}

export interface SynthesisResult {
  spec: TransformSpec;
  matrix: PairScore[][];
  rejectedProposals: { source: string; target: string; reason: string }[];
}

export function specId(mappings: FieldMapping[]): string {
  return sha256Hex(canonicalJSON(mappings.map((m) => ({ target: m.target, source: m.source, normalizers: m.normalizers }))));
}

export function synthesizeSpec(table: ParsedTable, contract: ContractDef, opts: SynthesisOptions = {}): SynthesisResult {
  const sampleSize = opts.sampleSize ?? 60;
  const profiles = table.headers.map((h) => profileColumn(h, table.rows.map((r) => r[h] ?? ""), sampleSize));
  const match = matchColumns(profiles, contract);
  const pairs = [...match.pairs];
  const rejectedProposals: SynthesisResult["rejectedProposals"] = [];

  // Optional proposals only fill required targets the deterministic matcher left open.
  for (const p of opts.proposals ?? []) {
    const field = contract.fields.find((f) => f.key === p.target);
    const profile = profiles.find((x) => x.column === p.source);
    if (!field || !profile) {
      rejectedProposals.push({ ...p, reason: "unknown source column or target field" });
      continue;
    }
    if (pairs.some((x) => x.target === p.target)) {
      rejectedProposals.push({ ...p, reason: "target already mapped by the deterministic matcher" });
      continue;
    }
    if (pairs.some((x) => x.source === p.source)) {
      rejectedProposals.push({ ...p, reason: "source column already used" });
      continue;
    }
    const s = scorePair(profile, field);
    if (s.valueScore < 0.5) {
      rejectedProposals.push({ ...p, reason: `values do not look like ${field.kind} (value score ${s.valueScore.toFixed(2)})` });
      continue;
    }
    pairs.push({ ...s, evidence: [...s.evidence, `proposed by ${p.proposedBy}`] });
  }

  let dateDecision: DateDecision | undefined;
  const mappings: FieldMapping[] = pairs.map((pair) => {
    const field = contract.fields.find((f) => f.key === pair.target)!;
    const values = table.rows.map((r) => r[pair.source] ?? "");
    let fmt: DateFormat | undefined;
    if (field.kind === "date") {
      const inf = inferDateFormat(values);
      if (opts.dateOverride) {
        fmt = opts.dateOverride;
        dateDecision = { target: field.key, source: pair.source, status: "overridden", format: fmt, candidates: inf.candidates, reason: `human chose ${fmt}`, samples: values.slice(0, 6) };
      } else if (inf.status === "decided") {
        fmt = inf.format;
        dateDecision = { target: field.key, source: pair.source, status: "decided", format: fmt, candidates: inf.candidates, reason: inf.reason, samples: values.slice(0, 6) };
      } else {
        dateDecision = { target: field.key, source: pair.source, status: "ambiguous", candidates: inf.candidates.length ? inf.candidates : ["DD/MM/YYYY", "MM/DD/YYYY"], reason: inf.reason, samples: values.filter((v) => v.trim() !== "").slice(0, 6) };
        if (inf.status === "invalid") dateDecision.status = "ambiguous";
      }
    }
    const proposedBy: FieldMapping["proposedBy"] = pair.evidence.some((e) => e === "proposed by llm") ? "llm" : pair.evidence.some((e) => e === "proposed by human") ? "human" : "deterministic";
    return {
      target: pair.target,
      canonical: field.canonical,
      source: pair.source,
      normalizers: chooseNormalizers(field, values, fmt),
      score: pair.score,
      nameScore: pair.nameScore,
      valueScore: pair.valueScore,
      distScore: pair.distScore,
      evidence: pair.evidence,
      evidenceSamples: pair.evidenceSamples,
      proposedBy,
    };
  });

  const mappedTargets = new Set(mappings.map((m) => m.target));
  const mappedSources = new Set(mappings.map((m) => m.source));
  const spec: TransformSpec = {
    id: specId(mappings),
    contractVersion: contract.version,
    mappings,
    unmappedSource: table.headers.filter((h) => !mappedSources.has(h)),
    unmappedTarget: contract.fields.map((f) => f.key).filter((k) => !mappedTargets.has(k)),
    dateDecision,
  };
  return { spec, matrix: match.matrix, rejectedProposals };
}

export function describeRecipe(m: FieldMapping): string {
  const ops = m.normalizers.map((n) => {
    switch (n.op) {
      case "parseCurrency":
        return `parseCurrency(${n.locale})`;
      case "parseDate":
        return `parseDate(${n.format})`;
      case "regexExtract":
        return `regexExtract(${n.pattern})`;
      default:
        return n.op;
    }
  });
  return [`${m.source} → ${m.target}`, ...ops].join(" · ");
}

// ---------------------------------------------------------------------------
// Applying a spec
// ---------------------------------------------------------------------------

export interface TransformOutput {
  outputs: Map<number, Record<string, string | number>>;
  errors: RowError[];
  failedRows: Set<number>;
}

export function applySpec(table: ParsedTable, spec: TransformSpec, contract: ContractDef): TransformOutput {
  const outputs = new Map<number, Record<string, string | number>>();
  const errors: RowError[] = [];
  const failedRows = new Set<number>();
  const pendingDateTarget = spec.dateDecision?.status === "ambiguous" ? spec.dateDecision.target : undefined;
  const mappedTargets = new Set(spec.mappings.map((m) => m.target));
  const unmappedRequired = contract.fields.filter((f) => f.required && !mappedTargets.has(f.key));

  table.rows.forEach((row, idx) => {
    const values: Record<string, string | number> = {};
    let rowFailed = false;
    const err = (field: string, message: string) => {
      errors.push({ rowIndex: idx, field, message });
      rowFailed = true;
    };
    for (const f of unmappedRequired) err(f.key, `no source column for required field ${f.key}`);
    for (const m of spec.mappings) {
      const field = contract.fields.find((f) => f.key === m.target);
      if (!field) {
        err(m.target, "mapping targets a field that is not in the contract");
        continue;
      }
      const raw = row[m.source] ?? "";
      if (raw.trim() === "") {
        if (field.required) err(m.target, "required value is empty");
        continue;
      }
      if (m.target === pendingDateTarget) {
        err(m.target, `date "${raw.trim()}" is ambiguous (day-first or month-first); waiting for a human decision`);
        continue;
      }
      const r = applyNormalizers(m.normalizers, raw);
      if (!r.ok) {
        err(m.target, r.error);
        continue;
      }
      const check = validateCanonicalValue(field.kind, renderCanonical(field.kind, r.value));
      if (!check.ok) {
        err(m.target, `${check.message} (got "${raw.trim()}")`);
        continue;
      }
      values[m.target] = field.kind === "iban" ? normalizeIban(String(r.value)) : r.value;
    }
    if (rowFailed) failedRows.add(idx);
    else outputs.set(idx, values);
  });
  return { outputs, errors, failedRows };
}

/** Map a transformed row (contract keys) onto the internal canonical record. */
export function toInvoiceRecord(values: Record<string, string | number>, contract: ContractDef): InvoiceRecord {
  const get = (c: CanonicalField): string | number | undefined => {
    const f = contract.fields.find((x) => x.canonical === c);
    return f ? values[f.key] : undefined;
  };
  return {
    vendor_id: String(get("vendor_id") ?? ""),
    customer_id: String(get("customer_id") ?? ""),
    po_number: String(get("po_number") ?? ""),
    invoice_number: String(get("invoice_number") ?? ""),
    invoice_date: String(get("invoice_date") ?? ""),
    gross_amount_cents: Number(get("gross_amount_usd") ?? 0),
    tax_rate: Number(get("tax_rate") ?? 0),
    line_items_count: Number(get("line_items_count") ?? 0),
    payee_iban: String(get("payee_iban") ?? ""),
  };
}

export interface HealOptions extends SynthesisOptions {
  ledger: LedgerEntry[];
  fiscalWindow: { start: string; end: string };
  fileName?: string;
}

/** Synthesize, apply, run the 5 invariants and promote only rows that pass. */
export function healFile(table: ParsedTable, contract: ContractDef, opts: HealOptions): FileHealResult & { matrix: PairScore[][]; rejectedProposals: SynthesisResult["rejectedProposals"] } {
  const { spec, matrix, rejectedProposals } = synthesizeSpec(table, contract, opts);
  const output = applySpec(table, spec, contract);
  const invariants = runInvariants({
    table,
    spec,
    contract,
    output,
    ledger: opts.ledger,
    fiscalWindow: opts.fiscalWindow,
    reapply: () => applySpec(table, spec, contract),
  });

  const blocked = new Set<number>();
  const rowCount = invariants.find((i) => i.name === "ROW_COUNT_CONSERVED");
  if (rowCount && !rowCount.passed) table.rows.forEach((_, i) => blocked.add(i));
  for (const inv of invariants) for (const r of inv.offendingRows) blocked.add(r);

  const mappingScoreMean = spec.mappings.length ? spec.mappings.reduce((s, m) => s + m.score, 0) / spec.mappings.length : 0;
  const normalizerCount = spec.mappings.reduce((s, m) => s + m.normalizers.filter((n) => n.op !== "trim").length, 0);

  const promoted: HealedRecord[] = [];
  const quarantined: QuarantinedRow[] = [];
  const reasonsByRow = new Map<number, string[]>();
  for (const e of output.errors) {
    const list = reasonsByRow.get(e.rowIndex) ?? [];
    list.push(`${e.field}: ${e.message}`);
    reasonsByRow.set(e.rowIndex, list);
  }
  for (const inv of invariants) {
    for (const r of inv.offendingRows) {
      const list = reasonsByRow.get(r) ?? [];
      list.push(`${inv.name} failed`);
      reasonsByRow.set(r, list);
    }
  }
  table.rows.forEach((raw, idx) => {
    const values = output.outputs.get(idx);
    if (values && !blocked.has(idx)) {
      const invoice = toInvoiceRecord(values, contract);
      promoted.push({
        recordId: `${table.fileId}#${idx + 1}`,
        fileId: table.fileId,
        rowIndex: idx,
        rawSha256: rowHash(raw),
        values,
        invoice,
        idempotencyKey: idempotencyKey(invoice),
        mappingScoreMean,
        normalizerCount,
      });
    } else {
      quarantined.push({ rowIndex: idx, sha256: rowHash(raw), raw, reasons: reasonsByRow.get(idx) ?? ["blocked by a failed invariant"] });
    }
  });

  return {
    fileId: table.fileId,
    fileName: opts.fileName ?? table.fileId,
    spec,
    invariants,
    promoted,
    quarantined,
    rowErrors: output.errors,
    awaitingDecision: spec.dateDecision?.status === "ambiguous",
    matrix,
    rejectedProposals,
  };
}

export { MAPPING_THRESHOLD };
