/**
 * Self-healing selectors (spec 8.6). When a cached selector stops matching
 * (or matches an element whose fingerprint differs), every candidate on the
 * freshly distilled page is scored against the cached fingerprint:
 * label tokens, neighbor tokens and name tokens (Jaccard), exact role and
 * input type, and closeness of form ordinal. Components with no data on
 * either side are left out of the weighted average.
 *   >= healThreshold (0.80) and a clear margin over the runner-up -> heal
 *   >= askThreshold (0.60) -> ask a human to pick among the top 3
 *   below -> fail with a clear message. Never click a guess.
 */
import type { DistilledNode, DistillResult, Fingerprint, HealAttempt, HealingConfig, SelectorCacheEntry } from "../types";
import { jaccard } from "../etl/tokens";

export const SIMILARITY_WEIGHTS = { label: 0.35, neighbor: 0.2, name: 0.1, role: 0.15, inputType: 0.1, ordinal: 0.1 } as const;

function containment(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const B = new Set(b);
  const inter = new Set(a.filter((x) => B.has(x))).size;
  return inter / Math.min(new Set(a).size, B.size);
}

/** Label similarity: half Jaccard, half containment (abbreviated labels keep their words). */
export function labelSimilarity(a: string[], b: string[]): number {
  return 0.5 * jaccard(a, b) + 0.5 * containment(a, b);
}

export function fingerprintSimilarity(cached: Fingerprint, candidate: Fingerprint): number {
  const comps: [number, number][] = [];
  comps.push([SIMILARITY_WEIGHTS.label, labelSimilarity(cached.labelTokens, candidate.labelTokens)]);
  if (cached.neighborTokens.length && candidate.neighborTokens.length) comps.push([SIMILARITY_WEIGHTS.neighbor, jaccard(cached.neighborTokens, candidate.neighborTokens)]);
  if (cached.nameTokens.length && candidate.nameTokens.length) comps.push([SIMILARITY_WEIGHTS.name, jaccard(cached.nameTokens, candidate.nameTokens)]);
  comps.push([SIMILARITY_WEIGHTS.role, cached.role === candidate.role ? 1 : 0]);
  comps.push([SIMILARITY_WEIGHTS.inputType, (cached.inputType ?? cached.tag) === (candidate.inputType ?? candidate.tag) ? 1 : 0]);
  comps.push([SIMILARITY_WEIGHTS.ordinal, Math.max(0, 1 - Math.abs(cached.formOrdinal - candidate.formOrdinal) / 5)]);
  const total = comps.reduce((s, [w]) => s + w, 0);
  let score = comps.reduce((s, [w, v]) => s + w * v, 0) / total;
  if (cached.role !== candidate.role) score *= 0.3; // a textbox never heals into a button
  if (cached.placeholder && candidate.placeholder && cached.placeholder === candidate.placeholder) score = Math.min(1, score + 0.03);
  return Math.round(score * 1000) / 1000;
}

export interface HealDecision {
  outcome: "healed" | "ask-human" | "failed";
  node?: DistilledNode;
  similarity: number;
  runnerUp?: number;
  candidates: { nodeId: number; selector: string; label: string; similarity: number }[];
}

export function healAgainst(cached: Fingerprint, snapshot: DistillResult, cfg: HealingConfig): HealDecision {
  const scored = snapshot.nodes
    .filter((n) => n.role !== "row" && n.role !== "alert" && n.role !== "status" && n.role !== "dialog")
    .map((n) => ({ node: n, similarity: fingerprintSimilarity(cached, n.fingerprint) }))
    .sort((a, b) => b.similarity - a.similarity);
  const candidates = scored.slice(0, 3).map((s) => ({ nodeId: s.node.id, selector: s.node.selector, label: s.node.label, similarity: s.similarity }));
  const best = scored[0];
  const runnerUp = scored[1]?.similarity ?? 0;
  if (!best) return { outcome: "failed", similarity: 0, candidates };
  if (best.similarity >= cfg.healThreshold && best.similarity - runnerUp >= cfg.minMargin) {
    return { outcome: "healed", node: best.node, similarity: best.similarity, runnerUp, candidates };
  }
  if (best.similarity >= cfg.askThreshold) return { outcome: "ask-human", similarity: best.similarity, runnerUp, candidates };
  return { outcome: "failed", similarity: best.similarity, runnerUp, candidates };
}

/** In-memory selector cache; the browser persists it in IndexedDB, the runner in a JSON file. */
export class SelectorCache {
  private map = new Map<string, SelectorCacheEntry>();
  constructor(entries: SelectorCacheEntry[] = []) {
    for (const e of entries) this.map.set(e.key, e);
  }
  get(key: string): SelectorCacheEntry | undefined {
    return this.map.get(key);
  }
  set(key: string, fingerprint: Fingerprint, at: string): void {
    this.map.set(key, { key, fingerprint, recordedAt: at });
  }
  entries(): SelectorCacheEntry[] {
    return [...this.map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  get size(): number {
    return this.map.size;
  }
}

export function recordAttempt(key: string, page: string, from: string, decision: HealDecision | null, outcome: HealAttempt["outcome"], to?: string): HealAttempt {
  return {
    key,
    page,
    from,
    to,
    similarity: decision?.similarity ?? 1,
    runnerUp: decision?.runnerUp,
    outcome,
    candidates: decision?.candidates ?? [],
  };
}
