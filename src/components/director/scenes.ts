/**
 * Director Mode scenes (spec 14.5). A scene starts when playback reveals a
 * real engine event (rule T2); captions take their numbers from that run's
 * own events and state, never from hand-typed values (rule T1).
 */
import type { AnyEngineEvent, GraphState } from "@/engine/types";
import type { ViewId } from "@/lib/console-store";
import { formatUsd } from "@/engine/format";
import { ofType } from "@/lib/derive";

export interface Scene {
  id: number;
  title: string;
  view: ViewId;
  /** Index of the revealed event that starts this scene, or -1 if not reached yet. */
  startsAt(events: AnyEngineEvent[]): number;
  caption(events: AnyEngineEvent[], graph?: GraphState): string;
}

const firstIndex = (events: AnyEngineEvent[], pred: (e: AnyEngineEvent) => boolean) => events.findIndex(pred);

export const SCENES: Scene[] = [
  {
    id: 1,
    title: "Drift",
    view: "workbench",
    startsAt: () => 0,
    caption(events) {
      const drift = ofType(events, "DRIFT_DETECTED").find((e) => e.payload.errors.some((x) => x.code === "MISSING_REQUIRED_COLUMN"));
      const renamed = drift ? drift.payload.errors.filter((x) => x.code === "MISSING_REQUIRED_COLUMN").length : 0;
      return renamed
        ? `A vendor changed their export overnight. ${renamed} columns renamed, new date and money formats.`
        : "A vendor changed their export overnight. Columns renamed, new date and money formats.";
    },
  },
  {
    id: 2,
    title: "Heal",
    view: "workbench",
    startsAt: (events) => firstIndex(events, (e) => e.type === "MAPPING_SYNTHESIZED"),
    caption: () => "The engine maps the new columns, then proves nothing was lost before using a single row.",
  },
  {
    id: 3,
    title: "Human",
    view: "reconcile",
    startsAt: (events) => firstIndex(events, (e) => e.type === "RUN_SUSPENDED"),
    caption(_events, graph) {
      const rec = graph?.n4?.reconciliations.find((r) => r.erp && r.policyHits.some((h) => h.rule.startsWith("AMOUNT_DELTA")));
      return rec?.erp
        ? `${formatUsd(rec.invoice.gross_amount_cents)} invoice, ${formatUsd(rec.erp.authorized_cents)} purchase order. Money is at stake, so the agent stops and asks a person.`
        : "Money is at stake, so the agent stops and asks a person.";
    },
  },
  {
    id: 4,
    title: "Portal",
    view: "portal",
    startsAt: (events) => firstIndex(events, (e) => e.type === "NODE_STARTED" && e.node === 6),
    caption: () => "The old portal changed its code. The agent finds every field again from what it means, not where it was.",
  },
  {
    id: 5,
    title: "Attack",
    view: "security",
    startsAt: (events) => firstIndex(events, (e) => e.type === "NODE_FINISHED" && e.node === 7),
    caption: () => "This invoice hides instructions to pay an attacker. It never gets near the payment form.",
  },
  {
    id: 6,
    title: "Proof",
    view: "audit",
    // Scene 6 starts after scene 5 has been on screen for its dwell time (see useDirector).
    startsAt: () => -1,
    caption: () => "Every number below was measured on this run or comes from the committed benchmark file.",
  },
];

/** How long scene 5 stays up before the summary (it looks back at node 1's quarantine). */
export const SCENE5_DWELL_MS = 12_000;

export interface RunSummary {
  rowsHealed: number;
  invariantsPassed: number;
  invariantsTotal: number;
  escalations: number;
  decisions: string[];
  selectorsHealed: number;
  meanHealScore?: number;
  posted: number;
  duplicatesPrevented: number;
  quarantinedDocs: number;
  guardBlocks: number;
  /** Nodes 1-5 and 8: pure engine time. */
  engineMs: number;
  /** Nodes 6-7: portal work, which includes the pauses that let a person watch the agent. */
  portalMs: number;
  auditEntries?: number;
  chainValid?: boolean;
}

export function summarize(events: AnyEngineEvent[]): RunSummary {
  const heals = ofType(events, "SELECTOR_HEALED");
  const inv = ofType(events, "INVARIANT_RESULT");
  const audit = ofType(events, "AUDIT_COMMITTED").pop();
  return {
    rowsHealed: ofType(events, "ROWS_PROMOTED").reduce((n, e) => n + e.payload.count, 0),
    invariantsPassed: inv.filter((e) => e.payload.result.passed).length,
    invariantsTotal: inv.length,
    escalations: ofType(events, "POLICY_HIT").length,
    decisions: ofType(events, "HUMAN_DECISION").map((e) => e.payload.decision.choice),
    selectorsHealed: heals.length,
    meanHealScore: heals.length ? heals.reduce((a, e) => a + e.payload.similarity, 0) / heals.length : undefined,
    posted: ofType(events, "POSTED").length,
    duplicatesPrevented: ofType(events, "DUPLICATE_PREVENTED").length,
    quarantinedDocs: ofType(events, "DOC_QUARANTINED").length,
    guardBlocks: ofType(events, "GUARD_BLOCKED").length,
    engineMs: ofType(events, "NODE_FINISHED")
      .filter((e) => e.node !== 6 && e.node !== 7)
      .reduce((a, e) => a + (e.ms ?? 0), 0),
    portalMs: ofType(events, "NODE_FINISHED")
      .filter((e) => e.node === 6 || e.node === 7)
      .reduce((a, e) => a + (e.ms ?? 0), 0),
    auditEntries: audit?.payload.entries,
    chainValid: audit?.payload.valid,
  };
}
