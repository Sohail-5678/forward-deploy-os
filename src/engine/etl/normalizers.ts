/**
 * The fixed, tested normalizer set. A TransformSpec only names these ops; this
 * file is the only code that interprets them (rule S1: no generated code).
 * Money is parsed from the string digits into integer cents, never via floats.
 */
import type { DateFormat, FieldKind, Normalizer } from "../types";
import { safeExtract } from "../security/safe-regex";
import { normalizeIban } from "../iban";

export type NormalizeResult = { ok: true; value: string | number } | { ok: false; error: string };

const ok = (value: string | number): NormalizeResult => ({ ok: true, value });
const fail = (error: string): NormalizeResult => ({ ok: false, error });

const CURRENCY_MARKERS = /(USD|US\$|EUR|GBP|\$|€|£)/gi;

/** "$18,450.00 USD" -> 1845000. Returns null when the string is not a money amount. */
export function parseCurrencyCents(input: string, locale: "en-US" | "de-DE" = "en-US"): number | null {
  let s = input.trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(CURRENCY_MARKERS, "").replace(/\s+/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  let intPart: string;
  let fracPart = "";
  if (locale === "en-US") {
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
    const [i, f = ""] = s.replace(/,/g, "").split(".");
    intPart = i;
    fracPart = f;
  } else {
    if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return null;
    const [i, f = ""] = s.replace(/\./g, "").split(",");
    intPart = i;
    fracPart = f;
  }
  if (fracPart.length > 2) {
    // Accept trailing zeros only; anything else would need rounding.
    if (!/^0*$/.test(fracPart.slice(2))) return null;
    fracPart = fracPart.slice(0, 2);
  }
  fracPart = fracPart.padEnd(2, "0");
  const cents = Number(intPart) * 100 + Number(fracPart);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * A second, deliberately different money parser used only by the
 * MONEY_SUM_CONSERVED invariant, so a bug in one parser is caught by the other.
 * It reads the digits and decides the decimal separator from the last one.
 */
export function independentMoneyCents(input: string): number | null {
  const negative = /^\s*\(.*\)\s*$/.test(input) || /^\s*-/.test(input) || /-\s*$/.test(input.replace(/[A-Za-z]+\s*$/, ""));
  const kept = input.replace(/[^0-9.,]/g, "");
  if (kept === "" || !/\d/.test(kept)) return null;
  const lastSep = Math.max(kept.lastIndexOf("."), kept.lastIndexOf(","));
  let units: string;
  let decimals: string;
  if (lastSep >= 0 && kept.length - lastSep - 1 > 0 && kept.length - lastSep - 1 <= 2) {
    units = kept.slice(0, lastSep).replace(/[.,]/g, "");
    decimals = kept.slice(lastSep + 1).padEnd(2, "0");
  } else if (lastSep >= 0 && kept.length - lastSep - 1 > 2 && /^0+$/.test(kept.slice(lastSep + 3))) {
    // "18450.000" style: more decimals but only zeros after the cents.
    units = kept.slice(0, lastSep).replace(/[.,]/g, "");
    decimals = kept.slice(lastSep + 1, lastSep + 3);
  } else {
    units = kept.replace(/[.,]/g, "");
    decimals = "00";
  }
  if (units === "") units = "0";
  let cents = 0;
  for (const d of units) cents = cents * 10 + (d.charCodeAt(0) - 48);
  cents = cents * 100 + Number(decimals);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Parse a decimal string into an exact numerator / power-of-ten pair. */
function decimalToFraction(s: string): { num: number; scale: number } | null {
  const m = /^([-+]?)(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? "";
  const num = Number(m[2] + frac) * (m[1] === "-" ? -1 : 1);
  if (!Number.isSafeInteger(num)) return null;
  return { num, scale: frac.length };
}

/** "8.25%" -> 0.0825, "0.0825" -> 0.0825. Values >= 1 without "%" are rejected. */
export function parsePercentValue(input: string): number | null {
  const s = input.trim().replace(/\s+/g, "");
  if (s.endsWith("%")) {
    const f = decimalToFraction(s.slice(0, -1));
    if (!f) return null;
    return f.num / 10 ** (f.scale + 2);
  }
  const f = decimalToFraction(s);
  if (!f) return null;
  const value = f.num / 10 ** f.scale;
  if (value < 0 || value >= 1) return null;
  return value;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function toIsoDate(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || !isValidCalendarDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse a date string in the given format into ISO 8601 (YYYY-MM-DD). */
export function parseDateValue(input: string, format: DateFormat): string | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  switch (format) {
    case "YYYY-MM-DD":
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      return m ? toIsoDate(+m[1], +m[2], +m[3]) : null;
    case "YYYYMMDD":
      m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
      return m ? toIsoDate(+m[1], +m[2], +m[3]) : null;
    case "DD.MM.YYYY":
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
      return m ? toIsoDate(+m[3], +m[2], +m[1]) : null;
    case "DD/MM/YYYY":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return m ? toIsoDate(+m[3], +m[2], +m[1]) : null;
    case "MM/DD/YYYY":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      return m ? toIsoDate(+m[3], +m[1], +m[2]) : null;
  }
}

export function applyNormalizer(n: Normalizer, input: string | number): NormalizeResult {
  const s = typeof input === "number" ? String(input) : input;
  switch (n.op) {
    case "trim":
      return ok(s.trim());
    case "upper":
      return ok(s.toUpperCase());
    case "lower":
      return ok(s.toLowerCase());
    case "removeWhitespace":
      return ok(s.replace(/\s+/g, ""));
    case "parseCurrency": {
      const cents = parseCurrencyCents(s, n.locale);
      return cents === null ? fail(`"${truncate(s)}" is not a ${n.locale} money amount`) : ok(cents);
    }
    case "parsePercent": {
      const v = parsePercentValue(s);
      return v === null ? fail(`"${truncate(s)}" is not a percent or fraction`) : ok(v);
    }
    case "parseDate": {
      const iso = parseDateValue(s, n.format);
      return iso === null ? fail(`"${truncate(s)}" is not a valid ${n.format} date`) : ok(iso);
    }
    case "parseInt": {
      const t = s.trim();
      if (!/^\+?\d{1,9}$/.test(t)) return fail(`"${truncate(s)}" is not a whole number`);
      return ok(Number(t));
    }
    case "regexExtract": {
      const out = safeExtract(n.pattern, n.group, s);
      return out === null ? fail(`pattern did not match "${truncate(s)}"`) : ok(out);
    }
  }
}

export function applyNormalizers(list: Normalizer[], raw: string): NormalizeResult {
  let value: string | number = raw;
  for (const n of list) {
    const r = applyNormalizer(n, value);
    if (!r.ok) return r;
    value = r.value;
  }
  return ok(value);
}

function truncate(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ---------------------------------------------------------------------------
// Canonical rendering (used by the IDEMPOTENT invariant and CSV export)
// ---------------------------------------------------------------------------

export function centsToDecimalString(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
}

/** Render a typed value back to its canonical string form for its kind. */
export function renderCanonical(kind: FieldKind, value: string | number): string {
  switch (kind) {
    case "money":
      return centsToDecimalString(Number(value));
    case "rate":
    case "int":
      return String(value);
    default:
      return String(value);
  }
}

/** Normalizers that parse a canonical string of this kind (identity on canonical data). */
export function canonicalNormalizers(kind: FieldKind): Normalizer[] {
  switch (kind) {
    case "money":
      return [{ op: "trim" }, { op: "parseCurrency", locale: "en-US" }];
    case "rate":
      return [{ op: "trim" }, { op: "parsePercent" }];
    case "int":
      return [{ op: "trim" }, { op: "parseInt" }];
    case "date":
      return [{ op: "trim" }, { op: "parseDate", format: "YYYY-MM-DD" }];
    case "iban":
      return [{ op: "trim" }, { op: "removeWhitespace" }, { op: "upper" }];
    case "vendorId":
    case "customerId":
    case "poNumber":
    case "invoiceNumber":
      return [{ op: "trim" }, { op: "upper" }];
    case "text":
      return [{ op: "trim" }];
  }
}

/** Strict validation of a canonical value (node 2 drift detection). */
export function validateCanonicalValue(kind: FieldKind, raw: string): { ok: true } | { ok: false; code: "TYPE_MISMATCH" | "DATE_FORMAT_DRIFT" | "CURRENCY_STRING_CONTAMINATION" | "PERCENT_STRING"; message: string } {
  const v = raw.trim();
  switch (kind) {
    case "vendorId":
      return /^V-\d{4}$/.test(v) ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected V-#### vendor id" };
    case "customerId":
      return /^C-\d{4}$/.test(v) ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected C-#### customer id" };
    case "poNumber":
      return /^PO-\d{5}$/.test(v) ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected PO-##### purchase order" };
    case "invoiceNumber":
      return v.length > 0 && v.length <= 40 ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected a non-empty invoice number" };
    case "date":
      if (/^\d{4}-\d{2}-\d{2}$/.test(v) && parseDateValue(v, "YYYY-MM-DD")) return { ok: true };
      if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$|^\d{8}$/.test(v)) return { ok: false, code: "DATE_FORMAT_DRIFT", message: "date is not ISO 8601" };
      return { ok: false, code: "TYPE_MISMATCH", message: "expected an ISO 8601 date" };
    case "money":
      if (/^-?\d+\.\d{2}$/.test(v)) return { ok: true };
      if (parseCurrencyCents(v, "en-US") !== null || parseCurrencyCents(v, "de-DE") !== null) {
        return { ok: false, code: "CURRENCY_STRING_CONTAMINATION", message: "amount contains currency symbols or separators" };
      }
      return { ok: false, code: "TYPE_MISMATCH", message: "expected a decimal amount like 18450.00" };
    case "rate":
      if (/^0?\.\d+$|^0$/.test(v)) return { ok: true };
      if (/%\s*$/.test(v)) return { ok: false, code: "PERCENT_STRING", message: "rate is a percent string" };
      return { ok: false, code: "TYPE_MISMATCH", message: "expected a fraction like 0.0825" };
    case "int":
      return /^\d+$/.test(v) ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected a whole number" };
    case "iban":
      return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v) ? { ok: true } : { ok: false, code: "TYPE_MISMATCH", message: "expected a compact IBAN" };
    case "text":
      return { ok: true };
  }
}

export function canonicalIban(value: string): string {
  return normalizeIban(value);
}
