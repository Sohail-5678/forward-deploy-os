"use client";
import { useEffect } from "react";
/**
 * Console run controller. The engine may finish a node in milliseconds; the
 * UI replays its real event log at a presentation speed the viewer controls
 * (rule T2) and shows the measured duration next to each step. Portal actions
 * (nodes 6-7) happen live, paced so a person can watch the agent work.
 */
import type { AnyEngineEvent, Checkpoint, ContractDef, DecisionChoice, GraphState, HumanDecision, LedgerEntry, NodeId, RunConfig, ScenarioId } from "@/engine/types";
import type { ForkOverrides } from "@/engine/agent/graph";
import { scenarioConfig } from "@/engine/data/scenarios";
import { baseConfig } from "@/engine/config";
import { flightRecorderSchema, type FlightRecorderFile } from "@/engine/schemas";
import { canonicalJSON } from "@/engine/hash";
import { seedFromString } from "@/engine/seed";
import { createStore, type Store } from "./store";
import { EngineClient } from "./engine-client";
import { createIframeDriver, elementRect, PORTAL_BASE } from "./iframe-driver";
import { ApiCallError, getHealth, signCheckpoint, verifyCheckpoint, type Health } from "./api";
import type { FuzzResult, PrepareResponse, SandboxUpload, StepResponse, WorkerStream } from "./worker-protocol";

export type Speed = 0.25 | 0.5 | 1 | 2 | 4 | "instant";
export type ViewId = "workbench" | "reconcile" | "portal" | "security" | "audit";

export interface AgentCursor {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: string;
  at: number;
}

export interface Suspension {
  checkpoint: Checkpoint;
  /** What the server signed (the original state). */
  original: GraphState;
  signature?: string;
  signedAt?: string;
  secretMode?: string;
  status: "signing" | "awaiting" | "sign-failed" | "verifying";
  signError?: string;
  verifyError?: string;
  tampered: boolean;
}

export interface Branch {
  runId: string;
  label: string;
  parentRunId?: string;
  state?: GraphState;
}

export interface ConsoleState {
  ready: boolean;
  scenario: ScenarioId;
  config: RunConfig;
  runId?: string;
  graph?: GraphState;
  checkpoints: Checkpoint[];
  events: AnyEngineEvent[];
  revealed: number;
  speed: Speed;
  running: boolean;
  busy: boolean;
  view: ViewId;
  viewPinned: boolean;
  selectedNode?: NodeId;
  suspension?: Suspension;
  cursor?: AgentCursor;
  health?: Health | null;
  error?: string;
  branches: Branch[];
  uploads: SandboxUpload[];
  operator: string;
  fuzz?: { running: boolean; done: number; total: number; result?: FuzzResult; error?: string };
  replayOnly: boolean;
  liveNode?: NodeId;
  director: boolean;
  /** A visitor-supplied Groq key is held in the engine worker's memory. */
  byokActive: boolean;
  /** Playback and the agent cursor are frozen (Pause). */
  held: boolean;
  /** Choices the scripted demo operator has made so far (Director Mode). */
  demoChoices: Record<string, DecisionChoice>;
}

const BASE_MS: Partial<Record<AnyEngineEvent["type"], number>> = {
  NODE_STARTED: 260,
  NODE_FINISHED: 380,
  DOC_QUARANTINED: 1000,
  INJECTION_FLAGGED: 1300,
  SPOTLIGHT_APPLIED: 450,
  DRIFT_DETECTED: 1300,
  ROWS_QUARANTINED: 700,
  MAPPING_SYNTHESIZED: 1900,
  INVARIANT_RESULT: 460,
  ROWS_PROMOTED: 650,
  RECONCILED: 380,
  POLICY_HIT: 800,
  RUN_SUSPENDED: 600,
  HUMAN_DECISION: 600,
  RUN_RESUMED: 450,
  DOM_DISTILLED: 700,
  BASELINE_RUN: 1600,
  ACTION_PLANNED: 400,
  SELECTOR_HEALED: 450,
  GUARD_BLOCKED: 900,
  DUPLICATE_PREVENTED: 800,
  POSTED: 800,
  LLM_CALLED: 300,
  AUDIT_COMMITTED: 1100,
  RUN_FAILED: 900,
};

