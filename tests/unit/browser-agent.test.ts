import { describe, expect, it } from "vitest";
import { createJsdomPortal } from "../../scripts/lib/jsdom-portal";
import { recordSelectorCache } from "../../scripts/lib/record-cache";
import { PortalExecutor, type ExecutorContext } from "@/engine/browser/executor";
import { SelectorCache } from "@/engine/browser/selector-healer";
import { runBaselineScript } from "@/engine/browser/baseline";
import { DEFAULT_HEALING } from "@/engine/config";
import { fixedClock } from "@/engine/clock";
import { VENDOR_MASTER, ERP_PURCHASE_ORDERS, ATTACKER_IBAN, SCENARIOS } from "@/engine/data/scenarios";
import { idempotencyKey } from "@/engine/etl/idempotency";
import type { ApprovedRecord, EngineEvent, InvoiceRecord } from "@/engine/types";

function approved(inv: InvoiceRecord, extra: Partial<ApprovedRecord> = {}): ApprovedRecord {
  const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === inv.po_number)!;
  return { recordId: `t#${inv.invoice_number}`, invoice: inv, idempotencyKey: idempotencyKey(inv), approval: "auto", costCenter: po.cost_center, ...extra };
}

function ctxFor(driver: ExecutorContext["driver"], over: Partial<ExecutorContext> = {}) {
  const events: { type: string; payload: unknown }[] = [];
  const ctx: ExecutorContext = {
    driver,
    cache: new SelectorCache(),
    healing: DEFAULT_HEALING,
    vendorMaster: VENDOR_MASTER,
    clock: fixedClock(),
    emit: (type, payload) => events.push({ type, payload }),
    planner: "deterministic",
    useCache: false,
    attackerIban: ATTACKER_IBAN,
    selectorPicks: {},
    ...over,
  };
  return { ctx, events: events as unknown as EngineEvent[] };
}

describe("distiller on the clean portal", () => {
  it("prints numbered lines with labels, values and hidden-tab hints", async () => {
    const portal = await createJsdomPortal({ loggedIn: true });
    await portal.load("invoice-entry.html");
    const snap = await portal.driver.distill();
    const text = snap.text;
    expect(text).toMatch(/\[\d+\] textbox "Vendor ID" value="" required/);
    expect(text).toMatch(/combobox "Cost Center \/ GL Account" options=\["4010-MFG","4020-LOG","4090-OPS","4110-MED"\]/);
    expect(text).toMatch(/textbox "Invoice Total \(USD\)" value="" required \(tab "Amounts"\)/);
    expect(text).toMatch(/button "Post to General Ledger"/);
    expect(text).not.toMatch(/Override code/);
    expect(snap.rawHtml.length).toBeGreaterThan(snap.text.length * 3);
    portal.close();
  });
});

describe("executor", () => {
  it("logs on, reads before write, fills the tabbed form and posts", async () => {
    const portal = await createJsdomPortal();
    const { ctx, events } = ctxFor(portal.driver);
    const exec = new PortalExecutor(ctx);
    const rec = approved(SCENARIOS[2].csv[0].records[0]);
    const res = await exec.processRecord(rec);
    expect(res.outcome.kind, JSON.stringify(res.outcome)).toBe("posted");
    const ledger = await portal.driver.readLedger();
    const entry = ledger.find((e) => e.invoice_number === rec.invoice.invoice_number)!;
    expect(entry.amount_cents).toBe(rec.invoice.gross_amount_cents);
    expect(entry.iban).toBe(rec.invoice.payee_iban);
    expect(events.some((e) => e.type === "POSTED")).toBe(true);
    // Second run: read-before-write prevents a duplicate.
    const again = await new PortalExecutor(ctxFor(portal.driver).ctx).processRecord(rec);
    expect(again.outcome.kind).toBe("duplicate");
    portal.close();
  });

  it("posts an approved override with the bound override code", async () => {
    const portal = await createJsdomPortal();
    const inv = SCENARIOS[2].csv[0].records[1]; // $14,200 vs PO $12,400
    const rec = approved(inv, { approval: "human", overrideCode: "OVR-1A2B3C" });
    const res = await new PortalExecutor(ctxFor(portal.driver).ctx).processRecord(rec);
    expect(res.outcome.kind, JSON.stringify(res.outcome)).toBe("posted");
    const entry = (await portal.driver.readLedger()).find((e) => e.invoice_number === inv.invoice_number)!;
    expect(entry.amount_cents).toBe(1420000);
    expect(entry.overrideCode).toBe("OVR-1A2B3C");
    portal.close();
  });

  it("without an approved override the portal refusal stops the record", async () => {
    const portal = await createJsdomPortal();
    const inv = SCENARIOS[2].csv[0].records[1];
    const res = await new PortalExecutor(ctxFor(portal.driver).ctx).processRecord(approved(inv));
    expect(res.outcome.kind).toBe("failed");
    expect(JSON.stringify(res.outcome)).toMatch(/ERR-4471/);
    portal.close();
  });

  it("heals broken selectors after the weekend release and handles the session dialog", async () => {
    const recorded = await recordSelectorCache();
    const portal = await createJsdomPortal({ chaos: { seed: 20261014, types: ["ids", "labels", "nesting", "interstitial"] } });
    const { ctx, events } = ctxFor(portal.driver, { cache: new SelectorCache(recorded), useCache: true });
    const rec = approved(SCENARIOS[3].csv[0].records[0]);
    const baseline = await runBaselineScript(portal.driver, rec, 300);
    expect(baseline.ok).toBe(false);
    expect(baseline.error).toMatch(/selector not found: #/);
    const res = await new PortalExecutor(ctx).processRecord(rec);
    const heals = events.filter((e) => e.type === "SELECTOR_HEALED");
    expect(res.outcome.kind, JSON.stringify(res.outcome) + JSON.stringify(res.heals.map((h) => [h.key, h.outcome, h.similarity]))).toBe("posted");
    expect(heals.length).toBeGreaterThan(3);
    expect(res.dialogsDismissed).toBe(1);
    portal.close();
  });

  it("a hijacked planner cannot pay an attacker: literal values rejected, bad actions blocked", async () => {
    const portal = await createJsdomPortal();
    const { ctx, events } = ctxFor(portal.driver, { planner: "hijacked" });
    const rec = approved(SCENARIOS[4].csv[0].records[0]);
    const res = await new PortalExecutor(ctx).processRecord(rec);
    expect(res.outcome.kind).toBe("blocked");
    const planned = events.find((e) => e.type === "ACTION_PLANNED")!.payload as { rejected: unknown[] };
    expect(planned.rejected.length).toBe(2);
    expect(events.some((e) => e.type === "GUARD_BLOCKED")).toBe(true);
    const ledger = await portal.driver.readLedger();
    expect(ledger.some((e) => e.iban === ATTACKER_IBAN)).toBe(false);
    expect(ledger.some((e) => e.invoice_number === rec.invoice.invoice_number)).toBe(false);
    portal.close();
  });
});
