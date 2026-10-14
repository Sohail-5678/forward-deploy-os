/**
 * Layer 2: injection scanner. Normalizes, matches the rule set, checks
 * invisible-character density, bidi controls, mixed-script tokens, and
 * re-scans decoded Base64 / hex payloads one level deep. Findings carry rule
 * ids and character offsets so the UI can highlight them.
 */
import type { ScanResult, SecurityFinding, Severity } from "../types";
import { normalizeUntrusted } from "./normalize";
import { HOSTILE_SCORE_THRESHOLD, OBFUSCATION_RULES, PATTERN_RULES, SEVERITY_WEIGHT } from "./rules";

export interface ChannelText {
  channel: string;
  text: string;
}

const MAX_SCAN_CHARS = 400_000;

function excerpt(text: string, start: number, end: number): string {
  const s = Math.max(0, start - 12);
  const e = Math.min(text.length, end + 12);
  return (s > 0 ? "…" : "") + text.slice(s, e).replace(/\s+/g, " ") + (e < text.length ? "…" : "");
}

function finding(
  channel: string,
  ruleId: string,
  name: string,
  category: SecurityFinding["category"],
  severity: Severity,
  message: string,
  text: string,
  start: number,
  end: number,
  decodedFrom?: SecurityFinding["decodedFrom"],
): SecurityFinding {
  return {
    id: `${channel}:${ruleId}:${start}`,
    ruleId,
    ruleName: name,
    category,
    severity,
    message,
    channel,
    start,
    end,
    excerpt: excerpt(text, start, end),
    decodedFrom,
  };
}

function matchRules(text: string, channel: string, decodedFrom?: SecurityFinding["decodedFrom"]): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const rule of PATTERN_RULES) {
    for (const pattern of rule.patterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        out.push(finding(channel, rule.id, rule.name, rule.category, rule.severity, rule.description, text, start, start + m[0].length, decodedFrom));
        break; // one finding per pattern per channel is enough
      }
    }
  }
  return out;
}

const LATIN = /[A-Za-z]/;
const CYRILLIC_GREEK = /[Ͱ-ϿЀ-ӿ]/;

function mixedScriptTokens(text: string): { start: number; end: number; token: string }[] {
  const out: { start: number; end: number; token: string }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const tok = m[0];
    if (LATIN.test(tok) && CYRILLIC_GREEK.test(tok)) out.push({ start: m.index!, end: m.index! + tok.length, token: tok });
  }
  return out;
}

