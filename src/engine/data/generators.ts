/**
 * Seeded generators for synthetic invoices and drifted vendor exports.
 * Used by the drift benchmark (200 files), the property tests and the
 * Sandbox starter file. The generator knows the ground truth, so accuracy is
 * measured, not asserted.
 */
import type { CanonicalField, InvoiceRecord } from "../types";
import type { Rng } from "../seed";
import { CANONICAL_FIELDS } from "../etl/contract";
import { toCsv } from "../etl/csv";
import { renderField, type DateRender, type IbanFormat, type MoneyFormat, type RateFormat, type ValueFormats } from "./render";
import { VENDOR_MASTER } from "./scenarios";

export const HEADER_VOCAB: Readonly<Record<CanonicalField, { covered: string[]; opaque: string[] }>> = {
  vendor_id: { covered: ["supplier_code", "vendor_no", "VendorID", "supplierRef", "vend_nbr", "seller_id", "supplier_number"], opaque: ["partner_code", "creditor", "kreditor_nr"] },
  customer_id: { covered: ["client_ref_no", "cust_id", "customerNumber", "buyer_ref", "client_code", "cust_no"], opaque: ["sold_to", "debtor", "account_holder"] },
  po_number: { covered: ["procurement_doc_id", "po_num", "PO Ref", "order_ref", "purchaseOrder", "po_no", "purchase_order_id"], opaque: ["requisition", "bestellnummer", "contract_ref"] },
  invoice_number: { covered: ["bill_ref", "inv_no", "InvoiceNo", "invoice_ref", "inv_num", "bill_number", "invoice_id"], opaque: ["doc_key", "rechnung", "voucher"] },
  invoice_date: { covered: ["dt_issued", "inv_date", "issue_date", "billing_date", "doc_date", "invoice_dt", "date_issued"], opaque: ["posting_period", "booked_on", "datum"] },
  gross_amount_usd: { covered: ["gross_inv_val", "total_usd", "InvoiceTotal", "amt", "grand_total", "value_gross", "total_amount", "gross_amt"], opaque: ["betrag", "payable", "net_due"] },
  tax_rate: { covered: ["vat_pct", "tax_pct", "TaxRate", "vat", "tax_percent", "gst_rate", "vat_rate"], opaque: ["levy", "mwst", "duty"] },
  line_items_count: { covered: ["line_cnt", "num_lines", "LineItems", "item_count", "lines", "qty_lines", "line_count"], opaque: ["positions", "pos_count", "entries"] },
  payee_iban: { covered: ["beneficiary_acct", "iban", "bank_account", "PayeeIBAN", "remit_to_acct", "payee_account", "acct_iban"], opaque: ["settlement", "bankverbindung", "pay_to"] },
};

const EXTRA_COLUMNS: { header: string; values: string[] }[] = [
  { header: "memo", values: ["Delivered to dock 4", "Partial shipment", "", "Signed by receiving", "Backorder cleared", "Rush"] },
  { header: "region", values: ["EMEA", "NA-East", "NA-West", "APAC"] },
  { header: "payment_terms", values: ["NET30", "NET45", "NET60", "2/10 NET30"] },
  { header: "currency", values: ["USD"] },
];

const TAX_RATES = [0, 0.05, 0.07, 0.0825, 0.19, 0.2];
const CUSTOMERS = ["C-7781", "C-7782", "C-7790"];

