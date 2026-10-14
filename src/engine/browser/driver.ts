/**
 * The portal driver abstraction. The engine decides; a driver acts. Three
 * implementations share the same engine code:
 *   - document-driver.ts: any DOM Document (the console's same-origin iframe, jsdom in tests)
 *   - runner/playwright-driver.ts: real headless Chromium (Playwright runner, MCP server)
 */
import type { ChaosType, DistillResult, Fingerprint, LedgerEntry } from "../types";

export type PortalPage = "index.html" | "po-search.html" | "invoice-entry.html" | "confirmation.html";

export type WaitCondition =
  | { kind: "page"; page: PortalPage }
  | { kind: "text"; text: string }
  | { kind: "selector"; selector: string }
  | { kind: "idle" };

export interface ProbeResult {
  fingerprint: Fingerprint;
  label: string;
  role: string;
}

export interface PortalDriver {
  readonly kind: "iframe" | "jsdom" | "playwright";
  goto(page: PortalPage): Promise<void>;
  currentPage(): Promise<string>;
  distill(): Promise<DistillResult>;
  /** Resolve a selector now; null when nothing (or more than one element) matches. */
  probe(selector: string): Promise<ProbeResult | null>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  /** Wait for portal state. Never a blind sleep: resolves as soon as the condition holds. */
  waitFor(cond: WaitCondition | WaitCondition[], timeoutMs?: number): Promise<boolean>;
  /** Read the portal ledger (localStorage) for the read-before-write snapshot at run start. */
  readLedger(): Promise<LedgerEntry[]>;
  /** Configure the portal's seeded chaos mode (null clears it). Takes effect on the next page load. */
  setChaos(cfg: { seed: number; types: ChaosType[] } | null): Promise<void>;
  /** Debug info the fictional portal exposes about itself (which chaos was applied). */
  portalInfo?(): Promise<{ chaos: { types: ChaosType[]; applied: Record<string, unknown> } | null }>;
}

export class PortalError extends Error {
  constructor(
    message: string,
    readonly code: "SELECTOR_NOT_FOUND" | "TIMEOUT" | "NAVIGATION" | "UNREACHABLE" | "AMBIGUOUS_SELECTOR",
  ) {
    super(message);
    this.name = "PortalError";
  }
}

export const PORTAL_PAGES: Record<PortalPage, string> = {
  "index.html": "Log on",
  "po-search.html": "Purchase Order Search",
  "invoice-entry.html": "Invoice Entry",
  "confirmation.html": "Posting Confirmation",
};

export function pageFromUrl(url: string): string {
  const m = /\/legacy\/omnicorp\/([^/?#]*)/.exec(url);
  if (!m) return "unknown";
  return m[1] === "" ? "index.html" : m[1];
}

export const LEDGER_STORAGE_KEY = "omnicorp.v42.ledger";
export const SESSION_STORAGE_KEY = "omnicorp.v42.session";
export const CHAOS_STORAGE_KEY = "omnicorp.v42.chaos";
