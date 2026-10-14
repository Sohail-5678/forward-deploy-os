import "server-only";
import { formatUsd } from "@/engine/format";

/** Slack Block Kit for a HITL escalation. Built server-side from validated fields only. */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface EscalationNotice {
  runId: string;
  scenarioId: number | "sandbox";
  invoiceNumber: string;
  vendorName: string;
  amountCents: number;
  poAmountCents?: number;
  rules: string[];
  confidence: number;
}

export function buildEscalationBlocks(n: EscalationNotice, siteUrl: string) {
  const link = `${siteUrl}/console?scenario=${encodeURIComponent(String(n.scenarioId))}&step=5`;
  const delta = n.poAmountCents !== undefined ? n.amountCents - n.poAmountCents : undefined;
  return {
    text: `Human decision needed: ${n.invoiceNumber} (${n.vendorName})`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Run paused: human decision needed", emoji: false } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${esc(n.invoiceNumber)}* from *${esc(n.vendorName)}*\nInvoice ${formatUsd(n.amountCents)}${n.poAmountCents !== undefined ? ` vs PO ${formatUsd(n.poAmountCents)}` : ""}${delta !== undefined ? ` (${delta >= 0 ? "+" : ""}${formatUsd(delta)})` : ""}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Policy rules hit*\n${n.rules.map((r) => `\`${esc(r)}\``).join(" ") || "none"}` },
          { type: "mrkdwn", text: `*Calibrated confidence*\n${n.confidence.toFixed(2)}` },
        ],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: `Run \`${esc(n.runId)}\` · ForwardDeploy OS · all data synthetic` }] },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in console" }, url: link, style: "primary" }] },
    ],
  };
}
