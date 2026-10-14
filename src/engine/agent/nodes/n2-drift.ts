/** Node 2: Schema Drift Detector. Reports field-level drift; failing rows go to the quarantine buffer. */
import type { NodeCtx } from "../runtime";
import type { InputFile } from "../../types";
import { parseCsv, parseJsonTable, type ParsedTable } from "../../etl/csv";
import { detectDrift } from "../../etl/schema-healer";

export function parseInputFile(f: InputFile): ParsedTable {
  return f.kind === "json" ? parseJsonTable(f.text, f.id) : parseCsv(f.text, f.id);
}

export async function node2Drift(ctx: NodeCtx): Promise<string> {
  const { state } = ctx;
  const quarantinedDocs = new Set((state.n1?.docs ?? []).filter((d) => d.quarantined).map((d) => d.id));
  const reports = [];
  let errors = 0;
  let rows = 0;
  for (const f of state.input.files) {
    if (quarantinedDocs.has(f.id)) continue;
    const table = parseInputFile(f);
    const report = detectDrift(table, state.config.contract);
    reports.push(report);
    errors += report.errors.length;
    rows += report.quarantined.length;
    if (report.errors.length) ctx.emit("DRIFT_DETECTED", { fileId: f.id, fileName: f.name, errors: report.errors.slice(0, 80), columns: table.headers });
    if (report.quarantined.length) ctx.emit("ROWS_QUARANTINED", { fileId: f.id, rows: report.quarantined.map((q) => ({ rowIndex: q.rowIndex, sha256: q.sha256, reasons: q.reasons.slice(0, 4) })) });
  }
  state.n2 = { reports };
  return `${reports.length} files checked against ${state.config.contract.version}: ${errors} drift errors, ${rows} rows quarantined`;
}
