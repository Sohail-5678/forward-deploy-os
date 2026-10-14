import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCurrencyCents, parseDateValue, parsePercentValue, canonicalIban } from "@/engine/etl/normalizers";
import { renderDate, renderMoney, renderRate, type DateRender, type MoneyFormat } from "@/engine/data/render";
import { formatIban, isValidIban, normalizeIban } from "@/engine/iban";
import { idempotencyKey } from "@/engine/etl/idempotency";
import { VENDOR_MASTER } from "@/engine/data/scenarios";
import type { DateFormat } from "@/engine/types";

const SEED = 20261014;
const opts = { seed: SEED, numRuns: 400 };

describe("normalizer laws (fast-check)", () => {
  const money: MoneyFormat[] = ["canonical", "usd_suffix", "usd_prefix", "dollar", "plain_commas", "de"];
  it.each(money)("parseCurrency(render(x, %s)) == x", (fmt) => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999_999 }), (cents) => {
        expect(parseCurrencyCents(renderMoney(cents, fmt), fmt === "de" ? "de-DE" : "en-US")).toBe(cents);
      }),
      opts,
    );
  });

  const dates: [DateRender, DateFormat][] = [
    ["iso", "YYYY-MM-DD"],
    ["dotted", "DD.MM.YYYY"],
    ["slash_dmy", "DD/MM/YYYY"],
    ["slash_mdy", "MM/DD/YYYY"],
    ["compact", "YYYYMMDD"],
  ];
  it.each(dates)("parseDate(render(d, %s)) == d", (render, format) => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2049, 11, 31) }), (t) => {
        const iso = new Date(t).toISOString().slice(0, 10);
        expect(parseDateValue(renderDate(iso, render), format)).toBe(iso);
      }),
      opts,
    );
  });

  it.each(["fraction", "percent", "percent_space"] as const)("parsePercent(render(r, %s)) == r", (fmt) => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (bp) => {
        const rate = bp / 10_000;
        expect(parsePercentValue(renderRate(rate, fmt))).toBeCloseTo(rate, 10);
      }),
      opts,
    );
  });

  it("IBAN spacing is irrelevant and every vendor master IBAN is valid", () => {
    for (const v of VENDOR_MASTER) {
      expect(isValidIban(v.iban)).toBe(true);
      expect(normalizeIban(formatIban(v.iban))).toBe(normalizeIban(v.iban));
      expect(canonicalIban(formatIban(v.iban))).toBe(canonicalIban(v.iban));
    }
  });

  it("idempotency keys are stable and change when any key field changes", () => {
    const rec = fc.record({
      vendor_id: fc.integer({ min: 1000, max: 9999 }).map((n) => `V-${n}`),
      po_number: fc.integer({ min: 10000, max: 99999 }).map((n) => `PO-${n}`),
      invoice_number: fc.integer({ min: 1, max: 999999 }).map((n) => `INV-${n}`),
      gross_amount_cents: fc.integer({ min: 1, max: 1e10 }),
    });
    fc.assert(
      fc.property(rec, fc.constantFrom("vendor_id", "po_number", "invoice_number", "gross_amount_cents"), (r, field) => {
        expect(idempotencyKey({ ...r })).toBe(idempotencyKey(r));
        const changed = { ...r, [field]: field === "gross_amount_cents" ? r.gross_amount_cents + 1 : `${r[field as "vendor_id"]}X` };
        expect(idempotencyKey(changed)).not.toBe(idempotencyKey(r));
      }),
      opts,
    );
  });
});
