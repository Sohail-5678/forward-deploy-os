/**
 * The brittle recorded script from Scenario 3, run for real in headless
 * Chromium: plain CSS ids recorded before the portal's weekend release, no
 * healing. It stops before the submit click, so it never posts anything.
 *
 *   npm run baseline              with the release (chaos on): fails, "selector not found"
 *   npm run baseline -- --clean   on the portal before the release: passes
 */
import { chromium } from "playwright";
import { runBaselineScript } from "../src/engine/browser/baseline";
import { idempotencyKey } from "../src/engine/etl/idempotency";
import { SCENARIOS, ERP_PURCHASE_ORDERS, scenarioConfig } from "../src/engine/data/scenarios";
import type { ApprovedRecord } from "../src/engine/types";
import { createPlaywrightDriver } from "./playwright-driver";
import { startStaticPortal } from "./static-server";

async function main() {
  const clean = process.argv.includes("--clean");
  const portal = await startStaticPortal();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const driver = await createPlaywrightDriver(page, { baseUrl: portal.baseUrl });
    const cfg = scenarioConfig(3);
    await driver.setChaos(clean ? null : cfg.chaos);
    const invoice = SCENARIOS[3].csv[0].records[0];
    const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === invoice.po_number);
    const record: ApprovedRecord = { recordId: "baseline", invoice, idempotencyKey: idempotencyKey(invoice), approval: "auto", costCenter: po?.cost_center ?? "" };
    const result = await runBaselineScript(driver, record, 2500);
    console.log(`Recorded baseline script on the ${clean ? "pre-release" : "released (chaos: " + cfg.chaos.types.join(", ") + ")"} portal`);
    for (const s of result.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.selector}${s.error ? `  ${s.error}` : ""}`);
    console.log(result.ok ? `PASSED in ${result.ms} ms (dry run: stopped before submit)` : `FAILED after ${result.ms} ms: ${result.error}`);
    // Exit 0 either way: failing under chaos is the expected, demonstrated outcome.
  } finally {
    await browser.close();
    await portal.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
