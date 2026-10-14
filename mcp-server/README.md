# ForwardDeploy OS MCP server

A real [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) that exposes the fictional 2009 OmniCorp portal as three guarded tools. An assistant can look things up and submit invoices, but it never types into the portal and can never approve anything: every submission runs through the same engine as the web console.

| Tool | What it does |
|---|---|
| `search_purchase_order` | Looks up a purchase order in the synthetic ERP: vendor, authorized amount, cost center, status. Read-only. |
| `get_invoice_form_schema` | Logs on to the portal in headless Chromium and returns the invoice form as the distilled text map the agent reads, plus the fields a submission needs. Read-only. |
| `submit_invoice` | Validates the record (Zod), heals and checks it (5 invariants), reconciles it against the purchase order and vendor master, applies the policy gate, then posts it through the tool boundary guard. Anything that needs a human is returned as `ESCALATED_NOT_POSTED`. Re-submitting a posted invoice returns `DUPLICATE_PREVENTED`. |

The server starts its own loopback-only static server for the portal (`public/`), so it does not need the Next.js app running. Set `PORTAL_BASE_URL` to drive a running app instead (for example `http://localhost:3000`).

## Requirements

```bash
npm install
npx playwright install chromium
```

## Claude Code

From the repository root:

```bash
claude mcp add forwarddeploy-os -- npx tsx mcp-server/server.ts
```

## Claude Desktop

Add this to `claude_desktop_config.json` (use the absolute path of your checkout):

```json
{
  "mcpServers": {
    "forwarddeploy-os": {
      "command": "npx",
      "args": ["tsx", "mcp-server/server.ts"],
      "cwd": "/absolute/path/to/forward-deploy-os"
    }
  }
}
```

## Try it

- "Look up PO-71301."
- "What fields does the OmniCorp invoice form need?"
- "Submit invoice INV-AG-24101 from V-1042 for PO-71301, $18,450.00, dated 2026-10-14, tax 8.25%, 3 lines, payee GB82 WEST 1234 5698 7654 32." (posts, then a second submit is prevented as a duplicate)
- Change the payee to an account that is not in the vendor master: the server escalates and posts nothing.

## Guarantees and limits

- Values are bound from the validated record by code; the planner only references field names.
- The guard checks every action's target and bound value, and that the payee IBAN belongs to the vendor.
- No tool can approve a policy exception. A person does that in the console, where the decision is recorded in the hash-chained audit log.
- All data is synthetic. The portal ledger lives in the server's browser session and resets when the server restarts.

`npm run test:integration` lists the tools through a real MCP client and submits one valid and one malicious invoice.
