/**
 * Policy gate (spec 8.3, rule S3: policy beats confidence). Hard rules
 * escalate to a human regardless of any confidence score; the calibrated
 * confidence is a second, softer check.
 */
import type { DecisionOption, PolicyConfig, PolicyHit, Reconciliation, VendorMasterEntry } from "../types";
import { normalizeIban } from "../iban";
import { formatUsd, formatPct } from "../format";

export function evaluatePolicy(rec: Reconciliation, policy: PolicyConfig, vendorMaster: VendorMasterEntry[], securityFindingIds: string[]): PolicyHit[] {
  const hits: PolicyHit[] = [];
  const amount = rec.fields.find((f) => f.field === "gross_amount_usd");
  const abs = amount?.absDeltaCents ?? 0;
  const rel = amount?.relDelta ?? 0;
  if (abs > policy.absToleranceCents) hits.push({ rule: "AMOUNT_DELTA_ABS", deltaCents: abs, limitCents: policy.absToleranceCents });
  if (rel > policy.relTolerance) hits.push({ rule: "AMOUNT_DELTA_REL", rel, limit: policy.relTolerance });
  const master = vendorMaster.find((v) => v.vendor_id === rec.invoice.vendor_id);
  if (!master) hits.push({ rule: "UNKNOWN_VENDOR", vendor_id: rec.invoice.vendor_id || "(missing)" });
  if (!master || normalizeIban(rec.invoice.payee_iban) !== normalizeIban(master.iban)) {
    hits.push({ rule: "PAYEE_NOT_IN_VENDOR_MASTER", iban: rec.invoice.payee_iban || "(missing)" });
  }
  for (const id of securityFindingIds.slice(0, 3)) hits.push({ rule: "SECURITY_FINDING", findingId: id });
  if (rec.confidence < policy.confidenceThreshold) hits.push({ rule: "LOW_CONFIDENCE", confidence: rec.confidence, threshold: policy.confidenceThreshold });
  return hits;
}

export function isHardRule(hit: PolicyHit): boolean {
  return hit.rule !== "LOW_CONFIDENCE";
}

export function describeHit(hit: PolicyHit): string {
  switch (hit.rule) {
    case "AMOUNT_DELTA_ABS":
      return `Amount differs by ${formatUsd(hit.deltaCents)} (limit ${formatUsd(hit.limitCents)})`;
    case "AMOUNT_DELTA_REL":
      return `Amount differs by ${formatPct(hit.rel)} (limit ${formatPct(hit.limit)})`;
    case "PAYEE_NOT_IN_VENDOR_MASTER":
      return "Payee IBAN is not the vendor master IBAN";
    case "UNKNOWN_VENDOR":
      return `Vendor ${hit.vendor_id} is not in the vendor master`;
    case "LOW_CONFIDENCE":
      return `Calibrated confidence ${hit.confidence.toFixed(2)} is below ${hit.threshold.toFixed(2)}`;
    case "SECURITY_FINDING":
      return `Security finding ${hit.findingId}`;
  }
}

/** Decision options offered for a policy escalation, with keyboard shortcuts 1/2/3. */
export function policyOptions(hits: PolicyHit[], rec: Reconciliation): DecisionOption[] {
  const amountHit = hits.some((h) => h.rule === "AMOUNT_DELTA_ABS" || h.rule === "AMOUNT_DELTA_REL");
  const payeeOrVendor = hits.some((h) => h.rule === "PAYEE_NOT_IN_VENDOR_MASTER" || h.rule === "UNKNOWN_VENDOR" || h.rule === "SECURITY_FINDING");
  if (amountHit && !payeeOrVendor && rec.erp) {
    return [
      { choice: "ENFORCE_PO", label: `Enforce PO amount (${formatUsd(rec.erp.authorized_cents)})`, description: "Post the authorized amount and record a short-pay note.", recommended: true, shortcut: "1" },
      { choice: "APPROVE_OVERRIDE", label: `Approve override (${formatUsd(rec.invoice.gross_amount_cents)})`, description: "Post the invoiced amount with an override code bound from this decision.", shortcut: "2" },
      { choice: "MANUAL_AUDIT", label: "Send to manual audit", description: "Post nothing; queue the invoice for AP review.", shortcut: "3" },
    ];
  }
  if (payeeOrVendor) {
    return [
      { choice: "MANUAL_AUDIT", label: "Send to manual audit", description: "Post nothing; queue the invoice for AP review.", recommended: true, shortcut: "1" },
      { choice: "REJECT", label: "Reject invoice", description: "Record the rejection in the audit log; post nothing.", shortcut: "2" },
      { choice: "APPROVE_AS_IS", label: "Approve as-is", description: "The tool boundary guard still checks the payee against the vendor master.", shortcut: "3" },
    ];
  }
  return [
    { choice: "APPROVE_AS_IS", label: "Approve as-is", description: "Post the record exactly as reconciled.", shortcut: "1" },
    { choice: "MANUAL_AUDIT", label: "Send to manual audit", description: "Post nothing; queue the invoice for AP review.", recommended: true, shortcut: "2" },
    { choice: "REJECT", label: "Reject invoice", description: "Record the rejection in the audit log; post nothing.", shortcut: "3" },
  ];
}
