/**
 * Node 3: Heal & Invariant Gate. Synthesizes a declarative TransformSpec per
 * file (optionally with LLM proposals for still-unmapped required fields),
 * applies it to the whole batch and promotes only rows that pass all 5
 * invariant checks. Ambiguous dates are never guessed.
 */
import type { NodeCtx } from "../runtime";
import type { FileHealResult, HealedRecord } from "../../types";
import { healFile, synthesizeSpec } from "../../etl/schema-healer";
import { parseInputFile } from "./n2-drift";
import { llmMappingProposalSchema } from "../../schemas";
import { profileColumn } from "../../etl/value-profile";

export async function node3Heal(ctx: NodeCtx): Promise<string> {
  const { state, deps } = ctx;
  const quarantinedDocs = new Set((state.n1?.docs ?? []).filter((d) => d.quarantined).map((d) => d.id));
  const files: FileHealResult[] = [];
  const records: HealedRecord[] = [];
  for (const f of state.input.files) {
    if (quarantinedDocs.has(f.id)) continue;
    const table = parseInputFile(f);
    if (table.headers.length === 0) continue;
    const contract = state.config.contract;

    // Optional LLM assist: only for required targets the deterministic matcher left open.
    let proposals: { source: string; target: string; proposedBy: "llm" }[] = [];
    if (state.config.mode === "llm" && deps.llm) {
      const pre = synthesizeSpec(table, contract);
      const openTargets = contract.fields.filter((t) => t.required && pre.spec.unmappedTarget.includes(t.key));
      if (openTargets.length && pre.spec.unmappedSource.length) {
        const r = await deps.llm.mapSchema({
          columns: pre.spec.unmappedSource.map((c) => ({ name: c, samples: profileColumn(c, table.rows.slice(0, 5).map((r) => r[c] ?? "")).samples.slice(0, 5) })),
          targets: openTargets.map((t) => ({ key: t.key, kind: t.kind, description: t.description })),
        });
        if (r.ok) {
          const parsed = llmMappingProposalSchema.safeParse({ mappings: r.data });
          if (parsed.success) {
            proposals = parsed.data.mappings.map((m) => ({ source: m.source, target: m.target, proposedBy: "llm" as const }));
            ctx.emit("LLM_CALLED", { task: "map-schema", model: r.model, ok: true, fallback: false, ms: r.ms }, r.ms);
          } else ctx.emit("LLM_CALLED", { task: "map-schema", model: r.model, ok: false, fallback: true, reason: "response failed schema validation", ms: r.ms }, r.ms);
        } else ctx.emit("LLM_CALLED", { task: "map-schema", model: "none", ok: false, fallback: true, reason: r.reason, ms: r.ms }, r.ms);
      }
    }

    const healed = healFile(table, contract, {
      ledger: state.input.ledger,
      fiscalWindow: state.config.fiscalWindow,
      dateOverride: state.config.dateOverrides[f.id],
      proposals,
      fileName: f.name,
    });
    ctx.emit("MAPPING_SYNTHESIZED", {
      fileId: f.id,
      specId: healed.spec.id,
      mappings: healed.spec.mappings,
      unmappedSource: healed.spec.unmappedSource,
      unmappedTarget: healed.spec.unmappedTarget,
      dateDecision: healed.spec.dateDecision,
    });
    for (const inv of healed.invariants) ctx.emit("INVARIANT_RESULT", { fileId: f.id, result: inv }, inv.ms);
    if (healed.promoted.length) ctx.emit("ROWS_PROMOTED", { fileId: f.id, count: healed.promoted.length, recordIds: healed.promoted.map((p) => p.recordId) });
    if (healed.quarantined.length) ctx.emit("ROWS_QUARANTINED", { fileId: f.id, rows: healed.quarantined.map((q) => ({ rowIndex: q.rowIndex, sha256: q.sha256, reasons: q.reasons.slice(0, 4) })) });
    ctx.audit("SPEC_SYNTHESIZED", {
      file: f.name,
      specId: healed.spec.id,
      invariantsPassed: healed.invariants.filter((i) => i.passed).length,
      promoted: healed.promoted.length,
      quarantined: healed.quarantined.length,
      dateDecision: healed.spec.dateDecision?.status,
    });
    const { matrix: _m, rejectedProposals: _r, ...rest } = healed;
    files.push({ ...rest, rowErrors: rest.rowErrors.slice(0, 200) });
    records.push(...healed.promoted);
  }
  state.n3 = { files, records };
  const passed = files.reduce((s, f) => s + f.invariants.filter((i) => i.passed).length, 0);
  const total = files.reduce((s, f) => s + f.invariants.length, 0);
  const waiting = files.filter((f) => f.awaitingDecision).length;
  return `${records.length} rows promoted from ${files.length} files; ${passed}/${total} invariants passed${waiting ? `; ${waiting} file waiting on a date decision` : ""}`;
}
