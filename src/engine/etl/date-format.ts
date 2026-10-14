/**
 * Date format inference. If any day value is above 12 the format is decided.
 * If every value is ambiguous (both parts <= 12) we do NOT guess: the caller
 * raises AMBIGUOUS_DATE_FORMAT and escalates to a human (spec 8.1).
 */
import type { DateFormat, ValueFamily } from "../types";
import { classifyValue } from "./value-profile";
import { parseDateValue } from "./normalizers";

export interface DateInference {
  status: "decided" | "ambiguous" | "invalid" | "not-a-date";
  format?: DateFormat;
  candidates: DateFormat[];
  reason: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function inferDateFormat(values: string[]): DateInference {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== "");
  if (nonEmpty.length === 0) return { status: "not-a-date", candidates: [], reason: "no values" };
  const counts = new Map<ValueFamily, number>();
  for (const v of nonEmpty) {
    const f = classifyValue(v);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const familyValues = nonEmpty.filter((v) => classifyValue(v) === dominant);
  switch (dominant) {
    case "ISO_DATE":
      return { status: "decided", format: "YYYY-MM-DD", candidates: ["YYYY-MM-DD"], reason: "ISO 8601 dates" };
    case "COMPACT_DATE":
      return { status: "decided", format: "YYYYMMDD", candidates: ["YYYYMMDD"], reason: "compact YYYYMMDD dates" };
    case "DOTTED_DATE": {
      const bad = familyValues.find((v) => parseDateValue(v, "DD.MM.YYYY") === null);
      if (bad) return { status: "invalid", candidates: ["DD.MM.YYYY"], reason: `"${bad}" is not a valid DD.MM.YYYY date` };
      return { status: "decided", format: "DD.MM.YYYY", candidates: ["DD.MM.YYYY"], reason: "dotted day-first dates" };
    }
    case "SLASH_DATE": {
      let firstOver12: string | undefined;
      let secondOver12: string | undefined;
      for (const v of familyValues) {
        const [a, b] = v.split("/").map(Number);
        if (a > 12 && !firstOver12) firstOver12 = v;
        if (b > 12 && !secondOver12) secondOver12 = v;
      }
      if (firstOver12 && secondOver12) {
        return { status: "invalid", candidates: ["DD/MM/YYYY", "MM/DD/YYYY"], reason: `mixed: "${firstOver12}" is day-first but "${secondOver12}" is month-first` };
      }
      if (firstOver12) {
        const bad = familyValues.find((v) => parseDateValue(v, "DD/MM/YYYY") === null);
        if (bad) return { status: "invalid", candidates: ["DD/MM/YYYY"], reason: `"${bad}" is not a valid DD/MM/YYYY date` };
        return { status: "decided", format: "DD/MM/YYYY", candidates: ["DD/MM/YYYY"], reason: `"${firstOver12}" has a day above 12, so dates are day-first` };
      }
      if (secondOver12) {
        const bad = familyValues.find((v) => parseDateValue(v, "MM/DD/YYYY") === null);
        if (bad) return { status: "invalid", candidates: ["MM/DD/YYYY"], reason: `"${bad}" is not a valid MM/DD/YYYY date` };
        return { status: "decided", format: "MM/DD/YYYY", candidates: ["MM/DD/YYYY"], reason: `"${secondOver12}" has a day above 12, so dates are month-first` };
      }
      return {
        status: "ambiguous",
        candidates: ["DD/MM/YYYY", "MM/DD/YYYY"],
        reason: `all ${familyValues.length} values have both parts at or below 12; day-first and month-first are both valid`,
      };
    }
    default:
      return { status: "not-a-date", candidates: [], reason: `values look like ${dominant}` };
  }
}

/** "03/04/2026" read as DD/MM/YYYY -> "3 April 2026". */
export function readDateHuman(value: string, format: DateFormat): string {
  const iso = parseDateValue(value, format);
  if (!iso) return "not a valid date";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatIsoAs(iso: string, format: DateFormat): string {
  const [y, m, d] = iso.split("-");
  switch (format) {
    case "YYYY-MM-DD":
      return iso;
    case "YYYYMMDD":
      return `${y}${m}${d}`;
    case "DD.MM.YYYY":
      return `${d}.${m}.${y}`;
    case "DD/MM/YYYY":
      return `${d}/${m}/${y}`;
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
  }
}
