/**
 * Value binding (spec 8.5): the only place that turns a field reference into
 * the literal string typed into the portal. Values come from the validated,
 * human-approved record, formatted for the portal field. A planner (even a
 * hijacked one) can choose which approved field goes into which box; it can
 * never invent a value.
 */
import type { ApprovedRecord, BindableField } from "../types";
import { centsToDecimalString } from "../etl/normalizers";
import { formatIsoAs } from "../etl/date-format";
import { PORTAL_DEMO_LOGIN } from "../config";

export interface FieldHint {
  label?: string;
  placeholder?: string;
}

export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

function portalDateFormat(hint: FieldHint): "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" {
  const p = (hint.placeholder ?? "").toUpperCase();
  if (p.includes("DD/MM")) return "DD/MM/YYYY";
  if (p.includes("YYYY-MM")) return "YYYY-MM-DD";
  return "MM/DD/YYYY"; // the 2009 portal is a US system
}

export function bindValue(record: ApprovedRecord, ref: BindableField, hint: FieldHint = {}): string {
  const r = record.invoice;
  switch (ref) {
    case "vendor_id":
      return r.vendor_id;
    case "customer_id":
      return r.customer_id;
    case "po_number":
      return r.po_number;
    case "invoice_number":
      return r.invoice_number;
    case "invoice_date":
      return formatIsoAs(r.invoice_date, portalDateFormat(hint));
    case "gross_amount_usd":
      return centsToDecimalString(r.gross_amount_cents);
    case "tax_rate":
      return String(Number((r.tax_rate * 100).toFixed(4)));
    case "line_items_count":
      return String(r.line_items_count);
    case "payee_iban":
      return r.payee_iban;
    case "cost_center":
      return record.costCenter;
    case "override_code":
      if (!record.overrideCode) throw new BindingError("No approved override for this record; refusing to bind an override code.");
      return record.overrideCode;
  }
}

/** Login values are fixed configuration printed on the fictional portal, never model output. */
export function bindLogin(field: "username" | "password"): string {
  return PORTAL_DEMO_LOGIN[field];
}
