/**
 * Deterministic invoice field extraction from PDF text: label-anchored
 * patterns, with every candidate value kept so ambiguity becomes a feature
 * for the calibrator instead of a silent guess.
 */
import type { CanonicalField, ExtractedInvoice, InvoiceRecord } from "../types";
import { parseCurrencyCents, parseDateValue, parsePercentValue, toIsoDate } from "../etl/normalizers";
import { isValidIban, normalizeIban } from "../iban";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseLooseDate(s: string): string | null {
  const t = s.trim().replace(/,/g, "").replace(/\s+/g, " ");
  const month = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()];
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return toIsoDate(+m[1], +m[2], +m[3]);
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}) (\d{4})$/.exec(t);
  if (m && month(m[1])) return toIsoDate(+m[3], month(m[1]), +m[2]);
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})$/.exec(t);
  if (m && month(m[2])) return toIsoDate(+m[3], month(m[2]), +m[1]);
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(t)) return parseDateValue(t, "DD.MM.YYYY");
  return null;
}

const LABELS: { field: CanonicalField; re: RegExp }[] = [
  { field: "vendor_id", re: /\b(?:vendor|supplier)\s*(?:id|no\.?|number|#)\s*[:#]?\s*(V-\d{3,})/gi },
  { field: "customer_id", re: /\b(?:customer|client|bill\s*to)[^\n]{0,40}?\b(C-\d{3,})/gi },
  { field: "po_number", re: /\b(?:PO|purchase\s+order)\s*(?:number|no\.?|#|ref)?\s*[:#]?\s*(PO-\d{3,})/gi },
  { field: "invoice_number", re: /\binvoice\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z]{2,5}-[A-Z0-9-]{2,})/gi },
  { field: "invoice_date", re: /\b(?:invoice\s+date|date\s+of\s+invoice|issued)\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{4})/gi },
  { field: "gross_amount_usd", re: /\b(?:total\s+due|amount\s+due|invoice\s+total|grand\s+total|balance\s+due)\s*[:#]?\s*((?:USD\s*)?\$?\s*[\d,]+\.\d{2}(?:\s*USD)?)/gi },
  { field: "tax_rate", re: /\btax\s*(?:rate)?\s*[:#]?\s*(\d{1,2}(?:\.\d{1,4})?\s?%)/gi },
  { field: "line_items_count", re: /\bline\s+items\s*[:#]?\s*(\d{1,4})\b/gi },
  { field: "payee_iban", re: /\b(?:remit\s+to\s+)?IBAN\s*[:#]?[ \t]*([A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){3,8})/gi },
];

const ANY_IBAN = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,4}){3,8})/g;

/** Longest valid IBAN prefix of a captured run (captures can swallow a trailing word). */
export function bestIban(raw: string): string | null {
  let s = normalizeIban(raw);
  while (s.length >= 15) {
    if (isValidIban(s)) return s;
    s = s.slice(0, -1);
  }
  return null;
}
const SURCHARGE = /^(.*?\b(?:surcharge|expedit\w*|rush\s+fee|fuel\s+fee|handling\s+fee|late\s+fee)\b.*?)\s+\$?\s*([\d,]+\.\d{2})\s*$/i;

export function extractInvoiceFields(text: string, method: ExtractedInvoice["method"] = "deterministic"): ExtractedInvoice {
  const candidates: Partial<Record<CanonicalField, string[]>> = {};
  const push = (f: CanonicalField, v: string) => {
    const list = candidates[f] ?? [];
    const val = v.trim();
    if (!list.includes(val)) list.push(val);
    candidates[f] = list;
  };
  for (const { field, re } of LABELS) {
    for (const m of text.matchAll(re)) {
      if (field === "payee_iban") {
        const iban = bestIban(m[1]);
        if (iban) push(field, iban);
      } else push(field, m[1]);
    }
  }
  // Any other IBAN-shaped string is a candidate too (it is how payee swaps show up).
  for (const m of text.matchAll(ANY_IBAN)) {
    const iban = bestIban(m[1]);
    if (iban) push("payee_iban", iban);
  }

  const fields: Partial<InvoiceRecord> = {};
  const first = (f: CanonicalField) => candidates[f]?.[0];
  if (first("vendor_id")) fields.vendor_id = first("vendor_id")!.toUpperCase();
  if (first("customer_id")) fields.customer_id = first("customer_id")!.toUpperCase();
  if (first("po_number")) fields.po_number = first("po_number")!.toUpperCase();
  if (first("invoice_number")) fields.invoice_number = first("invoice_number")!.toUpperCase();
  const d = first("invoice_date");
  if (d) {
    const iso = parseLooseDate(d);
    if (iso) fields.invoice_date = iso;
  }
  const amt = first("gross_amount_usd");
  if (amt) {
    const cents = parseCurrencyCents(amt, "en-US");
    if (cents !== null) fields.gross_amount_cents = cents;
  }
  const tax = first("tax_rate");
  if (tax) {
    const r = parsePercentValue(tax);
    if (r !== null) fields.tax_rate = r;
  }
  const lines = first("line_items_count");
  if (lines) fields.line_items_count = Number(lines);
  // The labelled IBAN wins over IBANs found elsewhere in the text.
  const labelled = [...text.matchAll(LABELS.find((l) => l.field === "payee_iban")!.re)].map((m) => bestIban(m[1])).find((v): v is string => !!v);
  if (labelled) fields.payee_iban = labelled;

  const surcharges: { label: string; cents: number }[] = [];
  for (const line of text.split("\n")) {
    const m = SURCHARGE.exec(line.trim());
    if (m) {
      const cents = parseCurrencyCents(m[2], "en-US");
      if (cents !== null) surcharges.push({ label: m[1].replace(/\s{2,}/g, " ").trim(), cents });
    }
  }
  const vendorLine = /^(?!INVOICE\b)([A-Z][A-Za-z&.,' -]{3,60}(?:LLC|Inc\.?|Co\.?|Supply|Supplies|Logistics|Industrial|Systems|Facilities|Electrical))\s*$/m.exec(text);

  const all: CanonicalField[] = ["vendor_id", "customer_id", "po_number", "invoice_number", "invoice_date", "gross_amount_usd", "tax_rate", "line_items_count", "payee_iban"];
  const missing = all.filter((f) => {
    if (f === "gross_amount_usd") return fields.gross_amount_cents === undefined;
    return (fields as Record<string, unknown>)[f] === undefined;
  });
  return { fields, candidates, missing, surcharges, vendorName: vendorLine?.[1]?.trim(), method };
}
