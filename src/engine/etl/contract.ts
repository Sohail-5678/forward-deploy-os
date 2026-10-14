import type { CanonicalField, ContractDef, ContractField, FieldKind } from "../types";

/** Canonical contract v1 (spec section 7). Editable in Sandbox mode. */
export const CONTRACT_V1: ContractDef = {
  version: "contract v1",
  fields: [
    { key: "vendor_id", canonical: "vendor_id", kind: "vendorId", required: true, aliases: ["supplier"], description: "Vendor master identifier" },
    { key: "customer_id", canonical: "customer_id", kind: "customerId", required: true, aliases: [], description: "Customer identifier" },
    { key: "po_number", canonical: "po_number", kind: "poNumber", required: true, aliases: [], description: "Purchase order identifier" },
    { key: "invoice_number", canonical: "invoice_number", kind: "invoiceNumber", required: true, aliases: [], description: "Invoice identifier" },
    { key: "invoice_date", canonical: "invoice_date", kind: "date", required: true, aliases: [], description: "Invoice date" },
    { key: "gross_amount_usd", canonical: "gross_amount_usd", kind: "money", required: true, aliases: [], description: "Gross invoice amount" },
    { key: "tax_rate", canonical: "tax_rate", kind: "rate", required: true, aliases: [], description: "Tax rate" },
    { key: "line_items_count", canonical: "line_items_count", kind: "int", required: true, aliases: [], description: "Line item count" },
    { key: "payee_iban", canonical: "payee_iban", kind: "iban", required: true, aliases: [], description: "Payee bank account" },
  ],
};

export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  "vendor_id",
  "customer_id",
  "po_number",
  "invoice_number",
  "invoice_date",
  "gross_amount_usd",
  "tax_rate",
  "line_items_count",
  "payee_iban",
];

export const CANONICAL_KIND: Readonly<Record<CanonicalField, FieldKind>> = {
  vendor_id: "vendorId",
  customer_id: "customerId",
  po_number: "poNumber",
  invoice_number: "invoiceNumber",
  invoice_date: "date",
  gross_amount_usd: "money",
  tax_rate: "rate",
  line_items_count: "int",
  payee_iban: "iban",
};

/** Fields the OmniCorp invoice form cannot post without. They can be renamed but not removed. */
export const PORTAL_REQUIRED: readonly CanonicalField[] = [
  "vendor_id",
  "po_number",
  "invoice_number",
  "invoice_date",
  "gross_amount_usd",
  "payee_iban",
];

export const FIELD_LABELS: Readonly<Record<CanonicalField, string>> = {
  vendor_id: "Vendor ID",
  customer_id: "Customer ID",
  po_number: "PO Number",
  invoice_number: "Invoice Number",
  invoice_date: "Invoice Date",
  gross_amount_usd: "Gross Amount (USD)",
  tax_rate: "Tax Rate",
  line_items_count: "Line Items",
  payee_iban: "Payee IBAN",
};

export function cloneContract(c: ContractDef): ContractDef {
  return { version: c.version, fields: c.fields.map((f) => ({ ...f, aliases: [...f.aliases] })) };
}

export function fieldForCanonical(contract: ContractDef, canonical: CanonicalField): ContractField | undefined {
  return contract.fields.find((f) => f.canonical === canonical);
}

export interface ContractEditResult {
  ok: boolean;
  contract: ContractDef;
  errors: string[];
}

/** Validate a user-edited contract (Sandbox). */
export function validateContract(contract: ContractDef): ContractEditResult {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const f of contract.fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(f.key)) errors.push(`"${f.key}" is not a valid column name (letters, digits, underscore).`);
    if (keys.has(f.key)) errors.push(`Duplicate column name "${f.key}".`);
    keys.add(f.key);
  }
  for (const c of PORTAL_REQUIRED) {
    const f = fieldForCanonical(contract, c);
    if (!f) errors.push(`The portal needs ${FIELD_LABELS[c]}; it can be renamed but not removed.`);
    else if (!f.required) errors.push(`${FIELD_LABELS[c]} must stay required: the portal cannot post without it.`);
  }
  const seenCanonical = new Set<string>();
  for (const f of contract.fields) {
    if (!f.canonical) continue;
    if (seenCanonical.has(f.canonical)) errors.push(`Two fields are bound to ${f.canonical}.`);
    seenCanonical.add(f.canonical);
  }
  if (contract.fields.length > 40) errors.push("A contract can have at most 40 fields.");
  return { ok: errors.length === 0, contract, errors };
}
