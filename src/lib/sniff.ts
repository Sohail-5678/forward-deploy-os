/**
 * Sandbox upload checks. The file type comes from the bytes, never from the
 * extension or the browser's MIME guess: a PDF must start with %PDF-, text
 * must be valid UTF-8 without NUL bytes, JSON must parse, and CSV must have a
 * consistent column count.
 */
import { parseCsv } from "@/engine/etl/csv";
import type { SandboxUpload } from "./worker-protocol";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOADS = 8;

export type SniffResult = { ok: true; upload: SandboxUpload } | { ok: false; reason: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  // Strip control and bidi characters so a file name can't disguise itself in the UI.
  return base.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").slice(0, 120) || "upload";
}

export function sniffUpload(name: string, bytes: Uint8Array): SniffResult {
  if (bytes.byteLength === 0) return { ok: false, reason: "is empty" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: "is larger than 2 MB" };
  const clean = safeName(name);
  if (PDF_MAGIC.every((b, i) => bytes[i] === b)) return { ok: true, upload: { name: clean, kind: "pdf", bytes } };
  if (bytes.subarray(0, 8192).includes(0)) return { ok: false, reason: "is a binary file; use CSV, JSON, PDF or plain text" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "is not valid UTF-8 text" };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const head = text.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try {
      JSON.parse(text);
      return { ok: true, upload: { name: clean, kind: "json", text } };
    } catch {
      /* not JSON: fall through to CSV / text */
    }
  }
  if (looksLikeCsv(text)) return { ok: true, upload: { name: clean, kind: "csv", text } };
  return { ok: true, upload: { name: clean, kind: "txt", text } };
}

function looksLikeCsv(text: string): boolean {
  const sample = text.slice(0, 64_000);
  const t = parseCsv(sample, "sniff", { maxRows: 50 });
  if (t.headers.length < 2 || t.rows.length < 1) return false;
  const consistent = t.rows.filter((r) => Object.values(r).filter((v) => v !== "").length > 0).length;
  const mismatched = t.warnings.filter((w) => w.startsWith("Row ")).length;
  return consistent > 0 && mismatched <= Math.max(1, Math.floor(t.rows.length * 0.1));
}
