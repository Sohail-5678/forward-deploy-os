/**
 * A small, deterministic, LangGraph-style state machine (rule T3: it is not
 * LangGraph). State is a plain serializable object; each node returns new
 * state plus events; a checkpoint is taken after every node. Runs can suspend
 * for a human (signed checkpoint), resume, be inspected, and be forked from
 * any checkpoint with changed parameters.
 */
import type { AnyEngineEvent, BatchInput, Checkpoint, GraphState, HumanDecision, NodeId, RunConfig } from "../types";
import type { Clock } from "../clock";
import { now } from "../clock";
import { canonicalJSON, sha256Hex, shortHash } from "../hash";
import { appendAudit } from "./audit";
import { makeNodeCtx, NODE_NAMES, type EngineDeps, type NodeCtx } from "./runtime";
import { node1Ingest } from "./nodes/n1-ingest";
import { node2Drift } from "./nodes/n2-drift";
import { node3Heal } from "./nodes/n3-heal";
import { node4Reconcile } from "./nodes/n4-reconcile";
import { node5Policy } from "./nodes/n5-policy";
import { node6Distill } from "./nodes/n6-distill";
import { node7Execute } from "./nodes/n7-execute";
import { node8Audit } from "./nodes/n8-audit";
import { humanDecisionSchema } from "../schemas";

const NODES: Record<NodeId, (ctx: NodeCtx) => Promise<string>> = {
  1: node1Ingest,
  2: node2Drift,
  3: node3Heal,
  4: node4Reconcile,
  5: node5Policy,
  6: node6Distill,
  7: node7Execute,
  8: node8Audit,
};

export function newRunId(): string {
  const rand = typeof globalThis.crypto?.getRandomValues === "function" ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, "0")).join("") : Math.random().toString(36).slice(2, 12);
  return `run_${Date.now().toString(36)}${rand}`.slice(0, 40);
}

export function createRun(input: BatchInput, config: RunConfig, opts: { clock: Clock; runId?: string }): GraphState {
  return {
    version: 2,
    runId: opts.runId ?? newRunId(),
    createdAt: opts.clock.iso(),
    config,
    input,
    cursor: 1,
    status: "RUNNING",
    pending: [],
    decisions: [],
    audit: [],
    nodeMs: {},
    engineMs: 0,
    eventSeq: 0,
  };
}

/** Canonical hash of a state (what the server signs and re-verifies). */
export function stateHash(state: GraphState): string {
  return sha256Hex(canonicalJSON(state));
}

export function makeCheckpoint(state: GraphState, atNode: NodeId, clock: Clock, parent?: string): Checkpoint {
  const sha = stateHash(state);
  return {
    id: `${state.runId}@${atNode}#${shortHash(sha, 10)}`,
    runId: state.runId,
    atNode,
    status: state.status,
    state,
    stateSha256: sha,
    parentCheckpoint: parent,
    createdAt: clock.iso(),
  };
}

export interface StepResult {
  state: GraphState;
  events: AnyEngineEvent[];
  checkpoint: Checkpoint;
  node: NodeId;
}

/** Run the node at the cursor. Returns the new state, its events and a checkpoint. */
export async function runNode(prev: GraphState, deps: EngineDeps): Promise<StepResult> {
  if (prev.status !== "RUNNING") throw new Error(`run ${prev.runId} is ${prev.status}`);
  if (prev.cursor > 8) throw new Error(`run ${prev.runId} has finished`);
  const node = prev.cursor as NodeId;
  const state: GraphState = structuredClone(prev);
  const ctx = makeNodeCtx(state, deps, node);
  ctx.emit("NODE_STARTED", { name: NODE_NAMES[node] });
  let summary: string;
  try {
    summary = await NODES[node](ctx);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    state.status = "FAILED";
    state.error = { node, message };
    const ms = now() - ctx.t0;
    state.nodeMs[node] = Math.round(((state.nodeMs[node] ?? 0) + ms) * 1000) / 1000;
    ctx.emit("RUN_FAILED", { node, message });
    ctx.audit("RUN_FAILED", { node, message });
    state.engineMs += ms;
    return { state, events: ctx.events, checkpoint: makeCheckpoint(state, node, deps.clock), node };
  }
  const ms = now() - ctx.t0;
  state.nodeMs[node] = Math.round(((state.nodeMs[node] ?? 0) + ms) * 1000) / 1000;
  const counts = nodeCounts(state, node);
  ctx.emit("NODE_FINISHED", { name: NODE_NAMES[node], summary, counts }, ms);
  state.engineMs += ms;
  if (state.status === "RUNNING") state.cursor = (node + 1) as NodeId | 9;
  return { state, events: ctx.events, checkpoint: makeCheckpoint(state, node, deps.clock), node };
}

