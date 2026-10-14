import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { createJsdomPortal, type JsdomPortal } from "../../scripts/lib/jsdom-portal";
import { recordSelectorCache } from "../../scripts/lib/record-cache";
import { buildScenarioInput, scenarioConfig, type SampleLoader } from "@/engine/data/scenarios";
import { applyDecisions, createRun, runToPause, stateHash } from "@/engine/agent/graph";
import type { EngineDeps } from "@/engine/agent/runtime";
import { fixedClock } from "@/engine/clock";
import type { AnyEngineEvent, Checkpoint, DecisionChoice, Escalation, GraphState, RunConfig, SelectorCacheEntry } from "@/engine/types";

export const fsLoader: SampleLoader = {
  text: (p) => readFile(join(process.cwd(), "public", "samples", p), "utf8"),
  bytes: async (p) => new Uint8Array(await readFile(join(process.cwd(), "public", "samples", p))),
};

let recorded: SelectorCacheEntry[] | null = null;
export async function recordedCache() {
  if (!recorded) recorded = await recordSelectorCache();
  return recorded;
}

export interface HeadlessRun {
  state: GraphState;
  events: AnyEngineEvent[];
  checkpoints: Checkpoint[];
  portal: JsdomPortal;
  suspensions: Escalation[][];
}

export async function runScenarioHeadless(
  id: 1 | 2 | 3 | 4 | 5,
  opts: { decisions?: Partial<Record<Escalation["kind"], DecisionChoice>>; configure?: (c: RunConfig) => void; portal?: JsdomPortal; driverless?: boolean } = {},
): Promise<HeadlessRun> {
  const portal = opts.portal ?? (await createJsdomPortal({ latencyScale: 0.01 }));
  const input = await buildScenarioInput(id, fsLoader, await portal.driver.readLedger());
  const config = scenarioConfig(id);
  opts.configure?.(config);
  const clock = fixedClock();
  const deps: EngineDeps = {
    clock,
    driver: opts.driverless ? undefined : portal.driver,
    recordedCache: await recordedCache(),
    countTokens: (t) => countTokens(t),
    nonce: () => "a8f92c",
  };
  const events: AnyEngineEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  const suspensions: Escalation[][] = [];
  let r = await runToPause(createRun(input, config, { clock, runId: `run_s${id}_test` }), deps);
  events.push(...r.events);
  checkpoints.push(...r.checkpoints);
  let guard = 0;
  while (r.state.status === "SUSPENDED_HITL" && guard++ < 6) {
    suspensions.push(r.state.pending);
    const ds = r.state.pending.map((p) => ({
      escalationId: p.id,
      choice: opts.decisions?.[p.kind] ?? p.options.find((o) => o.recommended)?.choice ?? p.options[0].choice,
      operator: "Test Operator",
      at: clock.iso(),
    }));
    const applied = applyDecisions(r.state, ds, clock, { stateSha256: stateHash(r.state) });
    events.push(...applied.events);
    r = await runToPause(applied.state, deps);
    events.push(...r.events);
    checkpoints.push(...r.checkpoints);
  }
  return { state: r.state, events, checkpoints, portal, suspensions };
}
