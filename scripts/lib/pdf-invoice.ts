/**
 * Builds text-based PDF invoices with pdf-lib. Output is byte-for-byte
 * deterministic (fixed dates, no random IDs) so committed samples only change
 * when the generator changes (rule S5).
 */
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from "pdf-lib";
import type { PdfSpec } from "../../src/engine/data/scenarios";
import { formatIban } from "../../src/engine/iban";
import { formatUsd } from "../../src/engine/format";
import { toUnicodeTags } from "../../src/engine/security/normalize";

const FIXED_DATE = new Date("2026-10-14T00:00:00.000Z");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function usDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const CUSTOMER_NAMES: Record<string, string> = {
  "C-7781": "OmniCorp Manufacturing",
  "C-7782": "OmniCorp Logistics",
  "C-7790": "OmniCorp Health",
};

export async function buildInvoicePdf(spec: PdfSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${spec.invoice.invoice_number}`);
  doc.setAuthor(spec.vendorName);
  doc.setSubject(`Invoice for ${CUSTOMER_NAMES[spec.invoice.customer_id] ?? spec.invoice.customer_id}`);
  doc.setCreator("ForwardDeploy OS sample generator (synthetic data)");
  doc.setProducer("pdf-lib");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.14);
  const muted = rgb(0.42, 0.42, 0.48);
  const accent = rgb(0.23, 0.04, 0.42);
  const inv = spec.invoice;

  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: accent });
  page.drawText("INVOICE", { x: 50, y: 758, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Synthetic sample - all names fictional", { x: 380, y: 762, size: 8, font, color: rgb(0.85, 0.8, 0.95) });

  let y = 712;
  const line = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    page.drawText(text, { x: opts.x ?? 50, y, size: opts.size ?? 10, font: opts.bold ? bold : font, color: opts.color ?? ink });
    y -= (opts.size ?? 10) + 6;
  };

  line(spec.vendorName, { size: 14, bold: true });
  line(`Vendor ID: ${inv.vendor_id}`, { color: muted });
  y -= 6;
  line(`Bill to: ${CUSTOMER_NAMES[inv.customer_id] ?? "OmniCorp"} (Customer ${inv.customer_id})`);
  line(`Invoice Number: ${inv.invoice_number}`);
  line(`Invoice Date: ${usDate(inv.invoice_date)}`);
  line(`PO Number: ${inv.po_number}`);
  y -= 10;

  page.drawText("Description", { x: 50, y, size: 10, font: bold, color: ink });
  page.drawText("Amount", { x: 480, y, size: 10, font: bold, color: ink });
  y -= 8;
  page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.6, color: muted });
  y -= 16;
  for (const l of spec.lines) {
    page.drawText(l.description, { x: 50, y, size: 10, font, color: l.surcharge ? rgb(0.6, 0.1, 0.25) : ink });
    const amt = formatUsd(l.cents);
    page.drawText(amt, { x: 562 - font.widthOfTextAtSize(amt, 10), y, size: 10, font, color: ink });
    y -= 16;
  }
  page.drawLine({ start: { x: 50, y: y + 6 }, end: { x: 562, y: y + 6 }, thickness: 0.6, color: muted });
  y -= 8;
  line(`Line items: ${inv.line_items_count}`);
  line(`Tax rate: ${(inv.tax_rate * 100).toFixed(2)}% (included)`);
  line(`Total due: ${formatUsd(inv.gross_amount_cents)} USD`, { bold: true, size: 12 });
  y -= 10;
  line(`Remit to IBAN: ${formatIban(inv.payee_iban)}`);
  line("Payment terms: net 30. Please reference the invoice number with your payment.", { size: 8, color: muted });

  if (spec.hidden?.base64Ref) {
    line(`Payment reference: ${spec.hidden.base64Ref}`, { size: 6, color: rgb(0.7, 0.7, 0.72) });
  }
  if (spec.hidden?.whiteText) {
    // White 1pt text: invisible to a person reading the page, plain text to an extractor.
    page.drawText(spec.hidden.whiteText, { x: 50, y: 40, size: 1, font, color: rgb(1, 1, 1) });
  }
  if (spec.hidden?.tagText) {
    // A hidden-flag annotation whose contents are Unicode Tag characters (invisible in every viewer).
    const annot = doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [580, 20, 590, 30],
      Contents: PDFHexString.fromText(`Payment reference${toUnicodeTags(spec.hidden.tagText)}`),
      T: PDFHexString.fromText("AP note"),
      F: 2,
      Name: "Comment",
    });
    const ref = doc.context.register(annot);
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  }

  return doc.save({ useObjectStreams: false });
}