function nodeCounts(s: GraphState, node: NodeId): Record<string, number> {
  switch (node) {
    case 1:
      return { docs: s.n1?.docs.length ?? 0, quarantined: s.n1?.docs.filter((d) => d.quarantined).length ?? 0 };
    case 2:
      return { errors: s.n2?.reports.reduce((a, r) => a + r.errors.length, 0) ?? 0, quarantinedRows: s.n2?.reports.reduce((a, r) => a + r.quarantined.length, 0) ?? 0 };
    case 3:
      return { promoted: s.n3?.records.length ?? 0, invariantsPassed: s.n3?.files.reduce((a, f) => a + f.invariants.filter((i) => i.passed).length, 0) ?? 0 };
    case 4:
      return { reconciled: s.n4?.reconciliations.length ?? 0, withHits: s.n4?.reconciliations.filter((r) => r.policyHits.length).length ?? 0 };
    case 5:
      return { approved: s.n5?.approved.length ?? 0, pending: s.pending.length };
    case 6:
      return { nodes: s.n6?.nodeCount ?? 0, rawTokens: s.n6?.rawTokens ?? 0, distilledTokens: s.n6?.distilledTokens ?? 0 };
    case 7:
      return { posted: s.n7?.postings.length ?? 0, duplicates: s.n7?.duplicatesPrevented.length ?? 0, blocked: s.n7?.guardBlocks ?? 0, healed: s.n7?.heals.filter((h) => h.outcome === "healed" || h.outcome === "human-picked").length ?? 0 };
    case 8:
      return { auditEntries: s.audit.length };
  }
}

/** Run nodes until the run suspends, completes, fails, or reaches `stopBefore`. */
export async function runToPause(state: GraphState, deps: EngineDeps, opts: { stopBefore?: NodeId } = {}): Promise<{ state: GraphState; events: AnyEngineEvent[]; checkpoints: Checkpoint[] }> {
  const events: AnyEngineEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  let s = state;
  while (s.status === "RUNNING" && s.cursor <= 8 && (opts.stopBefore === undefined || s.cursor < opts.stopBefore)) {
    const r = await runNode(s, deps);
    events.push(...r.events);
    checkpoints.push(r.checkpoint);
    s = r.state;
  }
  return { state: s, events, checkpoints };
}

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

/**
 * Apply human decisions to a suspended run. The caller must first have the
 * server verify the signed checkpoint (POST /api/checkpoint/verify).
 */
export function applyDecisions(prev: GraphState, decisions: HumanDecision[], clock: Clock, verified: { stateSha256: string }): { state: GraphState; events: AnyEngineEvent[] } {
  if (prev.status !== "SUSPENDED_HITL") throw new DecisionError("run is not waiting for a human");
  if (stateHash(prev) !== verified.stateSha256) throw new DecisionError("decisions do not belong to this checkpoint");
  const state: GraphState = structuredClone(prev);
  const events: AnyEngineEvent[] = [];
  const pending = state.pending;
  const atNode = state.cursor as NodeId;
  const emit = <T extends AnyEngineEvent["type"]>(type: T, payload: Extract<AnyEngineEvent, { type: T }>["payload"]) => {
    const e = { seq: state.eventSeq++, runId: state.runId, node: atNode, at: state.engineMs, type, payload } as unknown as AnyEngineEvent;
    events.push(e);
  };
  for (const raw of decisions) {
    const d = humanDecisionSchema.parse(raw);
    const esc = pending.find((p) => p.id === d.escalationId);
    if (!esc) throw new DecisionError(`no pending escalation ${d.escalationId}`);
    if (!esc.options.some((o) => o.choice === d.choice)) throw new DecisionError(`"${d.choice}" is not an option for ${d.escalationId}`);
    state.decisions.push(d);
    state.audit = appendAudit(state.audit, { actor: `human:${d.operator}`, kind: "HUMAN_DECISION", data: { escalationId: d.escalationId, choice: d.choice, note: d.note ?? null, checkpointSha256: verified.stateSha256 } }, clock);
    emit("HUMAN_DECISION", { decision: d });
  }
  const undecided = pending.filter((p) => !state.decisions.some((d) => d.escalationId === p.id));
  if (undecided.length) throw new DecisionError(`${undecided.length} escalation(s) still need a decision`);

  // Where to resume: date re-reads re-run healing; selector picks continue node 7.
  let cursor: NodeId = atNode === 7 ? 7 : 5;
  for (const p of pending) {
    if (p.kind !== "AMBIGUOUS_DATE") continue;
    const d = state.decisions.filter((x) => x.escalationId === p.id).pop()!;
    if (d.choice === "READ_DMY" || d.choice === "READ_MDY") {
      state.config.dateOverrides[p.fileId] = d.choice === "READ_DMY" ? "DD/MM/YYYY" : "MM/DD/YYYY";
      cursor = 3;
    }
  }
  state.pending = [];
  state.status = "RUNNING";
  state.cursor = cursor;
  emit("RUN_RESUMED", { fromNode: cursor, decisions: decisions.length });
  return { state, events };
}

