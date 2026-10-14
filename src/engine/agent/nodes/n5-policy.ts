/**
 * Node 5: Policy & HITL Gate. Hard policy rules first (rule S3), calibrated
 * confidence second. Any escalation without a human decision suspends the run
 * at a checkpoint that the server signs; decisions recorded on resume are
 * applied here (enforce PO, approve override, manual audit, ...).
 */
import type { ApprovedRecord, AuditEntry, DateEscalation, Escalation, HumanDecision, PolicyEscalation, Reconciliation } from "../../types";
import type { NodeCtx } from "../runtime";
import { policyOptions, describeHit } from "../policy";
import { readDateHuman } from "../../etl/date-format";
import { idempotencyKey } from "../../etl/idempotency";
import { overrideCodeFromAudit } from "../audit";
import { formatUsd } from "../../format";

function decisionAudit(audit: AuditEntry[], escalationId: string): AuditEntry | undefined {
  for (let i = audit.length - 1; i >= 0; i--) {
    const e = audit[i];
    if (e.kind === "HUMAN_DECISION" && (e.data as { escalationId?: string }).escalationId === escalationId) return e;
  }
  return undefined;
}

export function latestDecision(decisions: HumanDecision[], escalationId: string): HumanDecision | undefined {
  for (let i = decisions.length - 1; i >= 0; i--) if (decisions[i].escalationId === escalationId) return decisions[i];
  return undefined;
}

function autoApproved(r: Reconciliation): ApprovedRecord {
  return { recordId: r.recordId, invoice: r.invoice, idempotencyKey: r.idempotencyKey, approval: "auto", costCenter: r.erp?.cost_center ?? "" };
}

export function buildEscalations(ctx: NodeCtx): Escalation[] {
  const { state } = ctx;
  const out: Escalation[] = [];
  for (const r of state.n4?.reconciliations ?? []) {
    if (r.policyHits.length === 0) continue;
    const esc: PolicyEscalation = {
      id: `esc_${r.recordId}`,
      kind: "POLICY",
      recordId: r.recordId,
      invoice_number: r.invoice_number,
      vendor_id: r.vendor_id,
      hits: r.policyHits,
      confidence: r.confidence,
      options: policyOptions(r.policyHits, r),
    };
    out.push(esc);
  }
  for (const f of state.n3?.files ?? []) {
    if (!f.awaitingDecision || !f.spec.dateDecision) continue;
    const dd = f.spec.dateDecision;
    const sample = dd.samples[0] ?? "";
    const esc: DateEscalation = {
      id: `esc_date_${f.fileId}`,
      kind: "AMBIGUOUS_DATE",
      fileId: f.fileId,
      fileName: f.fileName,
      column: dd.source,
      samples: dd.samples,
      interpretations: (["DD/MM/YYYY", "MM/DD/YYYY"] as const).map((format) => ({ format, example: sample, reading: readDateHuman(sample, format) })),
      affectedRows: f.quarantined.map((q) => q.rowIndex),
      options: [
        { choice: "READ_DMY", label: `Read as DD/MM → ${readDateHuman(sample, "DD/MM/YYYY")}`, description: "Day first, as most of the world writes dates.", shortcut: "1" },
        { choice: "READ_MDY", label: `Read as MM/DD → ${readDateHuman(sample, "MM/DD/YYYY")}`, description: "Month first, the US convention.", shortcut: "2" },
        { choice: "ASK_CUSTOMER", label: "Ask the customer", description: "Keep these rows quarantined until the vendor confirms the format.", recommended: true, shortcut: "3" },
      ],
    };
    out.push(esc);
  }
  return out;
}

export async function node5Policy(ctx: NodeCtx): Promise<string> {
  const { state } = ctx;
  const recs = state.n4?.reconciliations ?? [];
  const approved: ApprovedRecord[] = recs.filter((r) => r.policyHits.length === 0).map(autoApproved);
  const manualAudit: { recordId: string; invoice_number: string; reason: string }[] = [];
  const rejected: { recordId: string; invoice_number: string; reason: string }[] = [];
  const escalations = buildEscalations(ctx);
  const pending: Escalation[] = [];

  for (const esc of escalations) {
    const d = latestDecision(state.decisions, esc.id);
    if (!d) {
      pending.push(esc);
      continue;
    }
    if (esc.kind === "AMBIGUOUS_DATE") {
      if (d.choice === "ASK_CUSTOMER") manualAudit.push({ recordId: esc.fileId, invoice_number: `${esc.fileName} (${esc.affectedRows.length} rows)`, reason: "date format confirmation requested from the customer" });
      continue;
    }
    if (esc.kind !== "POLICY") continue;
    const r = recs.find((x) => x.recordId === esc.recordId)!;
    const reason = esc.hits.map(describeHit).join("; ");
    switch (d.choice) {
      case "ENFORCE_PO": {
        if (!r.erp) {
          manualAudit.push({ recordId: r.recordId, invoice_number: r.invoice_number, reason: "no purchase order to enforce" });
          break;
        }
        const invoice = { ...r.invoice, gross_amount_cents: r.erp.authorized_cents };
        const delta = r.invoice.gross_amount_cents - r.erp.authorized_cents;
        const surcharge = r.surcharges[0]?.label;
        approved.push({
          recordId: r.recordId,
          invoice,
          idempotencyKey: idempotencyKey(invoice),
          approval: "human",
          decisionId: d.escalationId,
          costCenter: r.erp.cost_center,
          shortPayNote: `Short-paid ${formatUsd(delta)} against ${r.erp.po_number}${surcharge ? ` (${surcharge})` : ""}; approved by ${d.operator}.`,
        });
        break;
      }
      case "APPROVE_OVERRIDE": {
        const entry = decisionAudit(state.audit, esc.id);
        approved.push({
          recordId: r.recordId,
          invoice: r.invoice,
          idempotencyKey: r.idempotencyKey,
          approval: "human",
          decisionId: d.escalationId,
          costCenter: r.erp?.cost_center ?? "",
          overrideCode: entry ? overrideCodeFromAudit(entry) : undefined,
        });
        break;
      }
      case "APPROVE_AS_IS":
        approved.push({ ...autoApproved(r), approval: "human", decisionId: d.escalationId });
        break;
      case "REJECT":
        rejected.push({ recordId: r.recordId, invoice_number: r.invoice_number, reason });
        break;
      default:
        manualAudit.push({ recordId: r.recordId, invoice_number: r.invoice_number, reason });
    }
  }

  state.n5 = { approved, escalations, manualAudit, rejected };
  if (pending.length) {
    state.pending = pending;
    state.status = "SUSPENDED_HITL";
    for (const esc of pending) {
      ctx.emit("POLICY_HIT", { escalationId: esc.id, kind: esc.kind, recordId: esc.kind === "POLICY" ? esc.recordId : undefined, hits: esc.kind === "POLICY" ? esc.hits : [] });
      ctx.audit("ESCALATED", { escalationId: esc.id, kind: esc.kind, rules: esc.kind === "POLICY" ? esc.hits.map((h) => h.rule) : [esc.kind] });
    }
    ctx.emit("RUN_SUSPENDED", { atNode: 5, escalations: pending.length });
    return `${approved.length} auto-approved; ${pending.length} waiting for a human decision`;
  }
  return `${approved.length} approved, ${manualAudit.length} to manual audit, ${rejected.length} rejected`;
}
