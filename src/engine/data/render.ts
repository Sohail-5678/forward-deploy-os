/**
 * Render canonical invoice values in the formats real vendor exports use.
 * Shared by the scenario sample generator, the drift benchmark generator and
 * the property tests, so "what drift looks like" is defined in one place.
 */
import type { CanonicalField, InvoiceRecord } from "../types";
import { formatIban } from "../iban";
import { centsToDecimalString } from "../etl/normalizers";

export type MoneyFormat = "canonical" | "usd_suffix" | "usd_prefix" | "dollar" | "plain_commas" | "de";
export type DateRender = "iso" | "dotted" | "slash_dmy" | "slash_mdy" | "compact";
export type RateFormat = "fraction" | "percent" | "percent_space";
export type IbanFormat = "compact" | "spaced";
export type IdFormat = "canonical" | "lower" | "padded";

export interface ValueFormats {
  money: MoneyFormat;
  date: DateRender;
  rate: RateFormat;
  iban: IbanFormat;
  id: IdFormat;
}

export const CANONICAL_FORMATS: ValueFormats = { money: "canonical", date: "iso", rate: "fraction", iban: "compact", id: "canonical" };

function groupThousands(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function renderMoney(cents: number, format: MoneyFormat): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const sign = neg ? "-" : "";
  switch (format) {
    case "canonical":
      return sign + centsToDecimalString(abs);
    case "usd_suffix":
      return `${sign}$${groupThousands(units, ",")}.${frac} USD`;
    case "usd_prefix":
      return `${sign}USD ${groupThousands(units, ",")}.${frac}`;
    case "dollar":
      return `${sign}$${groupThousands(units, ",")}.${frac}`;
    case "plain_commas":
      return `${sign}${groupThousands(units, ",")}.${frac}`;
    case "de":
      return `${sign}${groupThousands(units, ".")},${frac} €`;
  }
}

export function renderDate(iso: string, format: DateRender): string {
  const [y, m, d] = iso.split("-");
  switch (format) {
    case "iso":
      return iso;
    case "dotted":
      return `${d}.${m}.${y}`;
    case "slash_dmy":
      return `${d}/${m}/${y}`;
    case "slash_mdy":
      return `${m}/${d}/${y}`;
    case "compact":
      return `${y}${m}${d}`;
  }
}

/** Exact decimal rendering of a rate (avoids float artifacts like 8.250000000000002). */
export function renderRate(rate: number, format: RateFormat): string {
  if (format === "fraction") return rate === 0 ? "0.0" : String(rate);
  const pct = Number((rate * 100).toFixed(6));
  const s = String(pct);
  return format === "percent" ? `${s}%` : `${s} %`;
}

export function renderId(id: string, format: IdFormat): string {
  switch (format) {
    case "canonical":
      return id;
    case "lower":
      return id.toLowerCase();
    case "padded":
      return `  ${id} `;
  }
}

export function renderField(rec: InvoiceRecord, field: CanonicalField, f: ValueFormats): string {
  switch (field) {
    case "vendor_id":
    case "customer_id":
    case "po_number":
    case "invoice_number":
      return renderId(rec[field], f.id);
    case "invoice_date":
      return renderDate(rec.invoice_date, f.date);
    case "gross_amount_usd":
      return renderMoney(rec.gross_amount_cents, f.money);
    case "tax_rate":
      return renderRate(rec.tax_rate, f.rate);
    case "line_items_count":
      return String(rec.line_items_count);
    case "payee_iban":
      return f.iban === "spaced" ? formatIban(rec.payee_iban) : rec.payee_iban;
  }
}
