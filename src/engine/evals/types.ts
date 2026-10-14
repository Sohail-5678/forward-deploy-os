import type { ChaosType, LedgerEntry } from "../types";
import type { PortalDriver, PortalPage } from "../browser/driver";

export interface PortalHandle {
  driver: PortalDriver;
  document(): Document;
  /** Original id of the element a selector resolves to (ground truth kept by chaos mode). */
  truthOf(selector: string): string | null;
  close(): void;
}

export interface PortalFactory {
  open(opts: { page: PortalPage; chaos?: { seed: number; types: ChaosType[] }; latencyScale?: number; ledger?: LedgerEntry[]; loggedIn?: boolean; reveal?: string[] }): Promise<PortalHandle>;
  /** A full multi-page portal session (for idempotency replays). */
  session?(opts: { ledger?: LedgerEntry[] }): Promise<{ driver: PortalDriver; close(): void }>;
  /** Parse a static HTML string into a Document (no scripts), for fixture pages. */
  parseHtml?(html: string): Document;
}

export interface SuiteEnv {
  seed: number;
  countTokens: (text: string) => number;
  progress?: (done: number, total: number) => void;
  portal?: PortalFactory;
  /** Loads a scenario's batch (CSV text + PDF bytes) for the latency suite. */
  loadScenario?: (id: 1 | 2 | 3 | 4 | 5) => Promise<import("../types").BatchInput>;
  environment?: "node" | "browser";
}

export interface SuiteResult<M = Record<string, unknown>> {
  id: string;
  title: string;
  cases: number;
  seed: number;
  baseline?: string;
  metrics: M;
  /** Metrics that depend on wall-clock time (excluded from the drift check). */
  timing?: Record<string, number>;
  ms: number;
  environment: "node" | "browser";
}

export const SUITE_IDS = ["drift", "dates", "invariants", "calibration", "distillation", "selectors", "injection", "guard", "idempotency", "latency"] as const;
export type SuiteId = (typeof SUITE_IDS)[number];
