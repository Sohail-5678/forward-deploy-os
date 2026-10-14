/**
 * Node 1: Ingest & Firewall. Every document is treated as hostile: each text
 * channel is normalized and scanned; hostile documents are quarantined while
 * the others continue. PDFs are text-extracted (pages, annotations, metadata,
 * invisible text layers) and their invoice fields parsed.
 */
import type { ExtractedInvoice, IngestedDoc, InvoiceRecord, SecurityFinding } from "../../types";
import type { NodeCtx } from "../runtime";
import { scanDocument } from "../../security/injection-scanner";
import { spotlight, makeNonce } from "../../security/spotlighting";
import { OBFUSCATION_RULES, HOSTILE_SCORE_THRESHOLD, SEVERITY_WEIGHT } from "../../security/rules";
import { extractPdf } from "../../docs/pdf-extract";
import { extractInvoiceFields, bestIban } from "../../docs/invoice-fields";
import { base64ToBytes } from "../../hash";
import { llmExtractionSchema } from "../../schemas";
import { parseCurrencyCents, parsePercentValue } from "../../etl/normalizers";
import { normalizeIban, isValidIban } from "../../iban";
import { revealInline } from "../../security/normalize";

const MAX_TEXT = 60_000;

function hiddenFindings(docId: string, hidden: { page: number; text: string; reason: string }[]): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const h of hidden) {
    if ((h.text.match(/[A-Za-z]/g) ?? []).length < 8 || seen.has(h.text)) continue;
    seen.add(h.text);
    out.push({
      id: `${docId}:HID-001:${out.length}`,
      ruleId: "HID-001",
      ruleName: OBFUSCATION_RULES["HID-001"].name,
      category: "obfuscation",
      severity: "medium",
      message: `Text drawn so a person cannot see it (${h.reason === "tiny-font" ? "font under 3pt" : "white on a light background"}) on page ${h.page}`,
      channel: `page ${h.page} (hidden layer)`,
      start: 0,
      end: h.text.length,
      excerpt: h.text.slice(0, 160),
    });
  }
  return out;
}

async function llmExtract(ctx: NodeCtx, doc: IngestedDoc, text: string, inv: ExtractedInvoice): Promise<ExtractedInvoice> {
  const llm = ctx.deps.llm;
  if (!llm || ctx.state.config.mode !== "llm" || inv.missing.length === 0) return inv;
  const r = await llm.extractInvoice({ text: text.slice(0, 12_000), docName: doc.name });
  if (!r.ok) {
    ctx.emit("LLM_CALLED", { task: "extract-invoice", model: "none", ok: false, fallback: true, reason: r.reason, ms: r.ms }, r.ms);
    return inv;
  }
  const parsed = llmExtractionSchema.safeParse(r.data);
  if (!parsed.success) {
    ctx.emit("LLM_CALLED", { task: "extract-invoice", model: r.model, ok: false, fallback: true, reason: "response failed schema validation", ms: r.ms }, r.ms);
    return inv;
  }
  ctx.emit("LLM_CALLED", { task: "extract-invoice", model: r.model, ok: true, fallback: false, ms: r.ms }, r.ms);
  const d = parsed.data;
  const fields: Partial<InvoiceRecord> = { ...inv.fields };
  // The model may only fill fields the deterministic extractor could not find.
  if (fields.vendor_id === undefined && d.vendor_id) fields.vendor_id = d.vendor_id.toUpperCase();
  if (fields.po_number === undefined && d.po_number) fields.po_number = d.po_number.toUpperCase();
  if (fields.invoice_number === undefined && d.invoice_number) fields.invoice_number = d.invoice_number.toUpperCase();
  if (fields.invoice_date === undefined && d.invoice_date) fields.invoice_date = d.invoice_date;
  if (fields.gross_amount_cents === undefined && d.gross_amount) {
    const c = parseCurrencyCents(d.gross_amount, "en-US");
    if (c !== null) fields.gross_amount_cents = c;
  }
  if (fields.tax_rate === undefined && d.tax_rate) {
    const t = parsePercentValue(d.tax_rate);
    if (t !== null) fields.tax_rate = t;
  }
  if (fields.line_items_count === undefined && typeof d.line_items_count === "number") fields.line_items_count = d.line_items_count;
  if (fields.payee_iban === undefined && d.payee_iban && isValidIban(d.payee_iban)) fields.payee_iban = normalizeIban(d.payee_iban);
  const missing = inv.missing.filter((f) => (f === "gross_amount_usd" ? fields.gross_amount_cents === undefined : (fields as Record<string, unknown>)[f] === undefined));
  return { ...inv, fields, missing, method: "llm" };
}

