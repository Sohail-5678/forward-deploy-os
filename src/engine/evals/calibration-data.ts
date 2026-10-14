/**
 * Seeded, labeled calibration set (spec 8.3). The generator knows the ground
 * truth (is this record safe to post as-is?) and injects realistic noise:
 * extraction errors, near-miss amounts, rounding, swapped digits, missing
 * fields, unapproved surcharges, unknown vendors and payee changes. Features
 * come from the real reconciler, so the calibrator learns what the engine
 * actually sees.
 */
import type { ErpPurchaseOrder, ExtractedInvoice, InvoiceRecord } from "../types";
import { createRng, type Rng } from "../seed";
import { generateInvoices } from "../data/generators";
import { VENDOR_MASTER } from "../data/scenarios";
import { compareFields, computeFeatures, type ReconcileInput } from "../agent/reconciler";
import type { FeatureVector } from "../agent/calibrator";

export interface CalibrationCase {
  features: FeatureVector;
  label: 0 | 1;
  kind: string;
}

const OTHER_IBANS = ["DE89370400440532013000", "GB33BUKB20201555555555", "NL02ABNA0123456789", "FR7630006000011234567890189"];

function swapDigits(s: string, rng: Rng): string {
  const idx = [...s].map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return s + "1";
  const i = rng.int(0, idx.length - 2);
  const a = idx[i];
  const b = idx[i + 1];
  if (s[a] === s[b]) {
    const chars = [...s];
    chars[a] = String((Number(chars[a]) + 1) % 10);
    return chars.join("");
  }
  const chars = [...s];
  [chars[a], chars[b]] = [chars[b], chars[a]];
  return chars.join("");
}