const PACE_MS: Record<string, number> = { fill: 300, select: 320, click: 260 };

export function speedFactor(s: Speed): number {
  return s === "instant" ? Infinity : s;
}

export const NODE_VIEW: Record<NodeId, ViewId> = { 1: "security", 2: "workbench", 3: "workbench", 4: "reconcile", 5: "reconcile", 6: "portal", 7: "portal", 8: "audit" };

export function createConsole(): ConsoleController {
  return new ConsoleController();
}

/**
 * Dispose a controller when its owner really unmounts. React's development
 * StrictMode mounts, unmounts and re-mounts every component once; disposing
 * on that first cleanup would stop a run the first mount already started.
 */
const MOUNTS = new WeakMap<ConsoleController, number>();

export function useControllerLifetime(c: ConsoleController, owned: boolean) {
  useEffect(() => {
    c.init();
    MOUNTS.set(c, (MOUNTS.get(c) ?? 0) + 1);
    return () => {
      MOUNTS.set(c, (MOUNTS.get(c) ?? 1) - 1);
      if (!owned) return;
      setTimeout(() => {
        if ((MOUNTS.get(c) ?? 0) === 0) c.dispose();
      }, 0);
    };
  }, [c, owned]);
}

export class ConsoleController {
  readonly store: Store<ConsoleState>;
  private client: EngineClient | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private drainWaiters: (() => void)[] = [];
  private unsub: (() => void) | null = null;
  private loopActive = false;
  /** True while the viewer asked to run continuously (cleared by pause/stop). */
  private autoMode = false;
  private fuzzRuns = 0;
  /** While held, playback and the live agent cursor wait (a real pause, not just "stop after this node"). */
  private held = false;
  private holdWaiters: (() => void)[] = [];
  /** The step (or prepare) in flight; concurrent callers share it instead of racing. */
  private inflight: Promise<void> | null = null;
  private preparing: Promise<boolean> | null = null;

  constructor() {
    this.store = createStore<ConsoleState>({
      ready: false,
      scenario: 5,
      config: scenarioConfig(5),
      checkpoints: [],
      events: [],
      revealed: 0,
      speed: 1,
      running: false,
      busy: false,
      view: "workbench",
      viewPinned: false,
      branches: [],
      uploads: [],
      operator: "",
      replayOnly: false,
      director: false,
      byokActive: false,
      held: false,
      demoChoices: {},
    });
  }

  // ------------------------------------------------------------ lifecycle
  init() {
    if (this.client) return;
    this.client = new EngineClient();
    this.client.setDriverHost({
      driver: createIframeDriver(() => this.iframe),
      pace: (selector, label, kind) => this.pace(selector, label, kind),
    });
    this.unsub = this.client.onStream((m) => this.handleStream(m));
    this.store.set({ ready: true });
    void getHealth().then((health) => this.store.set({ health }));
  }

  dispose() {
    this.hold(false);
    this.unsub?.();
    this.client?.terminate();
    this.client = null;
    if (this.playTimer) clearTimeout(this.playTimer);
  }

  attachIframe(el: HTMLIFrameElement | null) {
    this.iframe = el;
  }

  /** Clear the portal's ledger and session (it lives in this browser's storage) and reload it. */
  resetPortal() {
    try {
      window.localStorage.removeItem("omnicorp.v42.ledger");
      window.sessionStorage.removeItem("omnicorp.v42.session");
      window.sessionStorage.removeItem("omnicorp.v42.interstitial");
    } catch {
      /* storage blocked: the portal falls back to memory */
    }
    if (this.iframe) this.iframe.src = PORTAL_BASE + "index.html";
  }

  /** The attached portal iframe (owned by the split view). */
  portalFrame(): HTMLIFrameElement | null {
    return this.iframe;
  }

  /** Subscribe to the worker's streamed messages (events, progress, bench results). */
  onStream(fn: (m: WorkerStream) => void): () => void {
    this.init();
    return this.client!.onStream(fn);
  }

  get s() {
    return this.store.get();
  }

  private handleStream(m: WorkerStream) {
    if (m.type === "event") {
      if (m.runId !== this.s.runId) return;
      this.store.set((s) => ({ events: [...s.events, m.event], liveNode: m.event.node }));
      this.schedulePlayback();
    } else if (m.type === "progress" && m.channel === "fuzz") {
      this.store.set((s) => ({ fuzz: { ...(s.fuzz ?? { running: true, done: 0, total: m.total }), done: m.done, total: m.total } }));
    }
  }

