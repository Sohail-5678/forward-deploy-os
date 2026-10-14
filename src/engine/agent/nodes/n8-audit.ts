/** Node 8: Audit Commit. Seals the hash-chained audit log and produces the run summary. */
import type { GraphState, RunSummary } from "../../types";
import type { NodeCtx } from "../runtime";
import { verifyAuditChain } from "../audit";
import { parseInputFile } from "./n2-drift";
import { normalizeIban } from "../../iban";

export function computeSummary(state: GraphState): RunSummary {
  const docs = state.n1?.docs ?? [];
  const quarantinedFiles = new Set(docs.filter((d) => d.quarantined && (d.kind === "csv" || d.kind === "json")).map((d) => d.id));
  let csvRows = 0;
  let quarantinedRows = 0;
  for (const f of state.input.files) {
    const rows = parseInputFile(f).rows.length;
    csvRows += rows;
    if (quarantinedFiles.has(f.id)) quarantinedRows += rows;
  }
  for (const f of state.n3?.files ?? []) quarantinedRows += f.quarantined.length;
  const pdfOnly = (state.n4?.reconciliations ?? []).filter((r) => r.source === "pdf").length;
  const quarantinedPdfs = docs.filter((d) => d.kind === "pdf" && d.quarantined).length;
  const postings = state.n7?.postings ?? [];
  const unknown = postings.filter((p) => {
    const v = state.input.vendorMaster.find((m) => m.vendor_id === p.vendor_id);
    return !v || normalizeIban(v.iban) !== normalizeIban(p.iban);
  }).length;
  const heals = (state.n7?.heals ?? []).filter((h) => h.outcome === "healed" || h.outcome === "human-picked").length;
  const nodeMs = state.nodeMs;
  return {
    status: state.status,
    recordsIn: csvRows + pdfOnly + quarantinedPdfs,
    recordsPromoted: state.n3?.records.length ?? 0,
    recordsPosted: postings.length,
    amountPostedCents: postings.reduce((s, p) => s + p.amount_cents, 0),
    duplicatesPrevented: state.n7?.duplicatesPrevented.length ?? 0,
    escalations: (state.n5?.escalations.length ?? 0) + state.decisions.filter((d) => d.escalationId.startsWith("esc_sel_")).length,
    decisions: state.decisions.length,
    quarantinedDocs: docs.filter((d) => d.quarantined).length,
    quarantinedRows,
    selectorsHealed: heals,
    guardBlocks: state.n7?.guardBlocks ?? 0,
    injectionFindings: docs.reduce((s, d) => s + (d.scan?.findings.length ?? 0), 0),
    manualAudit: state.n5?.manualAudit.length ?? 0,
    paymentsToUnknownAccounts: unknown,
    compression: state.n6 && state.n6.distilledTokens ? { raw: state.n6.rawTokens, distilled: state.n6.distilledTokens, ratio: state.n6.ratio } : undefined,
    nodeMs,
    totalEngineMs: Math.round(Object.values(nodeMs).reduce((s, v) => s + (v ?? 0), 0) * 1000) / 1000,
  };
}

export async function node8Audit(ctx: NodeCtx): Promise<string> {
  const { state } = ctx;
  state.status = "COMPLETED";
  const summary = computeSummary(state);
  ctx.audit("RUN_COMPLETED", {
    posted: summary.recordsPosted,
    amountPostedCents: summary.amountPostedCents,
    duplicatesPrevented: summary.duplicatesPrevented,
    escalations: summary.escalations,
    quarantinedDocs: summary.quarantinedDocs,
    paymentsToUnknownAccounts: summary.paymentsToUnknownAccounts,
  });
  const verdict = verifyAuditChain(state.audit);
  const head = state.audit[state.audit.length - 1]?.hash ?? "";
  ctx.emit("AUDIT_COMMITTED", { entries: state.audit.length, head, valid: verdict.valid });
  state.n8 = { summary, auditHead: head, auditValid: verdict.valid };
  return `${state.audit.length} audit entries sealed (chain ${verdict.valid ? "valid" : "BROKEN"}); ${summary.recordsPosted} posted, ${summary.paymentsToUnknownAccounts} payments to unknown accounts`;
}