export interface InvoiceGenOptions {
  vendorId?: string;
  /** Force every date to have day and month at or below 12. */
  ambiguousDates?: boolean;
  /** Guarantee at least one day above 12 (so slash dates are decidable). */
  decidableDates?: boolean;
  start?: string;
  end?: string;
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function generateInvoices(rng: Rng, n: number, opts: InvoiceGenOptions = {}): InvoiceRecord[] {
  const vendor = opts.vendorId ? VENDOR_MASTER.find((v) => v.vendor_id === opts.vendorId)! : rng.pick(VENDOR_MASTER);
  const code = vendor.name.split(/\s+/).map((w) => w[0]).join("").replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "XX";
  const usedPo = new Set<string>();
  const usedInv = new Set<string>();
  const out: InvoiceRecord[] = [];
  for (let i = 0; i < n; i++) {
    let po: string;
    do po = `PO-${rng.int(10000, 99999)}`;
    while (usedPo.has(po));
    usedPo.add(po);
    let invNo: string;
    do invNo = `INV-${code}-${rng.int(10000, 99999)}`;
    while (usedInv.has(invNo));
    usedInv.add(invNo);
    const y = rng.int(2024, 2027);
    const m = rng.int(1, opts.ambiguousDates ? 12 : 12);
    const maxDay = [31, y % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    let d = rng.int(1, opts.ambiguousDates ? 12 : maxDay);
    if (opts.decidableDates && i === 0) d = rng.int(13, maxDay);
    let date = isoFromParts(y, m, d);
    if (date > "2027-12-31") date = isoFromParts(2027, Math.min(m, 12), Math.min(d, 28));
    const round = rng.bool(0.2);
    const cents = round ? rng.int(5, 900) * 10000 : rng.int(5000, 9_000_000);
    out.push({
      vendor_id: vendor.vendor_id,
      customer_id: rng.pick(CUSTOMERS),
      po_number: po,
      invoice_number: invNo,
      invoice_date: date,
      gross_amount_cents: cents,
      tax_rate: rng.pick(TAX_RATES),
      line_items_count: rng.int(1, 14),
      payee_iban: vendor.iban,
    });
  }
  return out;
}

export interface DriftOptions {
  rows: number;
  vendorId?: string;
  difficulty: "easy" | "medium" | "hard";
  ambiguousDates?: boolean;
  formats?: Partial<ValueFormats>;
}

export interface DriftedFile {
  csv: string;
  records: InvoiceRecord[];
  /** source header -> canonical field (null for extra columns). */
  truth: Record<string, CanonicalField | null>;
  formats: ValueFormats;
  delimiter: string;
  ambiguousDates: boolean;
}

export function generateDriftedFile(rng: Rng, opts: DriftOptions): DriftedFile {
  const formats: ValueFormats = {
    money: opts.formats?.money ?? rng.pick<MoneyFormat>(["canonical", "usd_suffix", "usd_prefix", "dollar", "plain_commas", "de"]),
    date: opts.formats?.date ?? (opts.ambiguousDates ? rng.pick<DateRender>(["slash_dmy", "slash_mdy"]) : rng.pick<DateRender>(["iso", "dotted", "slash_dmy", "slash_mdy", "compact"])),
    rate: opts.formats?.rate ?? rng.pick<RateFormat>(["fraction", "percent", "percent_space"]),
    iban: opts.formats?.iban ?? rng.pick<IbanFormat>(["compact", "spaced"]),
    id: opts.formats?.id ?? (rng.bool(0.85) ? "canonical" : "lower"),
  };
  const slash = formats.date === "slash_dmy" || formats.date === "slash_mdy";
  const records = generateInvoices(rng, opts.rows, {
    vendorId: opts.vendorId,
    ambiguousDates: opts.ambiguousDates,
    decidableDates: slash && !opts.ambiguousDates,
  });
  const pCanonical = opts.difficulty === "easy" ? 0.2 : opts.difficulty === "medium" ? 0.1 : 0;
  const pOpaque = opts.difficulty === "easy" ? 0 : opts.difficulty === "medium" ? 0.2 : 0.5;
  const used = new Set<string>();
  const columns = CANONICAL_FIELDS.map((field) => {
    let header: string;
    const r = rng.next();
    if (r < pCanonical) header = field;
    else if (r < pCanonical + pOpaque) header = rng.pick(HEADER_VOCAB[field].opaque);
    else header = rng.pick(HEADER_VOCAB[field].covered);
    while (used.has(header)) header = `${header}_2`;
    used.add(header);
    return { header, field };
  });
  const extras = rng.shuffle(EXTRA_COLUMNS).slice(0, rng.int(0, 2));
  const ordered = rng.shuffle([...columns.map((c) => ({ kind: "field" as const, ...c })), ...extras.map((e) => ({ kind: "extra" as const, header: e.header, values: e.values }))]);
  const truth: Record<string, CanonicalField | null> = {};
  for (const c of ordered) truth[c.header] = c.kind === "field" ? c.field : null;
  const headers = ordered.map((c) => c.header);
  const rows = records.map((rec) => {
    const row: Record<string, string> = {};
    for (const c of ordered) row[c.header] = c.kind === "field" ? renderField(rec, c.field, formats) : rng.pick(c.values);
    return row;
  });
  const delimiter = formats.money === "de" && rng.bool(0.6) ? ";" : ",";
  return { csv: toCsv(headers, rows, delimiter), records, truth, formats, delimiter, ambiguousDates: !!opts.ambiguousDates && slash };
}
