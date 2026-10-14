/**
 * Text-based PDF extraction (spec 5.3: unpdf / PDF.js; OCR of scanned PDFs is
 * a non-goal). Every text channel is returned separately because attackers
 * hide instructions in the ones humans do not look at:
 *   - page text, rebuilt into lines from positioned text items
 *   - annotation contents (sticky notes, hidden comments)
 *   - document metadata (Title, Subject, Keywords, Author)
 * It also reports text a person cannot see: white text that is not drawn on
 * top of a filled, darker shape (read from the PDF operator list with a
 * graphics-state stack), and text whose font is too small to read.
 */
import type { PdfTextChannel } from "../types";

export interface HiddenSpan {
  page: number;
  text: string;
  reason: "white-on-light" | "tiny-font";
}

export interface PdfExtraction {
  channels: PdfTextChannel[];
  pageCount: number;
  hidden: HiddenSpan[];
}

export const PDF_LIMITS = { maxBytes: 2 * 1024 * 1024, maxPages: 20 } as const;

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Group positioned text items into reading-order lines. */
export function itemsToLines(items: TextItemLike[]): string[] {
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let line = "";
    let lastEnd = -Infinity;
    for (const p of r.parts) {
      if (line && p.x - lastEnd > 1.5 && !line.endsWith(" ") && !p.s.startsWith(" ")) line += " ";
      line += p.s;
      lastEnd = p.x + p.w;
    }
    return line.trimEnd();
  });
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m applied first, then c (PDF `cm` semantics: CTM' = m x CTM). */
function concat(m: Matrix, c: Matrix): Matrix {
  return [
    m[0] * c[0] + m[1] * c[2],
    m[0] * c[1] + m[1] * c[3],
    m[2] * c[0] + m[3] * c[2],
    m[2] * c[1] + m[3] * c[3],
    m[4] * c[0] + m[5] * c[2] + c[4],
    m[4] * c[1] + m[5] * c[3] + c[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function toMatrix(v: unknown): Matrix | null {
  if (!v || typeof v !== "object") return null;
  const arr = Array.from(v as ArrayLike<number>);
  return arr.length >= 6 && arr.slice(0, 6).every((n) => typeof n === "number" && Number.isFinite(n)) ? (arr.slice(0, 6) as Matrix) : null;
}

function luminance(rgb: number[]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function parseColor(fnName: string, args: unknown[]): number[] | null {
  if (fnName === "setFillRGBColor") {
    if (typeof args[0] === "string" && /^#[0-9a-f]{6}$/i.test(args[0])) {
      const h = args[0];
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    }
    const nums = (args as number[]).slice(0, 3).map(Number);
    if (nums.every((n) => Number.isFinite(n))) return nums.map((n) => (n <= 1 ? n * 255 : n));
  }
  if (fnName === "setFillGray") {
    const g = Number(args[0]);
    const v = g <= 1 ? g * 255 : g;
    return [v, v, v];
  }
  if (fnName === "setFillCMYKColor") {
    const [c, m, y, k] = (args as number[]).map(Number);
    return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
  }
  return null;
}

interface GState {
  ctm: Matrix;
  fill: number[];
}

/** Find white text that is not sitting on a darker filled shape. */
function findInvisibleText(fnArray: number[], argsArray: unknown[][], names: Record<number, string>): string[] {
  const out: string[] = [];
  const stack: GState[] = [];
  let gs: GState = { ctm: IDENTITY, fill: [0, 0, 0] };
  const darkRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let textMatrix: Matrix = IDENTITY;
  const fills = new Set(["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"]);
  let buffer = "";
  let bufferHidden = false;
  const flush = () => {
    if (buffer.trim() && bufferHidden) out.push(buffer.trim());
    buffer = "";
  };

  for (let k = 0; k < fnArray.length; k++) {
    const name = names[fnArray[k]] ?? "";
    const args = (argsArray[k] ?? []) as unknown[];
    switch (name) {
      case "save":
        stack.push({ ctm: gs.ctm, fill: gs.fill });
        break;
      case "restore":
        gs = stack.pop() ?? { ctm: IDENTITY, fill: [0, 0, 0] };
        break;
      case "transform": {
        const m = toMatrix(args);
        if (m) gs = { ...gs, ctm: concat(m, gs.ctm) };
        break;
      }
      case "setFillRGBColor":
      case "setFillGray":
      case "setFillCMYKColor": {
        const c = parseColor(name, args);
        if (c) gs = { ...gs, fill: c };
        break;
      }
      case "constructPath": {
        const paint = typeof args[0] === "number" ? names[args[0] as number] : undefined;
        const bbox = args.length ? Array.from((args[args.length - 1] ?? []) as ArrayLike<number>) : [];
        if (paint && fills.has(paint) && bbox.length === 4 && luminance(gs.fill) < 0.8) {
          const [ax, ay] = apply(gs.ctm, bbox[0], bbox[1]);
          const [bx, by] = apply(gs.ctm, bbox[2], bbox[3]);
          darkRects.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
        }
        break;
      }
      case "beginText":
        textMatrix = IDENTITY;
        break;
      case "setTextMatrix": {
        const m = toMatrix(Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? args[0] : args);
        if (m) textMatrix = m;
        break;
      }
      case "moveText": {
        const [tx, ty] = (args as number[]).map(Number);
        textMatrix = [textMatrix[0], textMatrix[1], textMatrix[2], textMatrix[3], textMatrix[4] + tx * textMatrix[0] + ty * textMatrix[2], textMatrix[5] + tx * textMatrix[1] + ty * textMatrix[3]];
        break;
      }
      case "showText":
      case "showSpacedText":
      case "nextLineShowText":
      case "nextLineSetSpacingShowText": {
        const isWhite = luminance(gs.fill) >= 0.95;
        const [x, y] = apply(gs.ctm, textMatrix[4], textMatrix[5]);
        const onDark = darkRects.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1);
        const hidden = isWhite && !onDark;
        if (hidden !== bufferHidden) flush();
        bufferHidden = hidden;
        if (hidden) {
          const glyphs = (args[args.length - 1] ?? []) as unknown[];
          for (const g of Array.isArray(glyphs) ? glyphs : []) {
            if (g && typeof g === "object" && "unicode" in (g as Record<string, unknown>)) buffer += String((g as { unicode: string }).unicode);
            else if (typeof g === "string") buffer += g;
            else if (typeof g === "number" && g < -200) buffer += " ";
          }
          buffer += " ";
        }
        break;
      }
    }
  }
  flush();
  return out;
}

export async function extractPdf(bytes: Uint8Array): Promise<PdfExtraction> {
  if (bytes.length > PDF_LIMITS.maxBytes) throw new Error(`PDF is larger than ${PDF_LIMITS.maxBytes / 1024 / 1024} MB`);
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error("Not a PDF (missing %PDF header)");
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  // PDF.js may transfer the buffer; give it a copy so the caller's bytes stay intact.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true });
  const pdfjs = (await getResolvedPDFJS()) as unknown as { OPS: Record<string, number> };
  const names: Record<number, string> = {};
  for (const [k, v] of Object.entries(pdfjs.OPS)) names[v] = k;
  const channels: PdfTextChannel[] = [];
  const hidden: HiddenSpan[] = [];
  const pageCount = Math.min(pdf.numPages, PDF_LIMITS.maxPages);
  try {
    for (let p = 1; p <= pageCount; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => typeof (i as { str?: unknown }).str === "string") as unknown as TextItemLike[];
      channels.push({ channel: "page", page: p, text: itemsToLines(items).join("\n") });

      const tiny = items
        .filter((i) => i.str.trim() && Math.hypot(i.transform[0], i.transform[1]) < 3)
        .map((i) => i.str)
        .join(" ")
        .trim();
      if (tiny) hidden.push({ page: p, text: tiny, reason: "tiny-font" });

      try {
        const ops = await page.getOperatorList();
        for (const text of findInvisibleText(ops.fnArray, ops.argsArray as unknown[][], names)) hidden.push({ page: p, text, reason: "white-on-light" });
      } catch {
        // Operator lists are best effort; text extraction above still ran.
      }

      const annots = (await page.getAnnotations()) as { contents?: string; contentsObj?: { str?: string }; title?: string; titleObj?: { str?: string } }[];
      for (const a of annots) {
        const text = [a.titleObj?.str ?? a.title ?? "", a.contentsObj?.str ?? a.contents ?? ""].filter(Boolean).join(": ");
        if (text.trim()) channels.push({ channel: "annotation", page: p, text });
      }
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const metaText = ["Title", "Subject", "Keywords", "Author", "Creator"]
      .map((k) => (typeof info[k] === "string" && (info[k] as string).trim() ? `${k}: ${info[k]}` : ""))
      .filter(Boolean)
      .join("\n");
    if (metaText) channels.push({ channel: "metadata", text: metaText });
  } finally {
    const task = (pdf as unknown as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask;
    await (task?.destroy ? task.destroy() : pdf.cleanup()).catch(() => undefined);
  }
  return { channels, pageCount, hidden };
}
