/**
 * Messages between the console (main thread) and the engine Web Worker.
 * The engine runs in the worker; DOM work on the portal iframe happens on the
 * main thread through `driver-call` round trips.
 */
import type { AnyEngineEvent, Checkpoint, ContractDef, GraphState, HumanDecision, LedgerEntry, NodeId, RunConfig, ScenarioId, TransformSpec } from "@/engine/types";
import type { ForkOverrides } from "@/engine/agent/graph";
import type { SuiteId, SuiteResult } from "@/engine/evals/types";
import type { FlightRecorderFile } from "@/engine/schemas";

export interface SandboxUpload {
  name: string;
  kind: "csv" | "json" | "pdf" | "txt";
  /** Text for csv/json/txt; bytes for pdf. */
  text?: string;
  bytes?: Uint8Array;
}

export interface FuzzResult {
  numRuns: number;
  passed: number;
  failed: boolean;
  ms: number;
  seed: number;
  counterexample?: { record: Record<string, unknown>; row: Record<string, string>; error: string; shrinks: number };
}

export interface ScanReport {
  hostile: boolean;
  score: number;
  findings: { ruleId: string; ruleName: string; severity: string; message: string; excerpt: string; start: number; end: number; decodedFrom?: string; category: string }[];
  revealed: { offset: number; length: number; label: string; kind: string }[];
  normalized: string;
  spotlight: string;
  decoded: { kind: string; decoded: string }[];
}

export type WorkerRequest =
  | { type: "prepare"; scenario: ScenarioId; config: RunConfig; ledger: LedgerEntry[]; uploads?: SandboxUpload[]; runId?: string }
  | { type: "step"; runId: string }
  | { type: "resume"; runId: string; decisions: HumanDecision[]; stateSha256: string }
  | { type: "fork"; runId: string; checkpointId: string; fromNode: NodeId; overrides: ForkOverrides }
  | { type: "load-run"; file: FlightRecorderFile }
  | { type: "fuzz"; spec: TransformSpec; contract: ContractDef; numRuns: number; seed: number }
  | { type: "scan"; text: string }
  | { type: "bench"; suites: SuiteId[] }
  | { type: "tokens"; texts: string[] }
  | { type: "set-byok"; key: string | null }
  | { type: "abort"; runId: string };

export interface StepResponse {
  state: GraphState;
  checkpoint: Checkpoint;
}

export interface PrepareResponse {
  state: GraphState;
  initial: Checkpoint;
}

export type WorkerResponse = { type: "response"; id: number; ok: true; result: unknown } | { type: "response"; id: number; ok: false; error: { message: string; code?: string } };

export type WorkerStream =
  | { type: "event"; runId: string; event: AnyEngineEvent }
  | { type: "progress"; channel: "fuzz" | "bench"; suite?: SuiteId; done: number; total: number }
  | { type: "bench-suite"; result: SuiteResult }
  | { type: "driver-call"; callId: number; method: string; args: unknown[] };

export type MainToWorker = ({ id: number } & WorkerRequest) | { type: "driver-result"; callId: number; ok: boolean; result?: unknown; error?: { message: string; code?: string } };
