import { apiRoute, ApiError, json } from "@/lib/server/http";
import { checkpointSecret } from "@/lib/server/env";
import { signCheckpoint } from "@/lib/server/checkpoint";
import { pipelineRequestSchema } from "@/engine/schemas";
import { baseConfig } from "@/engine/config";
import { validateContract } from "@/engine/etl/contract";
import { createRun, runToPause } from "@/engine/agent/graph";
import { systemClock } from "@/engine/clock";
import { sha256Hex, base64ToBytes } from "@/engine/hash";
import { ERP_PURCHASE_ORDERS, VENDOR_MASTER } from "@/engine/data/scenarios";
import { describeRecipe } from "@/engine/etl/schema-healer";
import { toCsv } from "@/engine/etl/csv";
import { renderCanonical } from "@/engine/etl/normalizers";
import type { BatchInput, InputFile, InputNote, InputPdf } from "@/engine/types";

export const maxDuration = 30;

function looksLikeText(s: string): boolean {
  return !s.includes("\u0000");
}

/**
 * POST /api/pipeline: runs nodes 1-5 of the same engine server-side on posted
 * files. Portal posting (nodes 6-8) needs a browser: the console, the
 * Playwright runner or the MCP server. Stops at HITL with a signed checkpoint.
 */
export const POST = apiRoute({ name: "pipeline", schema: pipelineRequestSchema, limit: { max: 15 } }, async (body) => {
  const files: InputFile[] = [];
  const pdfs: InputPdf[] = [];
  const notes: InputNote[] = [];
  body.files.forEach((f, i) => {
    const id = `upload-${i + 1}`;
    if (f.kind === "pdf") {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(f.content);
      } catch {
        throw new ApiError(400, "INVALID_FILE", `${f.name}: PDF content must be base64.`);
      }
      // Sniff by content, not extension.
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new ApiError(415, "NOT_A_PDF", `${f.name} is not a PDF (missing %PDF header).`);
      pdfs.push({ id, name: f.name, sha256: sha256Hex(bytes), bytesB64: f.content });
      return;
    }
    if (!looksLikeText(f.content)) throw new ApiError(415, "NOT_TEXT", `${f.name} is not a text file.`);
    if (f.kind === "json") {
      try {
        JSON.parse(f.content);
      } catch {
        throw new ApiError(415, "INVALID_JSON_FILE", `${f.name} is not valid JSON.`);
      }
    }
    if (f.kind === "txt") notes.push({ id, name: f.name, text: f.content, sha256: sha256Hex(f.content) });
    else files.push({ id, name: f.name, kind: f.kind, text: f.content, sha256: sha256Hex(f.content) });
  });

  const config = baseConfig("sandbox", body.config?.seed);
  if (body.config?.policy) config.policy = body.config.policy;
  if (body.config?.contract) {
    const v = validateContract(body.config.contract);
    if (!v.ok) throw new ApiError(400, "INVALID_CONTRACT", v.errors.join(" "));
    config.contract = body.config.contract;
  }
  const input: BatchInput = { files, pdfs, notes, erp: ERP_PURCHASE_ORDERS, vendorMaster: VENDOR_MASTER, ledger: [] };
  const run = await runToPause(createRun(input, config, { clock: systemClock }), { clock: systemClock }, { stopBefore: 6 });
  const s = run.state;

  let checkpoint = undefined;
  if (s.status === "SUSPENDED_HITL") {
    const secret = checkpointSecret();
    if (secret) checkpoint = { runId: s.runId, atNode: 5, state: s, ...signCheckpoint(secret.secret, s.runId, 5, s) };
  }

  const healedCsv: Record<string, string> = {};
  for (const f of s.n3?.files ?? []) {
    const keys = config.contract.fields.map((x) => x.key);
    const rows = f.promoted.map((p) => {
      const row: Record<string, string> = {};
      for (const k of keys) {
        const field = config.contract.fields.find((x) => x.key === k)!;
        const v = p.values[k];
        row[k] = v === undefined ? "" : renderCanonical(field.kind, v);
      }
      return row;
    });
    healedCsv[f.fileName.replace(/\.(csv|json)$/i, "") + ".healed.csv"] = toCsv(keys, rows);
  }

  return json({
    runId: s.runId,
    status: s.status === "SUSPENDED_HITL" ? "SUSPENDED_HITL" : s.status === "FAILED" ? "FAILED" : "READY_TO_POST",
    note: "Nodes 1-5 ran server-side. Posting into the portal (nodes 6-8) runs in the browser console, the Playwright runner or the MCP server.",
    error: s.error ?? null,
    report: {
      documents: (s.n1?.docs ?? []).map((d) => ({ name: d.name, kind: d.kind, quarantined: d.quarantined, reason: d.quarantineReason ?? null, findings: (d.scan?.findings ?? []).map((f) => ({ ruleId: f.ruleId, severity: f.severity, channel: f.channel, excerpt: f.excerpt })) })),
      files: (s.n3?.files ?? []).map((f) => ({
        file: f.fileName,
        specId: f.spec.id,
        recipe: f.spec.mappings.map(describeRecipe),
        unmappedSource: f.spec.unmappedSource,
        unmappedTarget: f.spec.unmappedTarget,
        dateDecision: f.spec.dateDecision ?? null,
        invariants: f.invariants.map((i) => ({ name: i.name, passed: i.passed, detail: i.detail })),
        promoted: f.promoted.length,
        quarantined: f.quarantined.map((q) => ({ row: q.rowIndex + 1, reasons: q.reasons })),
      })),
      reconciliations: (s.n4?.reconciliations ?? []).map((r) => ({ invoice: r.invoice_number, vendor: r.vendor_id, confidence: r.confidence, policyHits: r.policyHits })),
      approved: (s.n5?.approved ?? []).map((a) => ({ invoice: a.invoice.invoice_number, amountCents: a.invoice.gross_amount_cents, approval: a.approval })),
      escalations: s.pending,
      healedCsv,
    },
    nodeMs: s.nodeMs,
    events: run.events.length,
    checkpoint,
  });
});
