import { sha256Hex } from "../hash";

/** idempotency_key = sha256(vendor_id | po_number | invoice_number | gross_amount_cents) (spec 8.7) */
export function idempotencyKey(r: { vendor_id: string; po_number: string; invoice_number: string; gross_amount_cents: number }): string {
  return sha256Hex(`${r.vendor_id}|${r.po_number}|${r.invoice_number}|${r.gross_amount_cents}`);
}