  // ------------------------------------------------------------ playback
  private eventDuration(e: AnyEngineEvent): number {
    const f = speedFactor(this.s.speed);
    if (!Number.isFinite(f)) return 0;
    let base = BASE_MS[e.type] ?? 300;
    // Portal events are already paced live by the agent cursor.
    if (e.node >= 6 && e.type !== "BASELINE_RUN" && e.type !== "GUARD_BLOCKED") base = Math.min(base, 140);
    if (e.type === "ACTION_EXECUTED") base = 0;
    return base / f;
  }

  private schedulePlayback() {
    if (this.playTimer || this.held) return;
    const tick = () => {
      this.playTimer = null;
      if (this.held) return;
      const s = this.s;
      if (s.revealed >= s.events.length) {
        const w = this.drainWaiters;
        this.drainWaiters = [];
        w.forEach((r) => r());
        return;
      }
      const next = s.events[s.revealed];
      this.reveal(s.revealed + 1, next);
      const delay = this.eventDuration(next);
      if (delay <= 0) {
        // Reveal synchronously-chained events without starving the UI.
        this.playTimer = setTimeout(tick, 0);
      } else this.playTimer = setTimeout(tick, delay);
    };
    this.playTimer = setTimeout(tick, 0);
  }

  private reveal(n: number, e: AnyEngineEvent) {
    const patch: Partial<ConsoleState> = { revealed: n };
    if (!this.s.viewPinned && (e.type === "NODE_STARTED" || e.type === "RUN_SUSPENDED" || e.type === "INJECTION_FLAGGED")) {
      patch.view = e.type === "RUN_SUSPENDED" ? "reconcile" : NODE_VIEW[e.node];
      if (e.type === "RUN_SUSPENDED" && e.node === 7) patch.view = "portal";
    }
    this.store.set(patch);
  }

  /** Freeze (or release) playback and the agent's paced portal actions. */
  hold(on: boolean) {
    if (this.held === on) return;
    this.held = on;
    if (on) {
      if (this.playTimer) clearTimeout(this.playTimer);
      this.playTimer = null;
    } else {
      const w = this.holdWaiters;
      this.holdWaiters = [];
      w.forEach((r) => r());
      this.schedulePlayback();
    }
    this.store.set({ held: on });
  }

  private whileHeld(): Promise<void> {
    if (!this.held) return Promise.resolve();
    return new Promise((r) => this.holdWaiters.push(r));
  }

  waitForDrain(): Promise<void> {
    if (this.s.revealed >= this.s.events.length && !this.playTimer) return Promise.resolve();
    return new Promise((r) => this.drainWaiters.push(r));
  }

  setSpeed(speed: Speed) {
    this.store.set({ speed });
    if (speed === "instant") {
      if (this.playTimer) clearTimeout(this.playTimer);
      this.playTimer = null;
      this.store.set((s) => ({ revealed: s.events.length }));
      const w = this.drainWaiters;
      this.drainWaiters = [];
      w.forEach((r) => r());
    }
  }

  scrubTo(n: number) {
    if (this.s.running) return;
    this.store.set((s) => ({ revealed: Math.max(0, Math.min(s.events.length, n)) }));
  }

  /** Move the agent cursor onto an element of the portal, then wait at presentation speed. */
  private async pace(selector: string, label: string, kind: string): Promise<void> {
    const f = speedFactor(this.s.speed);
    const iframe = this.iframe;
    if (iframe) {
      const r = elementRect(iframe, selector);
      if (r) this.store.set({ cursor: { x: r.left, y: r.top, w: r.width, h: r.height, label, kind, at: Date.now() } });
    }
    if (Number.isFinite(f)) await new Promise((res) => setTimeout(res, (PACE_MS[kind] ?? 280) / f));
    await this.whileHeld();
  }

