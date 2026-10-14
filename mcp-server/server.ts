/**
 * ForwardDeploy OS MCP server (stdio). It exposes the 2009 OmniCorp portal as
 * three guarded tools for an AI assistant:
 *
 *   search_purchase_order   look up a purchase order in the (synthetic) ERP
 *   get_invoice_form_schema distill the invoice entry form the agent fills
 *   submit_invoice          validate, reconcile, apply policy, then post through
 *                           the tool boundary guard with headless Chromium
 *
 * A model calling these tools never supplies keystrokes or approvals: the
 * record goes through the same engine as the console (Zod validation, policy
 * gate, value binding, guard). Anything that needs a human is escalated and
 * NOT posted; this server has no way to approve on a person's behalf.
 *
 * Logs go to stderr; stdout carries only the protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { createRun, runToPause } from "../src/engine/agent/graph";
import type { EngineDeps } from "../src/engine/agent/runtime";
import { systemClock } from "../src/engine/clock";
import { baseConfig, PORTAL_DEMO_LOGIN } from "../src/engine/config";
import { ERP_PURCHASE_ORDERS, VENDOR_MASTER, vendorName } from "../src/engine/data/scenarios";
import { SelectorCache } from "../src/engine/browser/selector-healer";
import { secureNonce } from "../src/engine/security/spotlighting";
import { sha256Hex } from "../src/engine/hash";
import { describeHit } from "../src/engine/agent/policy";
import { CONTRACT_V1 } from "../src/engine/etl/contract";
import type { BatchInput } from "../src/engine/types";
import type { PortalDriver as Driver } from "../src/engine/browser/driver";
import { createPlaywrightDriver } from "../runner/playwright-driver";
import { startStaticPortal, type StaticPortal } from "../runner/static-server";

const log = (...a: unknown[]) => console.error("[forwarddeploy-mcp]", ...a);

// ------------------------------------------------------------------ portal session
let portal: StaticPortal | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;

/** One browser context for the server's lifetime, so the portal ledger persists and duplicates are prevented. */
async function session(): Promise<{ driver: Driver; baseUrl: string }> {
  const baseUrl = process.env.PORTAL_BASE_URL?.replace(/\/$/, "") || (portal ??= await startStaticPortal()).baseUrl;
  browser ??= await chromium.launch();
  context ??= await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = context.pages()[0] ?? (await context.newPage());
  const driver = await createPlaywrightDriver(page, { baseUrl });
  return { driver, baseUrl };
}

async function logOn(driver: Driver) {
  await driver.goto("invoice-entry.html");
  if ((await driver.currentPage()) === "index.html") {
    await driver.fill("#username", PORTAL_DEMO_LOGIN.username);
    await driver.fill("#password", PORTAL_DEMO_LOGIN.password);
    await driver.click("#btn_logon");
    await driver.waitFor({ kind: "page", page: "po-search.html" }, 8000);
    await driver.goto("invoice-entry.html");
  }
}

// ------------------------------------------------------------------ schemas
const poNumber = z.string().regex(/^PO-\d{5}$/, "PO numbers look like PO-88412");

export const invoiceInput = z.strictObject({
  vendor_id: z.string().regex(/^V-\d{4}$/, "vendor ids look like V-1042"),
  customer_id: z.string().regex(/^C-\d{4}$/, "customer ids look like C-7781"),
  po_number: poNumber,
  invoice_number: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,30}$/, "letters, digits and dashes"),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date, YYYY-MM-DD"),
  gross_amount_usd: z.number().positive().max(10_000_000),
  tax_rate: z.number().min(0).max(1),
  line_items_count: z.number().int().min(1).max(999),
  payee_iban: z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,40}$/, "an IBAN such as DE89 3704 0044 0532 0130 00"),
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

// ------------------------------------------------------------------ tool logic (exported for tests)
export function searchPurchaseOrder(po: string) {
  const found = ERP_PURCHASE_ORDERS.find((p) => p.po_number === po);
  if (!found) return { found: false, po_number: po, note: "No purchase order with that number in the OmniCorp ERP (synthetic data)." };
  return { found: true, ...found, vendor_name: vendorName(found.vendor_id), authorized_usd: found.authorized_cents / 100 };
}

export async function getInvoiceFormSchema() {
  const { driver } = await session();
  await logOn(driver);
  const d = await driver.distill();
  return {
    page: d.page,
    distilled: d.lines,
    fields: CONTRACT_V1.fields.map((f) => ({ key: f.key, kind: f.kind, required: f.required, description: f.description })),
    note: "Values are bound from the submitted record by code; a caller can reference fields but never type into the portal directly.",
  };
}

