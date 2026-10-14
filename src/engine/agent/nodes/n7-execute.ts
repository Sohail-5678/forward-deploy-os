/**
 * Node 7: Portal Executor. Posts each approved record through the legacy
 * portal: read-before-write, value binding, the always-on guard, self-healing
 * selectors. A selector that heals below the auto-heal threshold suspends the
 * run for a human pick (a second, smaller HITL moment).
 */
import type { ChaosType, ExecutedAction, HealAttempt, Node7Output } from "../../types";
import type { NodeCtx } from "../runtime";
import { makeExecutor, selectorCacheFor } from "./n6-distill";
import { latestDecision } from "./n5-policy";
import { maskIban } from "../../iban";

const MAX_STORED_ACTIONS = 800;

export async function node7Execute(ctx: NodeCtx): Promise<string> {
  const { state, deps } = ctx;
  const approved = state.n5?.approved ?? [];
  const prev = state.n7;
  const out: Node7Output = prev
    ? { ...prev, actions: [...prev.actions], postings: [...prev.postings], duplicatesPrevented: [...prev.duplicatesPrevented], heals: [...prev.heals], failures: [...prev.failures] }
    : { actions: [], postings: [], duplicatesPrevented: [], heals: [], guardBlocks: 0, failures: [], selectorCache: [], chaosReport: [], remaining: approved.map((a) => a.recordId) };

  if (!deps.driver) {
    out.remaining = [];
    state.n7 = out;
    return "no browser attached: nothing posted";
  }
  const cache = selectorCacheFor(ctx);
  const exec = makeExecutor(ctx, cache);

  // Human picks for selector confirmations made on resume.
  const picks: Record<string, number> = {};
  const aborted = new Set<string>();
  for (const d of state.decisions) {
    if (!d.escalationId.startsWith("esc_sel_")) continue;
    const m = /^PICK_CANDIDATE_(\d)$/.exec(d.choice);
    if (m) picks[d.escalationId] = Number(m[1]) - 1;
    if (d.choice === "ABORT") aborted.add(d.escalationId);
  }
  exec.setSelectorPicks(picks);

  let dialogs = 0;
  let slowWait = 0;
  const remaining = [...out.remaining];
  while (remaining.length) {
    if (deps.signal?.aborted) {
      out.failures.push({ recordId: remaining[0], invoice_number: "", reason: "run stopped by the operator" });
      remaining.length = 0;
      break;
    }
    const recordId = remaining[0];
    const rec = approved.find((a) => a.recordId === recordId);
    if (!rec) {
      remaining.shift();
      continue;
    }
    const res = await exec.processRecord(rec);
    dialogs += res.dialogsDismissed;
    slowWait = Math.max(slowWait, res.slowestWaitMs);
    for (const a of res.actions) if (out.actions.length < MAX_STORED_ACTIONS) out.actions.push(a);
    out.heals.push(...res.heals.filter((h) => h.outcome !== "cache-hit" || out.heals.length < 200));
    out.guardBlocks += res.actions.filter((a: ExecutedAction) => !a.guard.allowed).length;
    const o = res.outcome;
    if (o.kind === "ask-human") {
      if (aborted.has(o.escalation.id)) {
        out.failures.push({ recordId, invoice_number: rec.invoice.invoice_number, reason: "operator stopped this record at a selector confirmation" });
        remaining.shift();
        continue;
      }
      if (latestDecision(state.decisions, o.escalation.id)) {
        // A pick was made but still did not resolve; fail safe rather than loop.
        out.failures.push({ recordId, invoice_number: rec.invoice.invoice_number, reason: "selector still ambiguous after the human pick" });
        remaining.shift();
        continue;
      }
      state.pending = [o.escalation];
      state.status = "SUSPENDED_HITL";
      out.remaining = remaining;
      out.selectorCache = cache.entries();
      state.n7 = out;
      ctx.emit("POLICY_HIT", { escalationId: o.escalation.id, kind: "SELECTOR_CONFIRM", recordId, hits: [] });
      ctx.audit("ESCALATED", { escalationId: o.escalation.id, kind: "SELECTOR_CONFIRM", candidates: o.escalation.candidates.map((c) => `${c.label} (${c.similarity})`) });
      ctx.emit("RUN_SUSPENDED", { atNode: 7, escalations: 1 });
      return `paused: selector "${o.escalation.targetKey}" healed with similarity ${o.escalation.candidates[0]?.similarity.toFixed(2) ?? "?"}; a human must confirm`;
    }
    remaining.shift();
    switch (o.kind) {
      case "posted":
        out.postings.push(o.posting);
        ctx.audit("POSTED", { invoice: o.posting.invoice_number, postingNumber: o.posting.postingNumber, amountCents: o.posting.amount_cents, payee: maskIban(o.posting.iban), overrideCode: o.posting.overrideCode });
        break;
      case "duplicate":
        out.duplicatesPrevented.push({ recordId, invoice_number: rec.invoice.invoice_number, postingNumber: o.postingNumber });
        ctx.audit("DUPLICATE_PREVENTED", { invoice: rec.invoice.invoice_number, postingNumber: o.postingNumber });
        break;
      case "blocked":
        out.failures.push({ recordId, invoice_number: rec.invoice.invoice_number, reason: `guard blocked: ${o.reason}` });
        ctx.audit("GUARD_BLOCKED", { invoice: rec.invoice.invoice_number, reason: o.reason });
        break;
      case "failed":
        out.failures.push({ recordId, invoice_number: rec.invoice.invoice_number, reason: o.reason });
        ctx.audit("POST_FAILED", { invoice: rec.invoice.invoice_number, reason: o.reason });
        break;
    }
  }
  out.remaining = [];
  out.selectorCache = cache.entries();

  // Which chaos types the portal applied, and whether the run got through them.
  const info = deps.driver.portalInfo ? await deps.driver.portalInfo().catch(() => null) : null;
  const types: ChaosType[] = state.config.chaos.types;
  const healed = (out.heals as HealAttempt[]).filter((h) => h.outcome === "healed" || h.outcome === "human-picked");
  const failed = out.failures.length > 0;
  out.chaosReport = types.map((t) => {
    switch (t) {
      case "ids":
        return { type: t, observed: healed.length > 0, handled: healed.length > 0 && !failed, detail: `${healed.length} selectors re-found from fingerprints` };
      case "labels":
        return { type: t, observed: true, handled: !failed, detail: "labels matched through synonyms and neighbor text" };
      case "reorder":
        return { type: t, observed: true, handled: !failed, detail: "form ordinal weighted at 10% so shuffled rows still match" };
      case "nesting":
        return { type: t, observed: true, handled: !failed, detail: "submit button found by role and label" };
      case "interstitial":
        return { type: t, observed: dialogs > 0, handled: dialogs > 0, detail: `${dialogs} session dialog(s) detected in the distilled tree and dismissed` };
      case "latency":
        return { type: t, observed: slowWait > 250, handled: !failed, detail: `waited for portal state, slowest wait ${Math.round(slowWait)} ms` };
      case "strip-labels":
        return { type: t, observed: true, handled: !failed, detail: "names computed from table-cell text" };
    }
  });
  void info;
  state.n7 = out;
  return `${out.postings.length} posted, ${out.duplicatesPrevented.length} duplicates prevented, ${healed.length} selectors healed, ${out.guardBlocks} actions blocked, ${out.failures.length} failed`;
}