  // ------------------------------------------------------------ configuration
  selectScenario(id: ScenarioId) {
    if (this.s.running) return;
    this.hold(false);
    const config = id === "sandbox" ? { ...baseConfig("sandbox"), contract: this.s.config.scenarioId === "sandbox" ? this.s.config.contract : baseConfig("sandbox").contract } : scenarioConfig(id);
    this.store.set({ scenario: id, config, runId: undefined, graph: undefined, events: [], revealed: 0, checkpoints: [], suspension: undefined, error: undefined, branches: [], replayOnly: false, cursor: undefined, selectedNode: undefined, demoChoices: {}, fuzz: undefined });
  }

  updateConfig(patch: (c: RunConfig) => RunConfig) {
    if (this.s.running) return;
    this.store.set((s) => ({ config: patch(structuredClone(s.config)) }));
  }

  setContract(contract: ContractDef) {
    this.updateConfig((c) => ({ ...c, contract }));
  }

  setUploads(uploads: SandboxUpload[]) {
    this.store.set({ uploads });
  }

  setView(view: ViewId, pin = true) {
    this.store.set({ view, viewPinned: pin });
  }

  unpinView() {
    this.store.set({ viewPinned: false });
  }

  selectNode(node: NodeId | undefined) {
    this.store.set({ selectedNode: node });
  }

  setOperator(operator: string) {
    this.store.set({ operator });
  }

  async setByok(key: string | null) {
    this.init();
    const r = await this.client!.request<{ ok: boolean; active: boolean }>({ type: "set-byok", key });
    this.store.set({ byokActive: r.active });
    return r;
  }

  // ------------------------------------------------------------ running
  private async readLedger(): Promise<LedgerEntry[]> {
    try {
      const raw = window.localStorage.getItem("omnicorp.v42.ledger");
      return raw ? (JSON.parse(raw) as LedgerEntry[]) : [];
    } catch {
      return [];
    }
  }

  prepare(): Promise<boolean> {
    if (!this.preparing) this.preparing = this.prepareOnce().finally(() => (this.preparing = null));
    return this.preparing;
  }