export interface ForkOverrides {
  policy?: Partial<RunConfig["policy"]>;
  chaos?: RunConfig["chaos"];
  security?: Partial<RunConfig["security"]>;
  contract?: RunConfig["contract"];
  healing?: Partial<RunConfig["healing"]>;
  mode?: RunConfig["mode"];
}

function describeChanges(o: ForkOverrides): string[] {
  const out: string[] = [];
  if (o.policy) for (const [k, v] of Object.entries(o.policy)) out.push(`policy.${k} = ${v}`);
  if (o.chaos) out.push(`chaos = ${o.chaos.types.join(", ") || "none"} (seed ${o.chaos.seed})`);
  if (o.security) for (const [k, v] of Object.entries(o.security)) out.push(`security.${k} = ${v}`);
  if (o.healing) for (const [k, v] of Object.entries(o.healing)) out.push(`healing.${k} = ${v}`);
  if (o.contract) out.push(`contract edited (${o.contract.fields.length} fields)`);
  if (o.mode) out.push(`mode = ${o.mode}`);
  return out;
}

/**
 * Fork: re-run from `fromNode` with changed parameters, starting from the
 * state the original run had just before that node.
 */
export function forkFrom(source: Checkpoint, fromNode: NodeId, overrides: ForkOverrides, clock: Clock): GraphState {
  if (source.atNode >= fromNode) throw new Error("fork source must be a checkpoint taken before the fork node");
  const base: GraphState = structuredClone(source.state);
  const keep = (n: NodeId) => n < fromNode;
  const state: GraphState = {
    ...base,
    runId: `${base.runId.slice(0, 28)}_f${shortHash(sha256Hex(`${base.runId}:${fromNode}:${canonicalJSON(overrides)}:${clock.iso()}`), 6)}`,
    parentRunId: base.runId,
    forkedFrom: { runId: base.runId, checkpointId: source.id, fromNode, changes: describeChanges(overrides) },
    config: {
      ...base.config,
      policy: { ...base.config.policy, ...overrides.policy },
      chaos: overrides.chaos ?? base.config.chaos,
      security: { ...base.config.security, ...overrides.security },
      contract: overrides.contract ?? base.config.contract,
      healing: { ...base.config.healing, ...overrides.healing },
      mode: overrides.mode ?? base.config.mode,
    },
    cursor: fromNode,
    status: "RUNNING",
    pending: [],
    decisions: fromNode > 5 ? base.decisions : [],
    n1: keep(1) ? base.n1 : undefined,
    n2: keep(2) ? base.n2 : undefined,
    n3: keep(3) ? base.n3 : undefined,
    n4: keep(4) ? base.n4 : undefined,
    n5: keep(5) ? base.n5 : undefined,
    n6: keep(6) ? base.n6 : undefined,
    n7: keep(7) ? base.n7 : undefined,
    n8: undefined,
    nodeMs: Object.fromEntries(Object.entries(base.nodeMs).filter(([k]) => Number(k) < fromNode)),
  };
  state.audit = appendAudit(base.audit, { actor: "engine", kind: "FORKED", data: { from: base.runId, checkpoint: source.id, fromNode, changes: state.forkedFrom!.changes } }, clock);
  return state;
}
