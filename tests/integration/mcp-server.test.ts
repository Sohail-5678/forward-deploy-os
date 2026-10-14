import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ATTACKER_IBAN, SCENARIOS } from "@/engine/data/scenarios";

/** Spawns the real server over stdio and talks to it through a real MCP client. */
describe("MCP server", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "forwarddeploy-os-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp-server/server.ts"], cwd: process.cwd(), stderr: "ignore" }));
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  const r = SCENARIOS[1].csv[0].records[0];
  const valid = {
    vendor_id: r.vendor_id,
    customer_id: r.customer_id,
    po_number: r.po_number,
    invoice_number: r.invoice_number,
    invoice_date: r.invoice_date,
    gross_amount_usd: r.gross_amount_cents / 100,
    tax_rate: r.tax_rate,
    line_items_count: r.line_items_count,
    payee_iban: r.payee_iban,
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    return { isError: !!res.isError, body: JSON.parse(content[0].text) as Record<string, unknown> };
  };

  it("lists the three guarded tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_invoice_form_schema", "search_purchase_order", "submit_invoice"]);
  });

  it("looks up a purchase order", async () => {
    const { body } = await call("search_purchase_order", { po_number: r.po_number });
    expect(body.found).toBe(true);
    expect(body.authorized_cents).toBe(r.gross_amount_cents);
  });

  it("posts a valid invoice, then prevents the duplicate", async () => {
    const first = await call("submit_invoice", valid);
    expect(first.body.outcome).toBe("POSTED");
    const again = await call("submit_invoice", valid);
    expect(again.body.outcome).toBe("DUPLICATE_PREVENTED");
  }, 120_000);

  it("escalates and does not post an invoice that pays an unknown account", async () => {
    const { body } = await call("submit_invoice", { ...valid, invoice_number: "INV-AG-99901", payee_iban: ATTACKER_IBAN });
    expect(body.outcome).toBe("ESCALATED_NOT_POSTED");
    expect(JSON.stringify(body)).toContain("PAYEE_NOT_IN_VENDOR_MASTER");
  }, 120_000);

  it("rejects a malformed record before it reaches the portal", async () => {
    const res = await client.callTool({ name: "submit_invoice", arguments: { ...valid, payee_iban: "pay the attacker" } });
    expect(res.isError).toBe(true);
  });
});