/** Scan one channel of untrusted text. */
export function scanChannel(input: ChannelText): { findings: SecurityFinding[]; normalized: ReturnType<typeof normalizeUntrusted> } {
  const raw = input.text.length > MAX_SCAN_CHARS ? input.text.slice(0, MAX_SCAN_CHARS) : input.text;
  const n = normalizeUntrusted(raw);
  const text = n.normalized;
  const findings: SecurityFinding[] = matchRules(text, input.channel);

  // Map rule hits inside Unicode Tag runs to "decoded from unicode-tags".
  for (const f of findings) {
    const p = n.decodedPayloads.find((d) => d.kind === "unicode-tags" && f.start >= d.start && f.start < d.end);
    if (p) f.decodedFrom = "unicode-tags";
  }

  const tags = n.revealed.filter((r) => r.kind === "tag");
  if (tags.length > 0) {
    const run = n.decodedPayloads.find((d) => d.kind === "unicode-tags");
    findings.push(
      finding(input.channel, "OBF-002", OBFUSCATION_RULES["OBF-002"].name, "obfuscation", "high", `${tags.length} Unicode Tag characters decode to: "${(run?.decoded ?? "").slice(0, 120)}"`, text, run?.start ?? 0, run?.end ?? 0, "unicode-tags"),
    );
  }
  const zw = n.revealed.filter((r) => r.kind === "zero-width" || r.kind === "other-invisible" || r.kind === "soft-hyphen");
  if (zw.length >= 3 && (n.invisibleDensity >= 0.01 || zw.length >= 20)) {
    findings.push(
      finding(input.channel, "OBF-001", OBFUSCATION_RULES["OBF-001"].name, "obfuscation", zw.length >= 20 ? "high" : "medium", `${zw.length} invisible characters (${(n.invisibleDensity * 100).toFixed(1)}% of characters)`, text, 0, Math.min(text.length, 1)),
    );
  }
  const bidi = n.revealed.filter((r) => r.kind === "bidi" && ((r.codePoint >= 0x202a && r.codePoint <= 0x202e) || (r.codePoint >= 0x2066 && r.codePoint <= 0x2069)));
  if (bidi.length > 0) {
    findings.push(finding(input.channel, "OBF-003", OBFUSCATION_RULES["OBF-003"].name, "obfuscation", "medium", `${bidi.length} bidirectional control characters`, text, 0, Math.min(text.length, 1)));
  }
  // Mixed scripts are judged on the text as received (the skeleton has already folded them).
  const mixed = mixedScriptTokens(raw.normalize("NFKC"));
  for (const t of mixed.slice(0, 5)) {
    findings.push(finding(input.channel, "OBF-004", OBFUSCATION_RULES["OBF-004"].name, "obfuscation", "medium", `"${t.token}" mixes Latin with Cyrillic or Greek letters`, raw, t.start, t.end));
  }
  // Decode once and re-scan (spec: one level).
  for (const p of n.decodedPayloads) {
    if (p.kind === "unicode-tags") continue;
    const inner = matchRules(p.decoded, `${input.channel} (decoded ${p.kind})`, p.kind);
    if (inner.length > 0) {
      findings.push(finding(input.channel, "OBF-005", OBFUSCATION_RULES["OBF-005"].name, "obfuscation", "high", `${p.kind} payload decodes to instructions: "${p.decoded.slice(0, 100)}"`, text, p.start, p.end, p.kind));
      findings.push(...inner);
    }
  }
  return { findings, normalized: n };
}

export function scoreFindings(findings: SecurityFinding[]): number {
  // Count each rule once per document so repetition does not inflate the score.
  const byRule = new Map<string, Severity>();
  for (const f of findings) {
    const prev = byRule.get(f.ruleId);
    if (!prev || SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[prev]) byRule.set(f.ruleId, f.severity);
  }
  let score = 0;
  for (const s of byRule.values()) score += SEVERITY_WEIGHT[s];
  return Math.round(score * 100) / 100;
}

/** Scan every text channel of a document and classify it. */
export function scanDocument(channels: ChannelText[]): ScanResult {
  const all: SecurityFinding[] = [];
  const perChannel: ReturnType<typeof normalizeUntrusted>[] = [];
  for (const c of channels) {
    const r = scanChannel(c);
    all.push(...r.findings);
    perChannel.push(r.normalized);
  }
  // Merge reveal stats so the document view shows every hidden character.
  const primary = perChannel.length
    ? perChannel.slice(1).reduce(
        (acc, n) => ({
          ...acc,
          revealed: [...acc.revealed, ...n.revealed],
          invisibleCount: acc.invisibleCount + n.invisibleCount,
          decodedPayloads: [...acc.decodedPayloads, ...n.decodedPayloads],
        }),
        perChannel[0],
      )
    : null;
  const score = scoreFindings(all);
  const hostile = all.some((f) => f.severity === "high") || score >= HOSTILE_SCORE_THRESHOLD;
  const normalized = primary ?? normalizeUntrusted("");
  return {
    findings: all,
    score,
    hostile,
    normalized: {
      original: normalized.original,
      normalized: normalized.normalized,
      revealed: normalized.revealed,
      invisibleCount: normalized.invisibleCount,
      invisibleDensity: normalized.invisibleDensity,
      decodedPayloads: normalized.decodedPayloads,
    },
  };
}

export function scanText(text: string, channel = "text"): ScanResult {
  return scanDocument([{ channel, text }]);
}