export async function submitInvoice(rec: InvoiceInput) {
  const { driver } = await session();
  // One canonical JSON row runs through the full pipeline: firewall, drift, heal + invariants,
  // reconciliation, policy gate, distillation, guarded execution, audit.
  const row = { ...rec, gross_amount_usd: rec.gross_amount_usd.toFixed(2), tax_rate: String(rec.tax_rate), line_items_count: String(rec.line_items_count) };
  const json = JSON.stringify([row]);
  const input: BatchInput = {
    files: [{ id: "mcp-1", name: "mcp_submission.json", kind: "json", text: json, sha256: sha256Hex(json) }],
    pdfs: [],
    notes: [],
    erp: ERP_PURCHASE_ORDERS,
    vendorMaster: VENDOR_MASTER,
    ledger: await driver.readLedger(),
  };
  const config = baseConfig("sandbox");
  const deps: EngineDeps = { clock: systemClock, driver, selectorCache: new SelectorCache(), countTokens: (t) => countTokens(t), nonce: secureNonce };
  const r = await runToPause(createRun(input, config, { clock: systemClock }), deps);
  const s = r.state;
  if (s.status === "SUSPENDED_HITL") {
    return {
      outcome: "ESCALATED_NOT_POSTED",
      reason: "A human must decide. This server cannot approve on a person's behalf.",
      escalations: s.pending.map((p) => (p.kind === "POLICY" ? { invoice: p.invoice_number, rules: p.hits.map((h) => ({ rule: h.rule, detail: describeHit(h) })) } : { kind: p.kind })),
    };
  }
  if (s.status !== "COMPLETED") return { outcome: "FAILED", error: s.error?.message ?? "the run did not complete" };
  return {
    outcome: s.n7?.postings.length ? "POSTED" : s.n7?.duplicatesPrevented.length ? "DUPLICATE_PREVENTED" : "NOT_POSTED",
    postings: s.n7?.postings.map((p) => ({ invoice_number: p.invoice_number, posting_number: p.postingNumber, amount_usd: p.amount_cents / 100 })) ?? [],
    duplicates_prevented: s.n7?.duplicatesPrevented ?? [],
    guard_blocks: s.n7?.guardBlocks ?? 0,
    quarantined_rows: s.n2?.reports.reduce((n, rep) => n + rep.quarantined.length, 0) ?? 0,
    failures: s.n7?.failures ?? [],
    audit_entries: s.audit.length,
  };
}

export async function shutdown() {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await portal?.close().catch(() => undefined);
  context = null;
  browser = null;
  portal = null;
}

// ------------------------------------------------------------------ server
export function createServer() {
  const server = new McpServer({ name: "forwarddeploy-os", version: "2.0.0" });

  server.registerTool(
    "search_purchase_order",
    {
      title: "Search purchase order",
      description: "Look up a purchase order in the OmniCorp ERP (synthetic demo data): vendor, customer, authorized amount, cost center and status.",
      inputSchema: { po_number: poNumber },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ po_number }) => text(searchPurchaseOrder(po_number)),
  );

  server.registerTool(
    "get_invoice_form_schema",
    {
      title: "Get invoice form schema",
      description: "Log on to the OmniCorp portal in headless Chromium and return the invoice entry form as a distilled text map, plus the fields a submission must provide.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(await getInvoiceFormSchema()),
  );

  server.registerTool(
    "submit_invoice",
    {
      title: "Submit invoice",
      description:
        "Submit one invoice. It is validated, reconciled against the purchase order and vendor master, and checked by policy. Clean invoices are posted to the portal through the tool boundary guard; anything that needs a human (amount over tolerance, unknown payee or vendor, a security finding) is escalated and NOT posted. Re-submitting a posted invoice is prevented as a duplicate.",
      inputSchema: invoiceInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const parsed = invoiceInput.safeParse(args);
      if (!parsed.success) return { ...text({ outcome: "REJECTED", errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }), isError: true };
      try {
        return text(await submitInvoice(parsed.data));
      } catch (e) {
        log("submit_invoice failed", e);
        return { ...text({ outcome: "FAILED", error: e instanceof Error ? e.message : String(e) }), isError: true };
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  log("ready on stdio");
  const stop = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdin.on("close", stop);
}

if (process.argv[1] && /mcp-server[\\/]server\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    log(e);
    process.exit(1);
  });
}
