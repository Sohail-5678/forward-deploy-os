/**
 * Value fingerprints: what sampled values look like. The matcher compares a
 * column's family distribution with what each target field expects.
 */
import type { ColumnProfile, ValueFamily } from "../types";
import { isValidIban } from "../iban";

const RE = {
  po: /^PO[-_ ]?\d{3,}$/i,
  vendor: /^V[-_]?\d{3,}$/i,
  customer: /^C[-_]?\d{3,}$/i,
  invoice: /^(INV|BILL|IN)[-_ ]?[A-Z0-9][A-Z0-9-]{1,}$/i,
  iso: /^\d{4}-\d{2}-\d{2}$/,
  dotted: /^\d{1,2}\.\d{1,2}\.\d{4}$/,
  slash: /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  compact: /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/,
  percent: /^[-+]?\d+([.,]\d+)?\s?%$/,
  currencyMarker: /(USD|US\$|EUR|GBP|\$|€|£)/i,
  currencyBody: /^[-(]?\s*(USD|US\$|EUR|GBP|\$|€|£)?\s*[-]?\d{1,3}([,.' ]\d{3})*([.,]\d{1,2})?\s*(USD|EUR|GBP|\$|€|£)?\s*\)?$/i,
  thousands: /\d{1,3}([,.' ]\d{3})+([.,]\d{1,2})?$/,
  decimal: /^[-+]?\d+\.\d+$/,
  int: /^\d{1,4}$/,
  ibanLoose: /^[A-Z]{2}\d{2}[A-Z0-9 ]{10,40}$/i,
};

export function classifyValue(raw: string): ValueFamily {
  const v = raw.trim();
  if (v === "") return "EMPTY";
  if (RE.po.test(v)) return "PO_ID";
  if (RE.vendor.test(v)) return "VENDOR_ID";
  if (RE.customer.test(v)) return "CUSTOMER_ID";
  if (RE.ibanLoose.test(v) && isValidIban(v)) return "IBAN";
  if (RE.invoice.test(v)) return "INVOICE_ID";
  if (RE.iso.test(v)) return "ISO_DATE";
  if (RE.dotted.test(v)) return "DOTTED_DATE";
  if (RE.slash.test(v)) return "SLASH_DATE";
  if (RE.compact.test(v)) return "COMPACT_DATE";
  if (RE.percent.test(v)) return "PERCENT";
  if (RE.currencyBody.test(v) && (RE.currencyMarker.test(v) || RE.thousands.test(v.replace(/[^\d.,' ]/g, "")))) {
    return "CURRENCY_STRING";
  }
  if (RE.decimal.test(v)) {
    const n = Number(v);
    return n >= 0 && n < 1 ? "UNIT_DECIMAL" : "DECIMAL";
  }
  if (RE.int.test(v)) return "SMALL_INT";
  return "TEXT";
}

export function profileColumn(column: string, values: string[], maxSamples = 60): ColumnProfile {
  const sample = values.slice(0, maxSamples);
  const counts: Partial<Record<ValueFamily, number>> = {};
  let empty = 0;
  for (const v of sample) {
    const fam = classifyValue(v);
    if (fam === "EMPTY") {
      empty++;
      continue;
    }
    counts[fam] = (counts[fam] ?? 0) + 1;
  }
  const nonEmpty = sample.length - empty;
  const families: Partial<Record<ValueFamily, number>> = {};
  let dominant: ValueFamily = "EMPTY";
  let best = 0;
  for (const [fam, c] of Object.entries(counts) as [ValueFamily, number][]) {
    families[fam] = nonEmpty > 0 ? c / nonEmpty : 0;
    if (c > best) {
      best = c;
      dominant = fam;
    }
  }
  const trimmed = sample.map((v) => v.trim()).filter((v) => v !== "");
  const uniqueness = trimmed.length > 0 ? new Set(trimmed).size / trimmed.length : 0;
  return {
    column,
    families,
    dominant,
    uniqueness,
    emptyFraction: sample.length > 0 ? empty / sample.length : 1,
    samples: trimmed.slice(0, 8),
  };
}

export const FAMILY_REGEX_LABEL: Record<ValueFamily, string> = {
  PO_ID: "/^PO-\\d+$/",
  VENDOR_ID: "/^V-\\d+$/",
  CUSTOMER_ID: "/^C-\\d+$/",
  INVOICE_ID: "/^INV-[A-Z0-9-]+$/",
  ISO_DATE: "ISO date YYYY-MM-DD",
  DOTTED_DATE: "dotted date DD.MM.YYYY",
  SLASH_DATE: "slash date ??/??/YYYY",
  COMPACT_DATE: "compact date YYYYMMDD",
  CURRENCY_STRING: "currency string ($, USD, thousands separators)",
  DECIMAL: "decimal number",
  UNIT_DECIMAL: "fraction between 0 and 1",
  PERCENT: "percent string",
  SMALL_INT: "small integer",
  IBAN: "IBAN with valid mod-97 checksum",
  TEXT: "free text",
  EMPTY: "empty",
};
