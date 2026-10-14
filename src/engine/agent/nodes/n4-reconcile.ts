/** Node 4: Cross-Doc Reconciler. Three-way PDF / CSV / ERP comparison and calibrated confidence per invoice. */
import type { NodeCtx } from "../runtime";
import type { IngestedDoc, Reconciliation } from "../../types";
import { reconcile } from "../reconciler";

export async function node4Reconcile(ctx: NodeCtx): Promise<string> {
  const { state } = ctx;
  const docs = state.n1?.docs ?? [];
  const pdfs = docs.filter((d): d is IngestedDoc & { invoice: NonNullable<IngestedDoc["invoice"]> } => d.kind === "pdf" && !d.quarantined && !!d.invoice);
  const fileDocs = new Map(docs.map((d) => [d.id, d]));
  const usedPdfs = new Set<string>();
  const out: Reconciliation[] = [];

  const securityIds = (d: IngestedDoc | undefined) => (d?.scan?.findings ?? []).map((f) => `${f.ruleId}@${d!.name}`);

  for (const rec of state.n3?.records ?? []) {
    const inv = rec.invoice;
    const pdf = pdfs.find((p) => p.invoice.fields.invoice_number === inv.invoice_number && (!p.invoice.fields.vendor_id || p.invoice.fields.vendor_id === inv.vendor_id));
    if (pdf) usedPdfs.add(pdf.id);
    const erp = state.input.erp.find((p) => p.po_number === inv.po_number);
    const sec = [...securityIds(fileDocs.get(rec.fileId)), ...securityIds(pdf)];
    const r = reconcile(
      {
        recordId: rec.recordId,
        csv: inv,
        pdf: pdf ? { docId: pdf.id, invoice: pdf.invoice } : undefined,
        erp,
        vendorMaster: state.input.vendorMaster,
        mappingScoreMean: rec.mappingScoreMean,
        normalizerCount: rec.normalizerCount,
        securitySignal: sec.length ? 1 : 0,
        securityFindingIds: [...new Set(sec)],
      },
      state.config.policy,
    );
    out.push(r);
  }

  // PDFs with no CSV row (for example an invoice that arrived by e-mail) become their own records.
  for (const pdf of pdfs) {
    if (usedPdfs.has(pdf.id)) continue;
    const f = pdf.invoice.fields;
    if (!f.invoice_number || !f.vendor_id || f.gross_amount_cents === undefined) continue;
    const erp = state.input.erp.find((p) => p.po_number === f.po_number);
    const sec = securityIds(pdf);
    out.push(
      reconcile(
        {
          recordId: `pdf:${pdf.id}`,
          pdf: { docId: pdf.id, invoice: pdf.invoice },
          erp,
          vendorMaster: state.input.vendorMaster,
          mappingScoreMean: 0.75,
          normalizerCount: 0,
          securitySignal: sec.length ? 1 : 0,
          securityFindingIds: [...new Set(sec)],
        },
        state.config.policy,
      ),
    );
  }

  for (const r of out) {
    const comparable = r.fields.filter((f) => [f.pdf, f.csv, f.erp].filter((v) => v !== undefined).length >= 2);
    ctx.emit("RECONCILED", { recordId: r.recordId, invoice_number: r.invoice_number, confidence: r.confidence, agree: comparable.filter((f) => f.agree).length, total: comparable.length, policyHits: r.policyHits });
  }
  state.n4 = { reconciliations: out };
  const clean = out.filter((r) => r.policyHits.length === 0).length;
  return `${out.length} invoices reconciled; ${clean} clean, ${out.length - clean} with policy hits`;
}