  private async prepareOnce(): Promise<boolean> {
    this.init();
    const s = this.s;
    if (s.scenario === "sandbox" && s.uploads.length === 0) {
      this.store.set({ error: "Add at least one CSV, JSON, PDF or text file to run the sandbox." });
      return false;
    }
    // Clear the previous run right away, so nothing on screen describes it while the new one prepares.
    this.store.set({ busy: true, error: undefined, graph: undefined, runId: undefined, events: [], revealed: 0, checkpoints: [], suspension: undefined, cursor: undefined, replayOnly: false });
    try {
      const transfer: Transferable[] = [];
      const uploads = s.scenario === "sandbox" ? s.uploads.map((u) => (u.bytes ? { ...u, bytes: u.bytes.slice() } : u)) : undefined;
      uploads?.forEach((u) => u.bytes && transfer.push(u.bytes.buffer));
      const res = await this.client!.request<PrepareResponse>({ type: "prepare", scenario: s.scenario, config: s.config, ledger: await this.readLedger(), uploads }, transfer);
      this.store.set({ runId: res.state.runId, graph: res.state, checkpoints: [res.initial], busy: false, branches: [{ runId: res.state.runId, label: "Main run" }] });
      return true;
    } catch (e) {
      this.store.set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /** Run one node, then let playback catch up. */
  step(): Promise<void> {
    if (this.s.replayOnly) return Promise.resolve();
    this.hold(false);
    if (!this.inflight) this.inflight = this.stepOnce().finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async stepOnce(): Promise<void> {
    if (!this.s.runId) {
      if (!(await this.prepare())) return;
    }
    const s = this.s;
    if (!s.graph || s.graph.status !== "RUNNING" || s.busy) return;
    this.store.set({ busy: true });
    try {
      const res = await this.client!.request<StepResponse>({ type: "step", runId: s.runId! });
      this.store.set((st) => ({ graph: res.state, checkpoints: [...st.checkpoints, res.checkpoint], busy: false, branches: st.branches.map((b) => (b.runId === res.state.runId ? { ...b, state: res.state } : b)) }));
      await this.waitForDrain();
      if (res.state.status === "SUSPENDED_HITL") await this.onSuspended(res.checkpoint);
    } catch (e) {
      this.store.set({ busy: false, error: e instanceof Error ? e.message : String(e), running: false });
    }
  }

  /** Run until the run suspends, completes or fails. */
  async run(): Promise<void> {
    this.hold(false);
    if (this.loopActive) {
      // The previous loop is still finishing a node: let it keep going.
      this.autoMode = true;
      this.store.set({ running: true });
      return;
    }
    // A loaded flight-recorder file is replay-only: running starts a fresh run instead.
    if (this.s.replayOnly) this.selectScenario(this.s.scenario);
    if (!this.s.runId || this.s.graph?.status === "COMPLETED" || this.s.graph?.status === "FAILED") {
      if (!(await this.prepare())) return;
    }
    this.loopActive = true;
    this.autoMode = true;
    this.store.set({ running: true });
    try {
      while (this.s.running && this.s.graph?.status === "RUNNING" && this.s.graph.cursor <= 8) {
        await this.step();
      }
    } finally {
      this.loopActive = false;
      if (this.s.graph?.status !== "RUNNING") this.store.set({ running: false });
    }
  }

  pause() {
    this.autoMode = false;
    this.store.set({ running: false });
    this.hold(true);
  }

  async stop() {
    const id = this.s.runId;
    this.autoMode = false;
    this.store.set({ running: false });
    this.hold(false);
    if (id && this.client) await this.client.request({ type: "abort", runId: id }).catch(() => undefined);
  }

  reset() {
    void this.stop();
    this.selectScenario(this.s.scenario);
  }

  // ------------------------------------------------------------ HITL
  private async onSuspended(checkpoint: Checkpoint) {
    const state = checkpoint.state;
    this.store.set({ suspension: { checkpoint, original: state, status: "signing", tampered: false }, view: this.s.viewPinned ? this.s.view : state.cursor === 7 ? "portal" : "reconcile" });
    try {
      const signed = await signCheckpoint(state.runId, state.cursor > 8 ? 8 : (state.cursor as number), state);
      this.store.set((s) => ({
        suspension: s.suspension && { ...s.suspension, checkpoint: { ...s.suspension.checkpoint, stateSha256: signed.stateSha256, signature: signed.signature, signedAt: signed.signedAt }, signature: signed.signature, signedAt: signed.signedAt, secretMode: signed.secretMode, status: "awaiting" },
      }));
    } catch (e) {
      this.store.set((s) => ({ suspension: s.suspension && { ...s.suspension, status: "sign-failed", signError: e instanceof Error ? e.message : String(e) } }));
    }
  }

  /** Edit the stored checkpoint after it was signed (the server must reject the resume). */
  tamper() {
    const sus = this.s.suspension;
    if (!sus) return;
    const state = structuredClone(sus.checkpoint.state);
    const rec = state.n4?.reconciliations.find((r) => r.policyHits.length) ?? state.n4?.reconciliations[0];
    if (rec) rec.invoice.gross_amount_cents += 100000;
    this.store.set({ suspension: { ...sus, checkpoint: { ...sus.checkpoint, state }, tampered: true, verifyError: undefined } });
  }

  restoreCheckpoint() {
    const sus = this.s.suspension;
    if (!sus) return;
    this.store.set({ suspension: { ...sus, checkpoint: { ...sus.checkpoint, state: sus.original }, tampered: false, verifyError: undefined } });
  }

  async decide(decisions: HumanDecision[]): Promise<boolean> {
    const sus = this.s.suspension;
    const runId = this.s.runId;
    if (!sus || !runId || !sus.signature) return false;
    this.hold(false);
    this.store.set({ suspension: { ...sus, status: "verifying", verifyError: undefined } });
    try {
      const v = await verifyCheckpoint(
        { runId, atNode: sus.checkpoint.state.cursor as number, state: sus.checkpoint.state, stateSha256: sus.checkpoint.stateSha256, signature: sus.signature, signedAt: sus.signedAt },
        decisions,
      );
      const res = await this.client!.request<{ state: GraphState }>({ type: "resume", runId, decisions, stateSha256: v.stateSha256 });
      this.store.set({ graph: res.state, suspension: undefined, demoChoices: {} });
      await this.waitForDrain();
      // "Verify checkpoint and resume": the run continues on its own after a decision.
      if (res.state.status === "RUNNING") void this.continueAfterDecision();
      return true;
    } catch (e) {
      const message = e instanceof ApiCallError ? `${e.code === "CHECKPOINT_TAMPERED" ? "Server rejected the resume: " : ""}${e.message}` : e instanceof Error ? e.message : String(e);
      this.store.set((s) => ({ suspension: s.suspension && { ...s.suspension, status: "awaiting", verifyError: message } }));
      return false;
    }
  }

  private async continueAfterDecision() {
    this.store.set({ running: true });
    this.loopActive = false;
    await this.run();
  }

  // ------------------------------------------------------------ fork + recorder
  async fork(fromNode: NodeId, overrides: ForkOverrides, label: string): Promise<void> {
    const s = this.s;
    if (!s.runId || s.running) return;
    const source = [...s.checkpoints].reverse().find((c) => c.atNode < fromNode && c.runId === s.runId);
    if (!source) {
      this.store.set({ error: `No checkpoint before node ${fromNode} to fork from.` });
      return;
    }
    try {
      const res = await this.client!.request<{ state: GraphState }>({ type: "fork", runId: s.runId, checkpointId: source.id, fromNode, overrides });
      const keep = s.events.filter((e) => e.node < fromNode);
      this.store.set((st) => ({
        runId: res.state.runId,
        graph: res.state,
        checkpoints: st.checkpoints.filter((c) => c.runId === source.runId && c.atNode < fromNode),
        events: keep,
        revealed: keep.length,
        suspension: undefined,
        branches: [...st.branches.map((b) => (b.runId === s.runId ? { ...b, state: s.graph } : b)), { runId: res.state.runId, label, parentRunId: s.runId, state: res.state }],
        config: res.state.config,
      }));
      await this.run();
    } catch (e) {
      this.store.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  exportRun(): FlightRecorderFile | null {
    const s = this.s;
    if (!s.runId || !s.graph) return null;
    return {
      format: "forwarddeploy-os/flight-recorder@2",
      exportedAt: new Date().toISOString(),
      runId: s.runId,
      checkpoints: s.checkpoints.map((c) => ({ ...c, state: c.state as unknown as Record<string, unknown> })),
      events: s.events.map((e) => ({ ...e, payload: e.payload as unknown })),
      audit: s.graph.audit,
    } as FlightRecorderFile;
  }

  async loadRun(text: string): Promise<string | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return "That file is not valid JSON.";
    }
    const parsed = flightRecorderSchema.safeParse(raw);
    if (!parsed.success) return `Not a ForwardDeploy OS flight-recorder file (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}).`;
    this.init();
    try {
      const res = await this.client!.request<{ state: GraphState }>({ type: "load-run", file: parsed.data });
      this.store.set({
        runId: res.state.runId,
        graph: res.state,
        checkpoints: parsed.data.checkpoints as unknown as Checkpoint[],
        events: parsed.data.events as unknown as AnyEngineEvent[],
        revealed: 0,
        scenario: res.state.config.scenarioId,
        config: res.state.config,
        // Loaded files are never executed: replay, inspect and verify only.
        replayOnly: true,
        suspension: undefined,
        branches: [{ runId: res.state.runId, label: "Loaded run" }],
      });
      this.schedulePlayback();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  // ------------------------------------------------------------ fuzz
  async fuzz(fileId: string) {
    const st = this.s.graph;
    const file = st?.n3?.files.find((f) => f.fileId === fileId);
    if (!file || !st) return;
    this.init();
    this.store.set({ fuzz: { running: true, done: 0, total: 300 } });
    try {
      const result = await this.client!.request<FuzzResult>({ type: "fuzz", spec: file.spec, contract: st.config.contract, numRuns: 300, seed: seedFromString(`${file.spec.id}:${this.fuzzRuns++}`) });
      this.store.set({ fuzz: { running: false, done: 300, total: 300, result } });
    } catch (e) {
      this.store.set({ fuzz: { running: false, done: 0, total: 300, error: e instanceof Error ? e.message : String(e) } });
    }
  }

  async request<T>(req: Parameters<EngineClient["request"]>[0]): Promise<T> {
    this.init();
    return this.client!.request<T>(req);
  }

  stateHashMatches(): boolean {
    const sus = this.s.suspension;
    return !!sus && canonicalJSON(sus.checkpoint.state) === canonicalJSON(sus.original);
  }
}
