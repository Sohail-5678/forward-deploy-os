/// <reference lib="webworker" />
/**
 * The engine runs here, off the main thread, so the console stays at 60 fps
 * and every visitor's run is real and inspectable. Portal DOM work is proxied
 * to the main thread (the iframe lives there).
 */
import type { AnyEngineEvent, BatchInput, Checkpoint, GraphState, LedgerEntry, SelectorCacheEntry } from "@/engine/types";
import type { MainToWorker, PrepareResponse, SandboxUpload, ScanReport, StepResponse, WorkerRequest, WorkerStream } from "@/lib/worker-protocol";
import { applyDecisions, createRun, forkFrom, makeCheckpoint, runNode, stateHash } from "@/engine/agent/graph";
import type { EngineDeps } from "@/engine/agent/runtime";
import { systemClock } from "@/engine/clock";
import { buildScenarioInput, ERP_PURCHASE_ORDERS, VENDOR_MASTER, type SampleLoader } from "@/engine/data/scenarios";
import { sha256Hex } from "@/engine/hash";
import { PortalError, type PortalDriver } from "@/engine/browser/driver";
import { SelectorCache } from "@/engine/browser/selector-healer";
import { createHttpLlmClient } from "@/engine/llm/client";
import { scanText } from "@/engine/security/injection-scanner";
import { spotlight, secureNonce } from "@/engine/security/spotlighting";
import { revealInline } from "@/engine/security/normalize";
import { runSuite } from "@/engine/evals/run";
import type { SuiteId } from "@/engine/evals/types";
import recorded from "@/engine/data/selector-cache.v42.json";
import { fuzzTransform } from "./fuzz";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerStream | { type: "response"; id: number; ok: boolean; result?: unknown; error?: { message: string; code?: string } }, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

interface RunRecord {
  state: GraphState;
  checkpoints: Checkpoint[];
  abort: AbortController;
  /** One dependency object per run, so state a node sets up (the warm selector cache) reaches later nodes. */
  deps: EngineDeps;
}

const runs = new Map<string, RunRecord>();
const blobs = new Map<string, Uint8Array>();
const RECORDED = (recorded as { entries: SelectorCacheEntry[] }).entries;
let byokKey: string | null = null;

// ---------------------------------------------------------------- tokens
let tokenizer: ((t: string) => number) | null = null;
async function counter(): Promise<(t: string) => number> {
  if (!tokenizer) {
    const mod = await import("gpt-tokenizer/encoding/o200k_base");
    tokenizer = (t: string) => mod.countTokens(t);
  }
  return tokenizer;
}

// ---------------------------------------------------------------- driver bridge
let callSeq = 0;
const pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function remote<T>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const callId = ++callSeq;
    pendingCalls.set(callId, { resolve: resolve as (v: unknown) => void, reject });
    post({ type: "driver-call", callId, method, args });
  });
}

const driver: PortalDriver = {
  kind: "iframe",
  goto: (p) => remote("goto", p),
  currentPage: () => remote("currentPage"),
  distill: () => remote("distill"),
  probe: (s) => remote("probe", s),
  fill: (s, v) => remote("fill", s, v),
  select: (s, v) => remote("select", s, v),
  click: (s) => remote("click", s),
  waitFor: (c, t) => remote("waitFor", c, t),
  readLedger: () => remote("readLedger"),
  setChaos: (c) => remote("setChaos", c),
  portalInfo: () => remote("portalInfo"),
};

const pace = (selector: string, label: string, kind: string) => remote<void>("pace", selector, label, kind);

// ---------------------------------------------------------------- helpers
const loader: SampleLoader = {
  text: async (p) => {
    const r = await fetch(`/samples/${p}`);
    if (!r.ok) throw new Error(`could not load sample ${p}`);
    return r.text();
  },
  bytes: async (p) => {
    const r = await fetch(`/samples/${p}`);
    if (!r.ok) throw new Error(`could not load sample ${p}`);
    return new Uint8Array(await r.arrayBuffer());
  },
};

function makeRecord(state: GraphState, checkpoints: Checkpoint[]): RunRecord {
  const abort = new AbortController();
  const runId = state.runId;
  const deps: EngineDeps = {
    clock: systemClock,
    driver,
    // Each run gets its own cache: warm (recorded before the portal release) or empty.
    selectorCache: state.config.warmSelectorCache ? new SelectorCache(RECORDED) : new SelectorCache(),
    recordedCache: RECORDED,
    blobs: async (sha) => blobs.get(sha),
    llm: createHttpLlmClient({ byok: () => byokKey ?? undefined }),
    countTokens: (t) => (tokenizer ? tokenizer(t) : Math.round(t.length / 4)),
    pace,
    signal: abort.signal,
    nonce: () => secureNonce(),
    onEvent: (e: AnyEngineEvent) => post({ type: "event", runId, event: e }),
  };
  return { state, checkpoints, abort, deps };
}

async function sandboxInput(uploads: SandboxUpload[], ledger: LedgerEntry[]): Promise<BatchInput> {
  const input: BatchInput = { files: [], pdfs: [], notes: [], erp: ERP_PURCHASE_ORDERS, vendorMaster: VENDOR_MASTER, ledger };
  uploads.forEach((u, i) => {
    const id = `upload-${i + 1}`;
    if (u.kind === "pdf" && u.bytes) {
      const sha = sha256Hex(u.bytes);
      blobs.set(sha, u.bytes);
      input.pdfs.push({ id, name: u.name, sha256: sha });
    } else if (u.kind === "txt") input.notes.push({ id, name: u.name, text: u.text ?? "", sha256: sha256Hex(u.text ?? "") });
    else input.files.push({ id, name: u.name, kind: u.kind === "json" ? "json" : "csv", text: u.text ?? "", sha256: sha256Hex(u.text ?? "") });
  });
  return input;
}

