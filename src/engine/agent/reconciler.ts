/**
 * Cross-document reconciler (spec 8.3): three-way comparison per invoice of
 * (A) PDF extraction, (B) healed CSV row, (C) ERP purchase order and vendor
 * master. Amounts compare in integer cents; strings after normalization.
 */
import type { CanonicalField, ErpPurchaseOrder, ExtractedInvoice, FieldAgreement, InvoiceRecord, PolicyConfig, Reconciliation, VendorMasterEntry } from "../types";
import { normalizeIban } from "../iban";
import { FEATURE_NAMES, heuristicScore, predict, type FeatureVector } from "./calibrator";
import { evaluatePolicy } from "./policy";
import { idempotencyKey } from "../etl/idempotency";
import { CANONICAL_FIELDS } from "../etl/contract";

export interface ReconcileInput {
  recordId: string;
  csv?: InvoiceRecord;
  pdf?: { docId: string; invoice: ExtractedInvoice };
  erp?: ErpPurchaseOrder;
  vendorMaster: VendorMasterEntry[];
  mappingScoreMean: number;
  normalizerCount: number;
  securitySignal: number;
  securityFindingIds?: string[];
}

type Val = string | number | undefined;

function pdfValue(inv: ExtractedInvoice | undefined, f: CanonicalField): Val {
  if (!inv) return undefined;
  if (f === "gross_amount_usd") return inv.fields.gross_amount_cents;
  return (inv.fields as Record<string, string | number | undefined>)[f];
}

function recordValue(r: InvoiceRecord | undefined, f: CanonicalField): Val {
  if (!r) return undefined;
  if (f === "gross_amount_usd") return r.gross_amount_cents;
  return (r as unknown as Record<string, string | number>)[f];
}

function erpValue(erp: ErpPurchaseOrder | undefined, master: VendorMasterEntry | undefined, f: CanonicalField): Val {
  switch (f) {
    case "vendor_id":
      return erp?.vendor_id;
    case "customer_id":
      return erp?.customer_id;
    case "po_number":
      return erp?.po_number;
    case "gross_amount_usd":
      return erp?.authorized_cents;
    case "payee_iban":
      return master?.iban;
    default:
      return undefined;
  }
}

function norm(f: CanonicalField, v: Val): Val {
  if (v === undefined || v === "") return undefined;
  if (f === "payee_iban") return normalizeIban(String(v));
  if (typeof v === "string") return v.trim().toUpperCase();
  return v;
}

/** Build the record to post: the healed CSV row if present, else the PDF fields. */
export function recordFromPdf(inv: ExtractedInvoice): InvoiceRecord {
  const f = inv.fields;
  return {
    vendor_id: f.vendor_id ?? "",
    customer_id: f.customer_id ?? "",
    po_number: f.po_number ?? "",
    invoice_number: f.invoice_number ?? "",
    invoice_date: f.invoice_date ?? "",
    gross_amount_cents: f.gross_amount_cents ?? 0,
    tax_rate: f.tax_rate ?? 0,
    line_items_count: f.line_items_count ?? 0,
    payee_iban: f.payee_iban ?? "",
  };
}

export function compareFields(input: ReconcileInput): { fields: FieldAgreement[]; maxAbsDelta: number; maxRelDelta: number } {
  const master = input.vendorMaster.find((v) => v.vendor_id === (input.csv?.vendor_id ?? input.pdf?.invoice.fields.vendor_id));
  const fields: FieldAgreement[] = [];
  let maxAbsDelta = 0;
  let maxRelDelta = 0;
  for (const f of CANONICAL_FIELDS) {
    const pdf = norm(f, pdfValue(input.pdf?.invoice, f));
    const csv = norm(f, recordValue(input.csv, f));
    const erp = norm(f, erpValue(input.erp, master, f));
    const present = [pdf, csv, erp].filter((v) => v !== undefined);
    if (present.length === 0) continue;
    const agree = present.every((v) => v === present[0]);
    const fa: FieldAgreement = { field: f, agree };
    if (pdf !== undefined) fa.pdf = pdf;
    if (csv !== undefined) fa.csv = csv;
    if (erp !== undefined) fa.erp = erp;
    if (f === "gross_amount_usd") {
      const nums = present.map(Number);
      const abs = Math.max(...nums) - Math.min(...nums);
      const base = input.erp?.authorized_cents ?? Math.min(...nums);
      const rel = base > 0 ? abs / base : abs > 0 ? 1 : 0;
      fa.absDeltaCents = abs;
      fa.relDelta = Math.round(rel * 10000) / 10000;
      maxAbsDelta = Math.max(maxAbsDelta, abs);
      maxRelDelta = Math.max(maxRelDelta, rel);
    }
    if (f === "po_number" && input.erp === undefined && (pdf !== undefined || csv !== undefined)) fa.note = "purchase order not found in the ERP";
    fields.push(fa);
  }
  return { fields, maxAbsDelta, maxRelDelta };
}

