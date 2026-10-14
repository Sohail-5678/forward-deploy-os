/** Derive view state from the revealed event log (rule T2: the UI renders from real events). */
import type { AnyEngineEvent, EngineEvent, EventType, NodeId } from "@/engine/types";

export type NodeRunStatus = "idle" | "running" | "done" | "suspended" | "failed";

export interface NodeInfo {
  status: NodeRunStatus;
  ms?: number;
  counts?: Record<string, number>;
  summary?: string;
  runs: number;
}

export const NODE_IDS: NodeId[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function nodeInfo(events: AnyEngineEvent[]): Record<NodeId, NodeInfo> {
  const out = Object.fromEntries(NODE_IDS.map((n) => [n, { status: "idle", runs: 0 } as NodeInfo])) as Record<NodeId, NodeInfo>;
  for (const e of events) {
    const n = out[e.node];
    switch (e.type) {
      case "NODE_STARTED":
        n.status = "running";
        n.runs++;
        break;
      case "NODE_FINISHED":
        if (n.status !== "suspended") n.status = "done";
        n.ms = (n.ms ?? 0) + (e.ms ?? 0);
        n.counts = e.payload.counts;
        n.summary = e.payload.summary;
        break;
      case "RUN_SUSPENDED":
        out[e.payload.atNode].status = "suspended";
        break;
      case "RUN_RESUMED":
        for (const id of NODE_IDS) if (out[id].status === "suspended") out[id].status = "done";
        break;
      case "RUN_FAILED":
        out[e.payload.node].status = "failed";
        break;
    }
  }
  return out;
}

export function ofType<T extends EventType>(events: AnyEngineEvent[], type: T): EngineEvent<T>[] {
  return events.filter((e) => e.type === type) as unknown as EngineEvent<T>[];
}

export function lastOfType<T extends EventType>(events: AnyEngineEvent[], type: T): EngineEvent<T> | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === type) return events[i] as unknown as EngineEvent<T>;
  return undefined;
}

export function activeNode(events: AnyEngineEvent[]): NodeId | undefined {
  const info = nodeInfo(events);
  return NODE_IDS.find((n) => info[n].status === "running" || info[n].status === "suspended");
}

export const NODE_COLORS: Record<NodeId, string> = {
  1: "#ff4d8d",
  2: "#ffb547",
  3: "#b88bff",
  4: "#9257f0",
  5: "#f5c26b",
  6: "#00e5ff",
  7: "#34e3a0",
  8: "#d9c2ff",
};

export function describeEvent(e: AnyEngineEvent): string {
  switch (e.type) {
    case "NODE_STARTED":
      return `${e.payload.name} started`;
    case "NODE_FINISHED":
      return e.payload.summary;
    case "DOC_QUARANTINED":
      return `${e.payload.name} quarantined (${e.payload.reason})`;
    case "INJECTION_FLAGGED":
      return `${e.payload.name}: ${e.payload.findings.length} findings, ${e.payload.revealed.length} hidden characters, score ${e.payload.score}`;
    case "SPOTLIGHT_APPLIED":
      return `spotlighted ${e.payload.docId} with nonce ${e.payload.nonce}`;
    case "DRIFT_DETECTED":
      return `${e.payload.fileName}: ${e.payload.errors.length} drift errors`;
    case "ROWS_QUARANTINED":
      return `${e.payload.rows.length} rows quarantined (${e.payload.fileId})`;
    case "MAPPING_SYNTHESIZED":
      return `TransformSpec ${e.payload.specId.slice(0, 10)}: ${e.payload.mappings.length} mappings, ${e.payload.unmappedTarget.length} unmapped targets`;
    case "INVARIANT_RESULT":
      return `${e.payload.result.name} ${e.payload.result.passed ? "passed" : "FAILED"}: ${e.payload.result.detail}`;
    case "ROWS_PROMOTED":
      return `${e.payload.count} rows promoted from ${e.payload.fileId}`;
    case "RECONCILED":
      return `${e.payload.invoice_number}: ${e.payload.agree}/${e.payload.total} fields agree, confidence ${e.payload.confidence.toFixed(2)}${e.payload.policyHits.length ? `, ${e.payload.policyHits.map((h) => h.rule).join(", ")}` : ""}`;
    case "POLICY_HIT":
      return `escalation ${e.payload.escalationId} (${e.payload.kind})`;
    case "RUN_SUSPENDED":
      return `run paused at node ${e.payload.atNode}: ${e.payload.escalations} decision(s) needed`;
    case "HUMAN_DECISION":
      return `${e.payload.decision.operator} chose ${e.payload.decision.choice} for ${e.payload.decision.escalationId}`;
    case "RUN_RESUMED":
      return `resumed at node ${e.payload.fromNode}`;
    case "DOM_DISTILLED":
      return `${e.payload.page}: ${e.payload.nodeCount} nodes${e.payload.rawTokens ? `, ${e.payload.rawTokens} -> ${e.payload.distilledTokens} tokens` : ""}`;
    case "BASELINE_RUN":
      return e.payload.ok ? "recorded baseline script passed" : `recorded baseline script failed: ${e.payload.error}`;
    case "ACTION_PLANNED":
      return `${e.payload.planner} planner: ${e.payload.actions.length} actions${e.payload.rejected.length ? `, ${e.payload.rejected.length} rejected by value binding` : ""}`;
    case "ACTION_EXECUTED": {
      const a = e.payload.action;
      const p = a.planned;
      const what = p.kind === "login" ? `log on: ${p.field}` : p.kind === "click" ? `click ${p.purpose ?? ""} "${a.label ?? ""}"` : p.kind === "waitFor" ? `wait for ${p.text}` : `${p.kind} ${p.valueRef} -> "${a.label ?? ""}"`;
      return `${what}${a.boundValue ? ` = ${a.boundValue}` : ""}`;
    }
    case "SELECTOR_HEALED":
      return `healed ${e.payload.key.split(":")[1]}: ${e.payload.from} -> ${e.payload.to} (${e.payload.similarity.toFixed(2)})`;
    case "GUARD_BLOCKED":
      return `guard blocked: ${e.payload.reasons[0] ?? ""}`;
    case "DUPLICATE_PREVENTED":
      return `${e.payload.invoice_number} already posted as ${e.payload.postingNumber}: duplicate prevented`;
    case "POSTED":
      return `${e.payload.posting.invoice_number} posted as ${e.payload.posting.postingNumber}`;
    case "LLM_CALLED":
      return `LLM ${e.payload.task}: ${e.payload.ok ? `answered by ${e.payload.model}` : `fallback (${e.payload.reason})`}`;
    case "AUDIT_COMMITTED":
      return `${e.payload.entries} audit entries sealed, chain ${e.payload.valid ? "valid" : "BROKEN"}`;
    case "RUN_FAILED":
      return `run failed at node ${e.payload.node}: ${e.payload.message}`;
  }
}