export async function node1Ingest(ctx: NodeCtx): Promise<string> {
  const { state, deps } = ctx;
  const sec = state.config.security;
  const nonce = deps.nonce ?? (() => makeNonce(Math.random));
  const docs: IngestedDoc[] = [];

  ctx.audit("RUN_STARTED", {
    scenario: state.config.scenarioId,
    mode: state.config.mode,
    seed: state.config.seed,
    files: state.input.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
    pdfs: state.input.pdfs.map((p) => ({ name: p.name, sha256: p.sha256 })),
  });

  const handleScan = (doc: IngestedDoc) => {
    if (!doc.scan) return;
    if (doc.scan.findings.length > 0) {
      ctx.emit("INJECTION_FLAGGED", { docId: doc.id, name: doc.name, findings: doc.scan.findings.slice(0, 40), revealed: doc.scan.normalized.revealed.slice(0, 400), score: doc.scan.score });
    }
    if (doc.scan.hostile) {
      doc.quarantined = true;
      const rules = [...new Set(doc.scan.findings.map((f) => f.ruleId))];
      doc.quarantineReason = `hostile content: ${rules.join(", ")}`;
      ctx.emit("DOC_QUARANTINED", { docId: doc.id, name: doc.name, reason: doc.quarantineReason, ruleIds: rules });
      ctx.audit("DOC_QUARANTINED", { doc: doc.name, sha256: doc.sha256, rules });
    }
  };

  for (const f of state.input.files) {
    const doc: IngestedDoc = { id: f.id, name: f.name, kind: f.kind, sha256: f.sha256, text: "", scan: null, quarantined: false };
    if (sec.scanner) doc.scan = scanDocument([{ channel: `${f.name}`, text: f.text }]);
    handleScan(doc);
    docs.push(doc);
  }

  for (const p of state.input.pdfs) {
    const doc: IngestedDoc = { id: p.id, name: p.name, kind: "pdf", sha256: p.sha256, text: "", scan: null, quarantined: false };
    try {
      const bytes = (await deps.blobs?.(p.sha256)) ?? (p.bytesB64 ? base64ToBytes(p.bytesB64) : undefined);
      if (!bytes) throw new Error("PDF bytes are not available to this run");
      const ex = await (deps.pdf ?? extractPdf)(bytes);
      const pageText = ex.channels.filter((c) => c.channel === "page").map((c) => c.text).join("\n");
      doc.text = pageText.slice(0, MAX_TEXT);
      doc.channels = [...ex.channels.map((c) => ({ ...c, text: c.text.slice(0, MAX_TEXT) })), ...ex.hidden.map((h) => ({ channel: "page" as const, page: h.page, text: `[hidden ${h.reason}] ${h.text}`.slice(0, 4000) }))];
      let invoice = extractInvoiceFields(pageText);
      invoice = await llmExtract(ctx, doc, pageText, invoice);
      if (sec.compromisedExtraction) {
        // Simulates an extraction model that obeyed the hidden text.
        const labelled = invoice.fields.payee_iban;
        const other = (invoice.candidates.payee_iban ?? []).map((c) => bestIban(c)).find((c): c is string => !!c && c !== labelled);
        if (other) invoice = { ...invoice, fields: { ...invoice.fields, payee_iban: other }, method: "llm" };
      }
      doc.invoice = invoice;
      if (sec.scanner) {
        const scan = scanDocument(ex.channels.map((c) => ({ channel: c.channel === "page" ? `page ${c.page ?? 1}` : c.channel === "annotation" ? `annotation (page ${c.page ?? 1})` : "metadata", text: c.text })));
        const hid = hiddenFindings(doc.id, ex.hidden);
        scan.findings.push(...hid);
        if (hid.length) {
          scan.score = Math.round((scan.score + SEVERITY_WEIGHT.medium) * 100) / 100;
          scan.hostile = scan.hostile || scan.score >= HOSTILE_SCORE_THRESHOLD;
        }
        doc.scan = scan;
      }
      if (sec.spotlighting) {
        doc.spotlight = spotlight(revealInline(pageText).slice(0, 4000), nonce());
        ctx.emit("SPOTLIGHT_APPLIED", { docId: doc.id, nonce: doc.spotlight.nonce, marker: doc.spotlight.marker, preview: doc.spotlight.text.slice(0, 600) });
      }
    } catch (e) {
      doc.quarantined = true;
      doc.quarantineReason = `unreadable PDF: ${e instanceof Error ? e.message : String(e)}`;
      ctx.emit("DOC_QUARANTINED", { docId: doc.id, name: doc.name, reason: doc.quarantineReason, ruleIds: [] });
    }
    handleScan(doc);
    docs.push(doc);
  }

  for (const n of state.input.notes) {
    const doc: IngestedDoc = { id: n.id, name: n.name, kind: "note", sha256: n.sha256, text: n.text.slice(0, MAX_TEXT), scan: null, quarantined: false };
    if (sec.scanner) doc.scan = scanDocument([{ channel: n.name, text: n.text }]);
    handleScan(doc);
    docs.push(doc);
  }

  state.n1 = { docs };
  const q = docs.filter((d) => d.quarantined).length;
  const flagged = docs.filter((d) => d.scan && d.scan.findings.length > 0).length;
  return `${docs.length} documents ingested, ${flagged} flagged, ${q} quarantined${sec.scanner ? "" : " (scanner off)"}`;
}