export function computeFeatures(input: ReconcileInput, cmp: ReturnType<typeof compareFields>): FeatureVector {
  const invoice = input.csv ?? (input.pdf ? recordFromPdf(input.pdf.invoice) : undefined);
  const master = input.vendorMaster.find((v) => v.vendor_id === invoice?.vendor_id);
  const comparable = cmp.fields.filter((f) => [f.pdf, f.csv, f.erp].filter((v) => v !== undefined).length >= 2);
  const agreeFrac = comparable.length ? comparable.filter((f) => f.agree).length / comparable.length : 0.5;
  const amount = cmp.fields.find((f) => f.field === "gross_amount_usd");
  const pdfCsvMismatch = amount && amount.pdf !== undefined && amount.csv !== undefined && amount.pdf !== amount.csv ? 1 : 0;
  let ambiguity = 0;
  if (input.pdf) {
    for (const [k, list] of Object.entries(input.pdf.invoice.candidates)) {
      const distinct = new Set((list ?? []).map((v) => (k === "payee_iban" ? normalizeIban(v) : v.trim().toUpperCase())));
      ambiguity = Math.max(ambiguity, distinct.size - 1);
    }
  }
  const features: FeatureVector = {
    agree_frac: round(agreeFrac),
    amount_abs_delta_log: round(Math.log10(1 + cmp.maxAbsDelta / 100) / 6),
    amount_rel_delta: round(Math.min(1, cmp.maxRelDelta)),
    pdf_csv_amount_mismatch: pdfCsvMismatch,
    mapping_score: round(input.mappingScoreMean),
    normalizer_load: round(Math.min(1, input.normalizerCount / 9)),
    pdf_missing_frac: input.pdf ? round(input.pdf.invoice.missing.length / 9) : 0,
    pdf_ambiguity: round(Math.min(1, ambiguity / 2)),
    has_pdf: input.pdf ? 1 : 0,
    vendor_known: master ? 1 : 0,
    payee_match: master && invoice && normalizeIban(invoice.payee_iban) === normalizeIban(master.iban) ? 1 : 0,
    po_found: input.erp && invoice && input.erp.vendor_id === invoice.vendor_id ? 1 : 0,
    security_signal: input.securitySignal ? 1 : 0,
  };
  for (const n of FEATURE_NAMES) if (!Number.isFinite(features[n])) features[n] = 0;
  return features;
}

const round = (x: number) => Math.round(x * 10000) / 10000;

export function reconcile(input: ReconcileInput, policy: PolicyConfig): Reconciliation {
  const cmp = compareFields(input);
  const features = computeFeatures(input, cmp);
  const confidence = round(predict(features));
  const invoice = input.csv ?? recordFromPdf(input.pdf!.invoice);
  const rec: Reconciliation = {
    recordId: input.recordId,
    invoice_number: invoice.invoice_number,
    vendor_id: invoice.vendor_id,
    po_number: invoice.po_number,
    source: input.csv && input.pdf ? "csv+pdf" : input.csv ? "csv" : "pdf",
    pdfDocId: input.pdf?.docId,
    fields: cmp.fields,
    features: { ...features },
    confidence,
    heuristicScore: round(heuristicScore(features)),
    policyHits: [],
    surcharges: input.pdf?.invoice.surcharges ?? [],
    erp: input.erp,
    invoice,
    idempotencyKey: idempotencyKey(invoice),
  };
  rec.policyHits = evaluatePolicy(rec, policy, input.vendorMaster, input.securityFindingIds ?? []);
  return rec;
}
