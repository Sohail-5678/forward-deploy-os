/**
 * Column matcher (spec 8.1).
 *   score = 0.45 * name + 0.45 * value + 0.10 * distribution
 * Assignment uses the Hungarian algorithm (one source per target). Pairs below
 * MAPPING_THRESHOLD stay unmapped and are shown to the user.
 * The weights live here and only here; tune them through the benchmark.
 */
import type { ColumnProfile, ContractDef, ContractField, FieldKind, ValueFamily } from "../types";
import { hungarian } from "./hungarian";
import { nameSimilarity } from "./tokens";
import { FAMILY_REGEX_LABEL } from "./value-profile";

export const MATCH_WEIGHTS = { name: 0.45, value: 0.45, distribution: 0.1 } as const;
export const MAPPING_THRESHOLD = 0.55;

/** How well each value family fits each target kind. */
export const KIND_COMPAT: Readonly<Record<FieldKind, Partial<Record<ValueFamily, number>>>> = {
  vendorId: { VENDOR_ID: 1, TEXT: 0.1 },
  customerId: { CUSTOMER_ID: 1, TEXT: 0.1 },
  poNumber: { PO_ID: 1 },
  invoiceNumber: { INVOICE_ID: 1, TEXT: 0.25, SMALL_INT: 0.1 },
  date: { ISO_DATE: 1, DOTTED_DATE: 1, SLASH_DATE: 1, COMPACT_DATE: 0.9 },
  money: { CURRENCY_STRING: 1, DECIMAL: 0.85, SMALL_INT: 0.3 },
  rate: { PERCENT: 1, UNIT_DECIMAL: 0.9 },
  int: { SMALL_INT: 1 },
  iban: { IBAN: 1 },
  text: { TEXT: 1, INVOICE_ID: 0.2 },
};

/** Kinds whose values should be unique per row within a file. */
const EXPECT_UNIQUE: ReadonlySet<FieldKind> = new Set(["invoiceNumber"]);
/** Kinds whose values usually repeat within one vendor's file. */
const EXPECT_REPEATED: ReadonlySet<FieldKind> = new Set(["vendorId", "customerId", "iban", "rate"]);

export interface PairScore {
  source: string;
  target: string;
  score: number;
  nameScore: number;
  valueScore: number;
  distScore: number;
  evidence: string[];
  evidenceSamples: string[];
}

function nameVariants(field: ContractField): string[] {
  const variants = [field.key, ...field.aliases];
  if (field.canonical && field.canonical !== field.key) variants.push(field.canonical);
  if (field.description) variants.push(field.description);
  return variants;
}

export function scorePair(profile: ColumnProfile, field: ContractField): PairScore {
  const evidence: string[] = [];
  // Name similarity: best over the field's key, aliases and description.
  let bestName = { score: 0, char: 0, token: 0, overlap: [] as string[] };
  for (const v of nameVariants(field)) {
    const s = nameSimilarity(profile.column, v);
    if (s.score > bestName.score) bestName = s;
  }
  if (bestName.overlap.length > 0) evidence.push(`token overlap: ${bestName.overlap.join(", ")}`);
  else if (bestName.char >= 0.2) evidence.push(`3-gram similarity ${bestName.char.toFixed(2)}`);

  // Value fingerprint.
  const compat = KIND_COMPAT[field.kind];
  let valueScore = 0;
  for (const [fam, frac] of Object.entries(profile.families) as [ValueFamily, number][]) {
    valueScore += frac * (compat[fam] ?? 0);
  }
  valueScore *= 1 - 0.5 * profile.emptyFraction;
  const domFrac = profile.families[profile.dominant] ?? 0;
  const n = profile.samples.length;
  if (valueScore > 0.5 && profile.dominant !== "EMPTY") {
    evidence.push(`values match ${FAMILY_REGEX_LABEL[profile.dominant]} (${Math.round(domFrac * 100)}% of sample)`);
  }

  // Distribution: homogeneity of types plus uniqueness fit.
  let uniqFit = 1;
  if (EXPECT_UNIQUE.has(field.kind)) uniqFit = profile.uniqueness;
  else if (EXPECT_REPEATED.has(field.kind)) uniqFit = profile.uniqueness <= 0.5 || n <= 2 ? 1 : 1 - (profile.uniqueness - 0.5);
  const distScore = 0.6 * domFrac + 0.4 * uniqFit;
  if (EXPECT_UNIQUE.has(field.kind) && profile.uniqueness === 1 && n > 1) evidence.push("all sampled values unique");

  const score = MATCH_WEIGHTS.name * bestName.score + MATCH_WEIGHTS.value * valueScore + MATCH_WEIGHTS.distribution * distScore;
  return {
    source: profile.column,
    target: field.key,
    score: round4(score),
    nameScore: round4(bestName.score),
    valueScore: round4(valueScore),
    distScore: round4(distScore),
    evidence,
    evidenceSamples: profile.samples.slice(0, 4),
  };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export interface MatchResult {
  pairs: PairScore[];
  matrix: PairScore[][];
  unmappedSource: string[];
  unmappedTarget: string[];
}

export function matchColumns(profiles: ColumnProfile[], contract: ContractDef, threshold = MAPPING_THRESHOLD): MatchResult {
  const fields = contract.fields;
  const matrix = profiles.map((p) => fields.map((f) => scorePair(p, f)));
  const cost = matrix.map((row) => row.map((s) => 1 - s.score));
  const assignment = profiles.length > 0 && fields.length > 0 ? hungarian(cost) : [];
  const pairs: PairScore[] = [];
  const usedTargets = new Set<string>();
  const usedSources = new Set<string>();
  assignment.forEach((col, row) => {
    if (col < 0) return;
    const s = matrix[row][col];
    if (s.score >= threshold) {
      pairs.push(s);
      usedTargets.add(s.target);
      usedSources.add(s.source);
    }
  });
  // Keep contract order for readability.
  pairs.sort((a, b) => fields.findIndex((f) => f.key === a.target) - fields.findIndex((f) => f.key === b.target));
  return {
    pairs,
    matrix,
    unmappedSource: profiles.map((p) => p.column).filter((c) => !usedSources.has(c)),
    unmappedTarget: fields.map((f) => f.key).filter((k) => !usedTargets.has(k)),
  };
}

/** Baseline for the benchmark: map only columns whose names equal a contract key. */
export function exactNameMatcher(headers: string[], contract: ContractDef): { source: string; target: string }[] {
  const out: { source: string; target: string }[] = [];
  for (const f of contract.fields) {
    const h = headers.find((x) => x.trim().toLowerCase() === f.key.toLowerCase());
    if (h) out.push({ source: h, target: f.key });
  }
  return out;
}
