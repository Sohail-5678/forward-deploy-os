"use client";
import type { GraphState } from "@/engine/types";
import { toCsv } from "@/engine/etl/csv";
import { renderCanonical } from "@/engine/etl/normalizers";
import { downloadText, spreadsheetSafe } from "./download";

/** The promoted (healed) rows of one input file as canonical CSV. */
export function healedCsv(graph: GraphState, fileId: string): { name: string; csv: string; rows: number } | null {
  const heal = graph.n3?.files.find((f) => f.fileId === fileId);
  const file = graph.input.files.find((f) => f.id === fileId);
  if (!heal || !file) return null;
  const fields = graph.config.contract.fields;
  const keys = fields.map((f) => f.key);
  const rows = heal.promoted.map((p) => Object.fromEntries(fields.map((f) => [f.key, p.values[f.key] === undefined ? "" : spreadsheetSafe(renderCanonical(f.kind, p.values[f.key]))])));
  return { name: file.name.replace(/\.(csv|json)$/i, "") + ".healed.csv", csv: toCsv(keys, rows), rows: rows.length };
}

export function downloadHealed(graph: GraphState, fileId: string) {
  const h = healedCsv(graph, fileId);
  if (h) downloadText(h.name, h.csv, "text/csv");
}

export function downloadSpec(graph: GraphState, fileId: string) {
  const heal = graph.n3?.files.find((f) => f.fileId === fileId);
  if (heal) downloadText(`transform-spec-${heal.spec.id.slice(0, 10)}.json`, JSON.stringify(heal.spec, null, 2), "application/json");
}

/** The hash-chained audit log as JSON Lines (one entry per line). */
export function downloadAudit(graph: GraphState) {
  downloadText(`${graph.runId}.audit.jsonl`, graph.audit.map((e) => JSON.stringify(e)).join("\n") + "\n", "application/x-ndjson");
}
