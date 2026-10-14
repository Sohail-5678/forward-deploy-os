import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import recorded from "@/engine/data/selector-cache.v42.json";
import { compilePython, compileTypeScript } from "@/engine/browser/playwright-compiler";
import { ERP_PURCHASE_ORDERS, SCENARIOS } from "@/engine/data/scenarios";
import { idempotencyKey } from "@/engine/etl/idempotency";
import type { ApprovedRecord, SelectorCacheEntry } from "@/engine/types";
import { startStaticPortal, type StaticPortal } from "../../runner/static-server";

const run = promisify(execFile);
const OUT = join(process.cwd(), "tests", "integration", ".out");

function approved(i: number): ApprovedRecord {
  const invoice = SCENARIOS[1].csv[0].records[i];
  const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === invoice.po_number)!;
  return { recordId: `export-${i}`, invoice, idempotencyKey: idempotencyKey(invoice), approval: "auto", costCenter: po.cost_center };
}

const input = {
  // The repeated first record proves the exported read-before-write check.
  records: [approved(0), approved(1), approved(0)],
  cache: (recorded as { entries: SelectorCacheEntry[] }).entries,
  runId: "run_export_test",
  generatedAt: "2026-10-14T12:00:00.000Z",
};

const hasPythonPlaywright = (() => {
  try {
    execFileSync("python3", ["-c", "import playwright"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("exported Playwright scripts run against the portal", () => {
  let portal: StaticPortal;
  beforeAll(async () => {
    portal = await startStaticPortal();
    await mkdir(OUT, { recursive: true });
  });
  afterAll(async () => {
    await portal?.close();
  });

  it("TypeScript export posts, heals under chaos, and prevents duplicates", async () => {
    const file = join(OUT, "forwarddeploy-run.ts");
    await writeFile(file, compileTypeScript(input));
    const clean = await run("npx", ["tsx", file], { env: { ...process.env, BASE_URL: portal.baseUrl }, timeout: 150_000 });
    expect(clean.stdout).toMatch(/POSTED INV-AG-24101 as GL-\d{4}-\d{6}/);
    expect(clean.stdout).toMatch(/POSTED INV-AG-24102/);
    expect(clean.stdout).toMatch(/DUPLICATE_PREVENTED INV-AG-24101/);
    const chaos = await run("npx", ["tsx", file], { env: { ...process.env, BASE_URL: portal.baseUrl, CHAOS_SEED: "20261014", CHAOS_TYPES: "ids,labels,nesting,interstitial" }, timeout: 150_000 });
    expect(chaos.stdout).toMatch(/POSTED INV-AG-24101/);
    expect(chaos.stdout).toMatch(/session dialog dismissed/);
    // With <label for> links stripped, label locators fail and the in-page fingerprint fallback heals.
    const stripped = await run("npx", ["tsx", file], { env: { ...process.env, BASE_URL: portal.baseUrl, CHAOS_SEED: "20261014", CHAOS_TYPES: "ids,strip-labels" }, timeout: 150_000 });
    expect(stripped.stdout).toMatch(/healed invoice-entry\.html:/);
    expect(stripped.stdout).toMatch(/POSTED INV-AG-24101/);
  });

  it.skipIf(!hasPythonPlaywright)("Python export posts and prevents duplicates", async () => {
    const file = join(OUT, "forwarddeploy_run.py");
    await writeFile(file, compilePython(input));
    const res = await run("python3", [file], { env: { ...process.env, BASE_URL: portal.baseUrl }, timeout: 150_000 });
    expect(res.stdout).toMatch(/POSTED INV-AG-24101/);
    expect(res.stdout).toMatch(/DUPLICATE_PREVENTED INV-AG-24101/);
  });
});
