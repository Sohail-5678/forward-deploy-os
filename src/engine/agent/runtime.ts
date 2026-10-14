/**
 * Shared runtime for graph nodes: dependencies, event emission with measured
 * timings (rule T2), and audit appends.
 */
import type { AnyEngineEvent, AuditEntry, EngineEvent, EventPayloads, EventType, GraphState, NodeId, SelectorCacheEntry } from "../types";
import type { Clock } from "../clock";
import { now } from "../clock";
import type { PortalDriver } from "../browser/driver";
import type { SelectorCache } from "../browser/selector-healer";
import type { PdfExtraction } from "../docs/pdf-extract";
import type { LlmClient } from "../llm/client";
import type { ExecutorContext } from "../browser/executor";
import { appendAudit } from "./audit";

export const NODE_NAMES: Record<NodeId, string> = {
  1: "Ingest & Firewall",
  2: "Schema Drift Detector",
  3: "Heal & Invariant Gate",
  4: "Cross-Doc Reconciler",
  5: "Policy & HITL Gate",
  6: "DOM Distiller",
  7: "Portal Executor",
  8: "Audit Commit",
};

export const NODE_BLURBS: Record<NodeId, string> = {
  1: "Parse every file, scan each text channel for hidden instructions, quarantine hostile documents.",
  2: "Validate rows against the contract and report field-level drift; failing rows go to quarantine.",
  3: "Synthesize a declarative mapping, prove it with 5 invariant checks, promote only safe rows.",
  4: "Compare PDF, CSV and ERP purchase order per invoice and compute a calibrated confidence.",
  5: "Apply hard policy rules first; pause at a signed checkpoint when a human must decide.",
  6: "Read the legacy portal as a compact numbered text map of its interactive elements.",
  7: "Bind approved values, check every action with the guard, heal broken selectors, post.",
  8: "Seal the hash-chained audit log and produce the run summary.",
};

export interface EngineDeps {
  clock: Clock;
  driver?: PortalDriver;
  selectorCache?: SelectorCache;
  /** Warm cache recorded before the portal changed (scenarios 3 and 5). */
  recordedCache?: SelectorCacheEntry[];
  pdf?: (bytes: Uint8Array) => Promise<PdfExtraction>;
  blobs?: (sha256: string) => Promise<Uint8Array | undefined>;
  llm?: LlmClient;
  countTokens?: (text: string) => number;
  pace?: ExecutorContext["pace"];
  onEvent?: (e: AnyEngineEvent) => void;
  signal?: AbortSignal;
  nonce?: () => string;
}

export interface NodeCtx {
  state: GraphState;
  deps: EngineDeps;
  node: NodeId;
  events: AnyEngineEvent[];
  t0: number;
  emit<T extends EventType>(type: T, payload: EventPayloads[T], ms?: number): void;
  audit(kind: string, data: unknown, actor?: AuditEntry["actor"]): void;
}

export function makeNodeCtx(state: GraphState, deps: EngineDeps, node: NodeId): NodeCtx {
  const t0 = now();
  const events: AnyEngineEvent[] = [];
  const ctx: NodeCtx = {
    state,
    deps,
    node,
    events,
    t0,
    emit(type, payload, ms) {
      const e = {
        seq: state.eventSeq++,
        runId: state.runId,
        node,
        at: Math.round((state.engineMs + (now() - t0)) * 1000) / 1000,
        ms: ms === undefined ? undefined : Math.round(ms * 1000) / 1000,
        type,
        payload,
      } as EngineEvent<typeof type> as AnyEngineEvent;
      events.push(e);
      deps.onEvent?.(e);
    },
    audit(kind, data, actor = "engine") {
      state.audit = appendAudit(state.audit, { actor, kind, data }, deps.clock);
    },
  };
  return ctx;
}
