/**
 * Node 6: DOM Distiller. Applies the configured portal chaos, optionally runs
 * the brittle recorded baseline first (Scenario 3), then opens the invoice
 * form and reads it as a numbered text map, reporting raw vs distilled tokens.
 */
import type { NodeCtx } from "../runtime";
import { SelectorCache } from "../../browser/selector-healer";
import { PortalExecutor } from "../../browser/executor";
import { runBaselineScript } from "../../browser/baseline";
import { ATTACKER_IBAN } from "../../data/scenarios";

export function selectorCacheFor(ctx: NodeCtx): SelectorCache {
  const { deps } = ctx;
  if (!deps.selectorCache) deps.selectorCache = new SelectorCache();
  return deps.selectorCache;
}

export function makeExecutor(ctx: NodeCtx, cache: SelectorCache): PortalExecutor {
  const { deps, state } = ctx;
  const sec = state.config.security;
  const planner = sec.hijackedPlanner ? "hijacked" : state.config.mode === "llm" && sec.llmPlanner && deps.llm ? "llm" : "deterministic";
  return new PortalExecutor({
    driver: deps.driver!,
    cache,
    healing: state.config.healing,
    vendorMaster: state.input.vendorMaster,
    clock: deps.clock,
    emit: ctx.emit.bind(ctx),
    planner,
    useCache: true,
    attackerIban: ATTACKER_IBAN,
    selectorPicks: {},
    pace: deps.pace,
    countTokens: deps.countTokens,
    signal: deps.signal,
    llmPlan: deps.llm
      ? async (lines, fields, page) => {
          const r = await deps.llm!.planActions({ distilled: lines, fields, page });
          ctx.emit("LLM_CALLED", { task: "plan-actions", model: r.ok ? r.model : "none", ok: r.ok, fallback: !r.ok, reason: r.ok ? undefined : r.reason, ms: r.ms }, r.ms);
          return r.ok ? r.data : null;
        }
      : undefined,
  });
}

export async function node6Distill(ctx: NodeCtx): Promise<string> {
  const { state, deps } = ctx;
  const driver = deps.driver;
  if (!driver) {
    state.n6 = { page: "none", nodeCount: 0, rawTokens: 0, distilledTokens: 0, ratio: 0, lines: [], chaos: [], ms: 0 };
    return "no browser attached: portal steps run in the console, the Playwright runner or the MCP server";
  }
  const chaos = state.config.chaos;
  await driver.setChaos(chaos.types.length ? chaos : null);
  if (state.config.warmSelectorCache && deps.recordedCache) {
    // Selectors recorded on the portal before its weekend release.
    deps.selectorCache = new SelectorCache(deps.recordedCache);
  }
  const cache = selectorCacheFor(ctx);
  const approved = state.n5?.approved ?? [];
  let baseline = undefined;
  if (state.config.baselineFirst && approved.length) {
    baseline = await runBaselineScript(driver, approved[0]);
    ctx.emit("BASELINE_RUN", baseline, baseline.ms);
    ctx.audit("BASELINE_RUN", { ok: baseline.ok, error: baseline.error });
  }
  const exec = makeExecutor(ctx, cache);
  const snap = await exec.inspect("invoice-entry.html");
  const raw = deps.countTokens ? deps.countTokens(snap.rawHtml) : Math.round(snap.rawHtml.length / 4);
  const dis = deps.countTokens ? deps.countTokens(snap.text) : Math.round(snap.text.length / 4);
  const ratio = dis ? Math.round((raw / dis) * 10) / 10 : 0;
  ctx.emit("DOM_DISTILLED", { page: snap.page, nodeCount: snap.nodes.length, rawTokens: raw, distilledTokens: dis, ratio, lines: snap.lines, chaos: chaos.types }, snap.ms);
  state.n6 = { page: snap.page, nodeCount: snap.nodes.length, rawTokens: raw, distilledTokens: dis, ratio, lines: snap.lines, chaos: chaos.types, baseline, ms: snap.ms };
  return `${snap.page}: ${snap.nodes.length} nodes, ${raw} raw HTML tokens -> ${dis} distilled tokens (${ratio}x)${baseline ? `; recorded baseline ${baseline.ok ? "passed" : "failed"}` : ""}`;
}