function corrupt(rec: InvoiceRecord, rng: Rng): { rec: InvoiceRecord; field: string } {
  const out = { ...rec };
  const field = rng.pick(["amount", "invoice_number", "date", "po_number", "line_items"]);
  switch (field) {
    case "amount": {
      let v = Number(swapDigits(String(rec.gross_amount_cents), rng));
      if (v === rec.gross_amount_cents) v += 100;
      out.gross_amount_cents = v;
      break;
    }
    case "invoice_number":
      out.invoice_number = swapDigits(rec.invoice_number, rng);
      break;
    case "date": {
      const [y, m, d] = rec.invoice_date.split("-").map(Number);
      const nd = d >= 28 ? d - 1 : d + 1;
      out.invoice_date = `${y}-${String(m).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
      break;
    }
    case "po_number":
      out.po_number = swapDigits(rec.po_number, rng);
      break;
    case "line_items":
      out.line_items_count = rec.line_items_count + 1;
      break;
  }
  return { rec: out, field };
}

function extraction(truth: InvoiceRecord, rng: Rng, opts: { misread: boolean; missing: number; extraIban: boolean }): ExtractedInvoice {
  const fields: Partial<InvoiceRecord> = { ...truth };
  if (opts.misread) {
    const c = corrupt(truth, rng);
    Object.assign(fields, c.rec);
  }
  const all = ["vendor_id", "customer_id", "po_number", "invoice_number", "invoice_date", "gross_amount_cents", "tax_rate", "line_items_count", "payee_iban"] as const;
  const missing: ExtractedInvoice["missing"] = [];
  for (const k of rng.shuffle(all).slice(0, opts.missing)) {
    delete (fields as Record<string, unknown>)[k];
    missing.push(k === "gross_amount_cents" ? "gross_amount_usd" : k);
  }
  const candidates: ExtractedInvoice["candidates"] = {};
  if (fields.payee_iban) candidates.payee_iban = [fields.payee_iban];
  if (opts.extraIban) candidates.payee_iban = [...(candidates.payee_iban ?? []), rng.pick(OTHER_IBANS)];
  return { fields, candidates, missing, surcharges: [], method: "deterministic" };
}

export function generateCalibrationSet(seed: number, n: number): CalibrationCase[] {
  const rng = createRng(seed);
  const cases: CalibrationCase[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.fork(`case-${i}`);
    const truth = generateInvoices(r, 1)[0];
    const kinds: string[] = [];
    let unsafe = false;

    // Vendor identity.
    if (r.bool(0.02)) {
      truth.vendor_id = `V-9${r.int(100, 999)}`;
      kinds.push("unknown-vendor");
      unsafe = true;
    }
    const master = VENDOR_MASTER.find((v) => v.vendor_id === truth.vendor_id);

    // ERP purchase order.
    let erp: ErpPurchaseOrder | undefined = {
      po_number: truth.po_number,
      vendor_id: truth.vendor_id,
      customer_id: truth.customer_id,
      authorized_cents: truth.gross_amount_cents,
      cost_center: "4090-OPS",
      status: "OPEN",
      description: "synthetic",
    };
    const erpRoll = r.next();
    if (erpRoll < 0.03) {
      erp = undefined;
      kinds.push("po-missing");
      unsafe = true;
    } else if (erpRoll < 0.07) {
      erp.authorized_cents = Math.max(100, truth.gross_amount_cents + r.int(-99, 99));
      kinds.push("rounding");
    } else if (erpRoll < 0.12) {
      erp.authorized_cents = Math.max(100, truth.gross_amount_cents - r.int(10_000, 400_000));
      kinds.push("over-po");
      unsafe = true;
    } else if (erpRoll < 0.16) {
      erp.authorized_cents = truth.gross_amount_cents + r.int(10_000, 400_000);
      kinds.push("partial-invoice");
    } else if (erpRoll < 0.19) {
      // Unapproved surcharge: invoice total above the PO, PDF and CSV agree.
      erp.authorized_cents = Math.max(100, truth.gross_amount_cents - r.int(5_000, 250_000));
      kinds.push("surcharge");
      unsafe = true;
    }

    // The CSV row (what would be posted).
    const mappingScore = 0.6 + r.next() * 0.4;
    let csv: InvoiceRecord = { ...truth };
    const csvErrP = 0.04 + 0.15 * (1 - mappingScore);
    let csvError = false;
    if (r.bool(csvErrP)) {
      csv = corrupt(truth, r).rec;
      csvError = true;
      kinds.push("csv-error");
      unsafe = true;
    }
    let payeeChanged = false;
    if (r.bool(0.025)) {
      csv.payee_iban = r.pick(OTHER_IBANS);
      payeeChanged = true;
      kinds.push("payee-changed");
      unsafe = true;
    }

    // The PDF.
    let pdf: ReconcileInput["pdf"];
    if (r.bool(0.65)) {
      const sameError = csvError && r.bool(0.25);
      const base = sameError ? { ...csv, payee_iban: truth.payee_iban } : truth;
      const misread = !sameError && r.bool(0.1);
      const missing = r.bool(0.06) ? r.int(1, 3) : 0;
      // A second IBAN on the document is mostly how payee-change fraud shows up; rarely benign.
      const extraIban = payeeChanged ? r.bool(0.7) : r.bool(0.015);
      pdf = { docId: `pdf-${i}`, invoice: extraction(base, r, { misread, missing, extraIban }) };
      if (sameError) kinds.push("vendor-side-error");
      if (misread) kinds.push("pdf-misread");
      if (missing) kinds.push("pdf-missing-fields");
      if (extraIban) kinds.push("extra-iban");
    }

    const security = r.bool(unsafe ? 0.06 : 0.01) ? 1 : 0;
    const input: ReconcileInput = {
      recordId: `cal-${i}`,
      csv,
      pdf,
      erp,
      vendorMaster: VENDOR_MASTER,
      mappingScoreMean: mappingScore,
      normalizerCount: r.int(0, 9),
      securitySignal: security,
    };
    const cmp = compareFields(input);
    const features = computeFeatures(input, cmp);
    void master;
    cases.push({ features, label: unsafe ? 0 : 1, kind: kinds.join("+") || "clean" });
  }
  return cases;
}
