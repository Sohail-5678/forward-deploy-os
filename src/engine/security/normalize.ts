/**
 * Layer 1: normalization and decoding (spec 10.2).
 * Reveals and counts invisible characters, decodes Unicode Tag smuggling
 * inline, applies NFKC, and decodes suspicious Base64 / hex tokens once so the
 * scanner can re-scan what they hide.
 */
import type { DecodedPayload, NormalizedText, RevealedChar } from "../types";

const NAMED: Record<number, string> = {
  0x200b: "ZWSP",
  0x200c: "ZWNJ",
  0x200d: "ZWJ",
  0x2060: "WJ",
  0xfeff: "BOM",
  0x180e: "MVS",
  0x200e: "LRM",
  0x200f: "RLM",
  0x061c: "ALM",
  0x202a: "LRE",
  0x202b: "RLE",
  0x202c: "PDF",
  0x202d: "LRO",
  0x202e: "RLO",
  0x2066: "LRI",
  0x2067: "RLI",
  0x2068: "FSI",
  0x2069: "PDI",
  0x00ad: "SHY",
  0x034f: "CGJ",
};

export function invisibleKind(cp: number): RevealedChar["kind"] | null {
  if (cp >= 0xe0000 && cp <= 0xe007f) return "tag";
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff || cp === 0x180e || (cp >= 0x2061 && cp <= 0x2064)) return "zero-width";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x061c) return "bidi";
  if (cp === 0x00ad) return "soft-hyphen";
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return "variation-selector";
  if (cp === 0x034f || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0 || cp === 0x17b4 || cp === 0x17b5) return "other-invisible";
  return null;
}

export function chipLabel(cp: number): string {
  const named = NAMED[cp];
  if (named) return `⟨${named}⟩`;
  return `⟨U+${cp.toString(16).toUpperCase().padStart(4, "0")}⟩`;
}

export interface NormalizeOutput extends NormalizedText {
  /** normalized index -> original UTF-16 offset. Not persisted in run state. */
  offsetMap: number[];
}

const B64_TOKEN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const HEX_TOKEN = /\b(?:[0-9a-fA-F]{2}){14,}\b/g;

function isMostlyPrintable(s: string): boolean {
  if (s.length < 8) return false;
  let printable = 0;
  let letters = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09) printable++;
    if (/[A-Za-z]/.test(ch)) letters++;
  }
  return printable / s.length >= 0.9 && letters / s.length >= 0.5 && /\s/.test(s);
}

function decodeBase64(token: string): string | null {
  try {
    const clean = token.length % 4 === 0 ? token : token + "=".repeat((4 - (token.length % 4)) % 4);
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return isMostlyPrintable(text) ? text : null;
  } catch {
    return null;
  }
}

function decodeHex(token: string): string | null {
  const bytes = new Uint8Array(token.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return isMostlyPrintable(text) ? text : null;
}

export function normalizeUntrusted(original: string): NormalizeOutput {
  const revealed: RevealedChar[] = [];
  const decodedPayloads: DecodedPayload[] = [];
  let out = "";
  const offsetMap: number[] = [];
  let visible = 0;
  let tagRunStart = -1;
  let tagRunText = "";
  let tagRunOrigStart = -1;

  const flushTagRun = () => {
    if (tagRunStart >= 0 && tagRunText.length > 0) {
      decodedPayloads.push({ kind: "unicode-tags", start: tagRunStart, end: tagRunStart + tagRunText.length, decoded: tagRunText });
    }
    tagRunStart = -1;
    tagRunText = "";
    tagRunOrigStart = -1;
  };

  let prevCp = 0;
  let inFlagSequence = false;
  for (let i = 0; i < original.length; ) {
    const cp = original.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const kind = invisibleKind(cp);
    // Emoji subdivision flags (e.g. the Scotland flag) legitimately use tag
    // characters right after U+1F3F4, terminated by U+E007F.
    if (kind === "tag" && prevCp === 0x1f3f4) inFlagSequence = true;
    else if (kind !== "tag") inFlagSequence = false;
    const isFlagTag = kind === "tag" && inFlagSequence;
    if (cp === 0xe007f) inFlagSequence = false;
    if (kind && !isFlagTag) {
      revealed.push({ offset: i, length: len, codePoint: cp, kind, label: chipLabel(cp) });
      if (kind === "tag" && cp >= 0xe0020 && cp <= 0xe007e) {
        // Decode the smuggled ASCII character inline so rules can see it.
        if (tagRunStart < 0) {
          // Keep a word boundary between visible text and the smuggled text.
          if (out.length > 0 && /[\p{L}\p{N}]$/u.test(out)) {
            out += " ";
            offsetMap.push(i);
          }
          tagRunStart = out.length;
          tagRunOrigStart = i;
        }
        const ch = String.fromCharCode(cp - 0xe0000);
        tagRunText += ch;
        out += ch;
        offsetMap.push(i);
      } else {
        flushTagRun();
      }
      void tagRunOrigStart;
    } else {
      flushTagRun();
      const ch = String.fromCodePoint(cp).normalize("NFKC");
      for (let k = 0; k < ch.length; k++) offsetMap.push(i);
      out += ch;
      if (!/\s/.test(ch)) visible++;
    }
    prevCp = cp;
    i += len;
  }
  flushTagRun();

  // Encoded payloads: decode once (not recursively) and record them for re-scan.
  for (const m of out.matchAll(B64_TOKEN)) {
    const decoded = decodeBase64(m[0]);
    if (decoded) decodedPayloads.push({ kind: "base64", start: m.index!, end: m.index! + m[0].length, decoded });
  }
  for (const m of out.matchAll(HEX_TOKEN)) {
    const decoded = decodeHex(m[0]);
    if (decoded) decodedPayloads.push({ kind: "hex", start: m.index!, end: m.index! + m[0].length, decoded });
  }

  const invisibleCount = revealed.length;
  return {
    original,
    normalized: out,
    revealed,
    invisibleCount,
    invisibleDensity: invisibleCount / Math.max(1, visible + invisibleCount),
    decodedPayloads,
    offsetMap,
  };
}

/** Render text with invisible characters replaced by visible chips (for the UI and logs). */
export function revealInline(original: string): string {
  let out = "";
  for (let i = 0; i < original.length; ) {
    const cp = original.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    out += invisibleKind(cp) ? chipLabel(cp) : original.slice(i, i + len);
    i += len;
  }
  return out;
}

/** Encode ASCII text as invisible Unicode Tag characters (used by the red-team corpus and samples). */
export function toUnicodeTags(ascii: string): string {
  let out = "";
  for (const ch of ascii) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) out += String.fromCodePoint(0xe0000 + c);
  }
  return out;
}