/** Keep PDF bytes out of run state: store them by hash, reference them by hash. */
function stripBytes(input: BatchInput): BatchInput {
  return {
    ...input,
    pdfs: input.pdfs.map((p) => {
      if (p.bytesB64) {
        const bin = atob(p.bytesB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blobs.set(p.sha256, bytes);
      }
      return { id: p.id, name: p.name, sha256: p.sha256 };
    }),
  };
}

function report(text: string): ScanReport {
  const r = scanText(text, "pasted text");
  return {
    hostile: r.hostile,
    score: r.score,
    findings: r.findings.map((f) => ({ ruleId: f.ruleId, ruleName: f.ruleName, severity: f.severity, message: f.message, excerpt: f.excerpt, start: f.start, end: f.end, decodedFrom: f.decodedFrom, category: f.category })),
    revealed: r.normalized.revealed.map((c) => ({ offset: c.offset, length: c.length, label: c.label, kind: c.kind })),
    normalized: r.normalized.normalized,
    spotlight: spotlight(revealInline(text).slice(0, 4000), secureNonce()).text,
    decoded: r.normalized.decodedPayloads.map((d) => ({ kind: d.kind, decoded: d.decoded })),
  };
}

// ---------------------------------------------------------------- handlers
async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.type) {
    case "prepare": {
      await counter().catch(() => null);
      const input = req.scenario === "sandbox" ? await sandboxInput(req.uploads ?? [], req.ledger) : await buildScenarioInput(req.scenario, loader, req.ledger);
      const state = createRun(stripBytes(input), req.config, { clock: systemClock, runId: req.runId });
      const initial = makeCheckpoint(state, 1, systemClock);
      runs.set(state.runId, makeRecord(state, []));
      return { state, initial } satisfies PrepareResponse;
    }
    case "step": {
      const rec = runs.get(req.runId);
      if (!rec) throw new Error("unknown run");
      const r = await runNode(rec.state, rec.deps);
      rec.state = r.state;
      rec.checkpoints.push(r.checkpoint);
      return { state: r.state, checkpoint: r.checkpoint } satisfies StepResponse;
    }
    case "resume": {
      const rec = runs.get(req.runId);
      if (!rec) throw new Error("unknown run");
      if (stateHash(rec.state) !== req.stateSha256) throw new Error("the verified checkpoint does not match this run's state");
      const r = applyDecisions(rec.state, req.decisions, systemClock, { stateSha256: req.stateSha256 });
      rec.state = r.state;
      for (const e of r.events) post({ type: "event", runId: req.runId, event: e });
      return { state: r.state };
    }
    case "fork": {
      const rec = runs.get(req.runId);
      if (!rec) throw new Error("unknown run");
      const source = rec.checkpoints.find((c) => c.id === req.checkpointId);
      if (!source) throw new Error("unknown checkpoint");
      const state = forkFrom(source, req.fromNode, req.overrides, systemClock);
      runs.set(state.runId, makeRecord(state, rec.checkpoints.filter((c) => c.atNode < req.fromNode).map((c) => ({ ...c }))));
      return { state };
    }
    case "load-run": {
      const last = req.file.checkpoints[req.file.checkpoints.length - 1];
      if (!last) throw new Error("the file has no checkpoints");
      const state = last.state as unknown as GraphState;
      runs.set(state.runId, makeRecord(state, req.file.checkpoints as unknown as Checkpoint[]));
      return { state };
    }
    case "abort": {
      runs.get(req.runId)?.abort.abort();
      return { ok: true };
    }
    case "fuzz":
      return fuzzTransform(req.spec, req.contract, req.numRuns, req.seed, (done) => post({ type: "progress", channel: "fuzz", done, total: req.numRuns }));
    case "scan":
      return report(req.text);
    case "tokens": {
      const count = await counter();
      return req.texts.map(count);
    }
    case "set-byok":
      byokKey = req.key && /^gsk_[A-Za-z0-9]{20,120}$/.test(req.key) ? req.key : null;
      return { ok: true, active: !!byokKey };
    case "bench": {
      const count = await counter();
      const results = [];
      for (const id of req.suites as SuiteId[]) {
        const r = await runSuite(id, {
          seed: 20261014,
          countTokens: count,
          environment: "browser",
          loadScenario: (n) => buildScenarioInput(n, loader, []).then(stripBytesForBench),
          progress: (done, total) => post({ type: "progress", channel: "bench", suite: id, done, total }),
        });
        const result = { ...r, environment: "browser" as const };
        post({ type: "bench-suite", result });
        results.push(result);
      }
      return results;
    }
  }
}

function stripBytesForBench(input: BatchInput): BatchInput {
  // The latency suite runs nodes 1-5 directly; keep PDF bytes inline for it.
  return input;
}

ctx.onmessage = async (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  if (msg.type === "driver-result") {
    const p = pendingCalls.get(msg.callId);
    if (!p) return;
    pendingCalls.delete(msg.callId);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(msg.error?.code ? new PortalError(msg.error.message, msg.error.code as PortalError["code"]) : new Error(msg.error?.message ?? "driver error"));
    return;
  }
  const { id, ...req } = msg as { id: number } & WorkerRequest;
  try {
    const result = await handle(req as WorkerRequest);
    post({ type: "response", id, ok: true, result });
  } catch (e) {
    post({ type: "response", id, ok: false, error: { message: e instanceof Error ? e.message : String(e) } });
  }
};
