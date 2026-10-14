/**
 * The brittle "baseline script" (Scenario 3): plain CSS id selectors recorded
 * before the portal's weekend release, no healing. It runs for real against
 * the portal and fails the way recorded RPA scripts fail. It stops before the
 * submit click so it can never post anything (dry run).
 */
import type { ApprovedRecord, BaselineResult } from "../types";
import type { PortalDriver } from "./driver";
import { PortalError } from "./driver";
import { bindValue } from "./binder";
import { now } from "../clock";
import { PORTAL_DEMO_LOGIN } from "../config";

export const RECORDED_SELECTORS: { selector: string; kind: "fill" | "select" | "click"; field?: Parameters<typeof bindValue>[1] }[] = [
  { selector: "#vendor_id", kind: "fill", field: "vendor_id" },
  { selector: "#po_number", kind: "fill", field: "po_number" },
  { selector: "#invoice_number", kind: "fill", field: "invoice_number" },
  { selector: "#invoice_date", kind: "fill", field: "invoice_date" },
  { selector: "#cost_center", kind: "select", field: "cost_center" },
  { selector: "#tab_amounts", kind: "click" },
  { selector: "#gross_amount", kind: "fill", field: "gross_amount_usd" },
  { selector: "#tax_rate", kind: "fill", field: "tax_rate" },
  { selector: "#line_items", kind: "fill", field: "line_items_count" },
  { selector: "#tab_payment", kind: "click" },
  { selector: "#payee_iban", kind: "fill", field: "payee_iban" },
];

export async function runBaselineScript(driver: PortalDriver, record: ApprovedRecord, timeoutMs = 2500): Promise<BaselineResult> {
  const t0 = now();
  const steps: BaselineResult["steps"] = [];
  try {
    await driver.goto("invoice-entry.html");
    if ((await driver.currentPage()) === "index.html") {
      for (const [sel, value] of [["#username", PORTAL_DEMO_LOGIN.username], ["#password", PORTAL_DEMO_LOGIN.password]] as const) {
        await driver.fill(sel, value);
        steps.push({ selector: sel, ok: true });
      }
      await driver.click("#btn_logon");
      steps.push({ selector: "#btn_logon", ok: true });
      await driver.waitFor({ kind: "page", page: "po-search.html" }, timeoutMs);
      await driver.goto("invoice-entry.html");
    }
    for (const step of RECORDED_SELECTORS) {
      // A recorded script waits for its selector, then times out.
      const appeared = await driver.waitFor({ kind: "selector", selector: step.selector }, timeoutMs);
      if (!appeared) throw new PortalError(`selector not found: ${step.selector} (waited ${timeoutMs} ms)`, "SELECTOR_NOT_FOUND");
      if (step.kind === "click") await driver.click(step.selector);
      else if (step.kind === "select") await driver.select(step.selector, bindValue(record, step.field!));
      else await driver.fill(step.selector, bindValue(record, step.field!));
      steps.push({ selector: step.selector, ok: true });
    }
    steps.push({ selector: "#btn_post", ok: true });
    return { ok: true, steps, ms: Math.round(now() - t0) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failing = /selector not found: (\S+)/.exec(message)?.[1] ?? "";
    steps.push({ selector: failing, ok: false, error: message });
    return { ok: false, steps, error: message, ms: Math.round(now() - t0) };
  }
}
