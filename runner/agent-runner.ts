/**
 * The real browser agent: runs scenarios through the same engine the console
 * uses, against the 2009 portal in headless Chromium.
 *
 *   npm run runner                         Scenarios 1-3 against a built-in static portal server
 *   npm run runner -- --scenarios 1,2,3,4,5
 *   npm run runner -- --base http://localhost:3000   (the running app, e.g. npm run start)
 *   npm run runner -- --headed --slow 120            (watch it work)
 *
 * Human decisions are scripted (the scenario's demo choices) and recorded in
 * the audit chain as "Runner - scripted". Exits non-zero if any scenario
 * misses its expected outcome.
 */
import { chromium, type Browser } from "playwright";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import recorded from "../src/engine/data/selector-cache.v42.json";
import { applyDecisions, createRun, runToPause, stateHash } from "../src/engine/agent/graph";
import type { EngineDeps } from "../src/engine/agent/runtime";
import { systemClock } from "../src/engine/clock";
import { buildScenarioInput, scenarioConfig, SCENARIOS, ATTACKER_IBAN } from "../src/engine/data/scenarios";
import { SelectorCache } from "../src/engine/browser/selector-healer";
import { secureNonce } from "../src/engine/security/spotlighting";
import { verifyAuditChain } from "../src/engine/agent/audit";
import type { Escalation, GraphState, HumanDecision, SelectorCacheEntry } from "../src/engine/types";
import { fsLoader } from "../scripts/lib/fs-loader";
import { createPlaywrightDriver } from "./playwright-driver";
import { startStaticPortal } from "./static-server";

const RECORDED = (recorded as { entries: SelectorCacheEntry[] }).entries;
export const RUNNER_OPERATOR = "Runner - scripted";
/** Postings each scenario must produce on a fresh portal with its scripted decisions. */
export const EXPECTED_POSTINGS: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 6, 2: 2, 3: 3, 4: 1, 5: 5 };

export interface RunnerResult {
  scenario: 1 | 2 | 3 | 4 | 5;
  state: GraphState;
  ok: boolean;
  problems: string[];
  ms: number;
}

function choose(esc: Escalation, id: 1 | 2 | 3 | 4 | 5) {
  const scripted = SCENARIOS[id].demoDecisions?.[esc.kind];
  if (scripted && esc.options.some((o) => o.choice === scripted)) return scripted;
  return (esc.options.find((o) => o.recommended) ?? esc.options[0]).choice;
}

export async function runScenario(browser: Browser, id: 1 | 2 | 3 | 4 | 5, baseUrl: string, slowMoMs = 0): Promise<RunnerResult> {
  const t0 = Date.now();
  // A fresh context per scenario: empty ledger, no session, no chaos left over.
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    const page = await context.newPage();
    const driver = await createPlaywrightDriver(page, { baseUrl, slowMoMs });
    const config = scenarioConfig(id);
    const input = await buildScenarioInput(id, fsLoader, await driver.readLedger());
    const deps: EngineDeps = {
      clock: systemClock,
      driver,
      selectorCache: config.warmSelectorCache ? new SelectorCache(RECORDED) : new SelectorCache(),
      recordedCache: RECORDED,
      countTokens: (t) => countTokens(t),
      nonce: secureNonce,
    };
    let r = await runToPause(createRun(input, config, { clock: systemClock }), deps);
    for (let guard = 0; r.state.status === "SUSPENDED_HITL" && guard < 6; guard++) {
      const at = systemClock.iso();
      const decisions: HumanDecision[] = r.state.pending.map((p) => ({ escalationId: p.id, choice: choose(p, id), operator: RUNNER_OPERATOR, note: "Scripted decision (agent runner)", at }));
      const applied = applyDecisions(r.state, decisions, systemClock, { stateSha256: stateHash(r.state) });
      r = await runToPause(applied.state, deps);
    }
    const s = r.state;
    const problems: string[] = [];
    if (s.status !== "COMPLETED") problems.push(`status ${s.status}${s.error ? `: ${s.error.message}` : ""}`);
    const posted = s.n7?.postings.length ?? 0;
    if (posted !== EXPECTED_POSTINGS[id]) problems.push(`posted ${posted}, expected ${EXPECTED_POSTINGS[id]}`);
    if ((s.n8?.summary.paymentsToUnknownAccounts ?? 0) !== 0) problems.push("a payment went to an unknown account");
    if (s.n7?.postings.some((p) => p.iban.replace(/\s/g, "") === ATTACKER_IBAN)) problems.push("the attacker IBAN was posted");
    if (!verifyAuditChain(s.audit).valid) problems.push("audit chain is broken");
    if (id === 3 && s.n6?.baseline?.ok !== false) problems.push("the recorded baseline script should fail under chaos");
    return { scenario: id, state: s, ok: problems.length === 0, problems, ms: Date.now() - t0 };
  } finally {
    await context.close();
  }
}

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scenarios = (get("scenarios") ?? "1,2,3")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n): n is 1 | 2 | 3 | 4 | 5 => [1, 2, 3, 4, 5].includes(n));
  return { scenarios, base: get("base"), headed: argv.includes("--headed"), slow: Number(get("slow") ?? 0) || 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portal = args.base ? null : await startStaticPortal();
  const baseUrl = args.base ?? portal!.baseUrl;
  const browser = await chromium.launch({ headless: !args.headed });
  console.log(`ForwardDeploy OS agent runner · portal ${baseUrl} · scenarios ${args.scenarios.join(", ")}`);
  let failed = 0;
  try {
    for (const id of args.scenarios) {
      const res = await runScenario(browser, id, baseUrl, args.slow);
      const sum = res.state.n8?.summary;
      const line = [
        `Scenario ${id} ${SCENARIOS[id].title}`.padEnd(46),
        res.ok ? "PASS" : "FAIL",
        `posted ${res.state.n7?.postings.length ?? 0}`,
        `healed ${sum?.selectorsHealed ?? 0}`,
        `blocked ${res.state.n7?.guardBlocks ?? 0}`,
        `duplicates prevented ${res.state.n7?.duplicatesPrevented.length ?? 0}`,
        `${(res.ms / 1000).toFixed(1)} s`,
      ].join(" · ");
      console.log(line);
      for (const p of res.problems) console.log(`    ✗ ${p}`);
      if (!res.ok) failed++;
    }
  } finally {
    await browser.close();
    await portal?.close();
  }
  if (failed) {
    console.error(`${failed} scenario(s) failed.`);
    process.exit(1);
  }
}

if (process.argv[1] && /agent-runner\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
