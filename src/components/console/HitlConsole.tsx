"use client";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarClock, Copy, Hammer, Loader2, MessageSquare, MousePointerClick, RotateCcw, Send, ShieldAlert, User } from "lucide-react";
import { useConsole, useConsoleState } from "./context";
import { Gauge, Kbd } from "@/components/ui/primitives";
import { ThreeWayDiff } from "./views/ThreeWayDiff";
import { describeHit } from "@/engine/agent/policy";
import type { DecisionChoice, Escalation, HumanDecision, Reconciliation } from "@/engine/types";
import { vendorName } from "@/engine/data/scenarios";
import { formatUsd } from "@/engine/format";
import { notifySlack } from "@/lib/api";
import { cn } from "@/lib/cn";

function blockKit(rec: Reconciliation, runId: string, siteUrl: string, scenario: number | "sandbox") {
  const delta = rec.erp ? rec.invoice.gross_amount_cents - rec.erp.authorized_cents : undefined;
  return {
    text: `Human decision needed: ${rec.invoice_number} (${vendorName(rec.vendor_id)})`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Run paused: human decision needed" } },
      { type: "section", text: { type: "mrkdwn", text: `*${rec.invoice_number}* from *${vendorName(rec.vendor_id)}*\nInvoice ${formatUsd(rec.invoice.gross_amount_cents)}${rec.erp ? ` vs PO ${formatUsd(rec.erp.authorized_cents)} (${formatUsd(delta!, { sign: true })})` : ""}` } },
      { type: "section", fields: [{ type: "mrkdwn", text: `*Policy rules hit*\n${[...new Set(rec.policyHits.map((h) => `\`${h.rule}\``))].join(" ")}` }, { type: "mrkdwn", text: `*Calibrated confidence*\n${rec.confidence.toFixed(2)}` }] },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in console" }, url: `${siteUrl}/console?scenario=${scenario}&step=5`, style: "primary" }] },
    ],
  };
}

function SlackPreview({ rec }: { rec: Reconciliation }) {
  const runId = useConsoleState((s) => s.runId ?? "");
  const scenario = useConsoleState((s) => s.scenario);
  const slackOn = useConsoleState((s) => s.health?.slack);
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const kit = useMemo(() => blockKit(rec, runId, typeof window !== "undefined" ? window.location.origin : "", scenario), [rec, runId, scenario]);
  const copy = () => void navigator.clipboard?.writeText(JSON.stringify(kit, null, 2)).catch(() => undefined);
  const send = async () => {
    setState("sending");
    try {
      await notifySlack({ runId, scenarioId: scenario, invoiceNumber: rec.invoice_number, vendorName: vendorName(rec.vendor_id), amountCents: rec.invoice.gross_amount_cents, poAmountCents: rec.erp?.authorized_cents, rules: [...new Set(rec.policyHits.map((h) => h.rule))], confidence: rec.confidence });
      setState("sent");
    } catch (e) {
      setState(e instanceof Error ? e.message : "failed");
    }
  };
  return (
    <div className="rounded-xl border border-line bg-[#1a1d21] p-3 text-[12.5px] text-[#d1d2d3]">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[var(--amethyst-500)] to-[var(--amethyst)] text-[11px] font-bold text-white">FD</span>
        <div>
          <div className="text-[13px] font-bold text-white">
            ForwardDeploy OS <span className="ml-1 rounded bg-white/10 px-1 text-[10px] font-semibold">APP</span>
          </div>
          <div className="text-[11px] text-[#9a9b9d]">#ap-escalations · preview</div>
        </div>
      </div>
      <div className="border-l-4 border-[var(--amethyst-500)] pl-3">
        <div className="font-bold text-white">Run paused: human decision needed</div>
        <div className="mt-1">
          <b className="text-white">{rec.invoice_number}</b> from <b className="text-white">{vendorName(rec.vendor_id)}</b>
        </div>
        <div>
          Invoice {formatUsd(rec.invoice.gross_amount_cents)}
          {rec.erp && ` vs PO ${formatUsd(rec.erp.authorized_cents)}`}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {[...new Set(rec.policyHits.map((h) => h.rule))].map((r) => (
            <code key={r} className="rounded bg-white/10 px-1 text-[11px] text-[#e8912d]">
              {r}
            </code>
          ))}
          <span className="text-[#9a9b9d]">confidence {rec.confidence.toFixed(2)}</span>
        </div>
        <span className="mt-2 inline-block rounded border border-[#007a5a] bg-[#007a5a] px-2 py-0.5 text-[12px] font-bold text-white">Open in console</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button type="button" className="btn btn-ghost btn-xs" onClick={copy}>
          <Copy size={12} aria-hidden="true" /> Copy Block Kit JSON
        </button>
        {slackOn && (
          <button type="button" className="btn btn-glass btn-xs" onClick={() => void send()} disabled={state === "sending" || state === "sent"}>
            <Send size={12} aria-hidden="true" /> {state === "sent" ? "Sent to Slack" : state === "sending" ? "Sending…" : "Send to Slack"}
          </button>
        )}
      </div>
      {state !== "idle" && state !== "sending" && state !== "sent" && <p className="mt-1 text-[11px] text-danger">{state}</p>}
    </div>
  );
}

const CHOICE_TONE: Partial<Record<DecisionChoice, string>> = {
  ENFORCE_PO: "from-[#0c3b46] to-[#082730] border-agent/60",
  APPROVE_OVERRIDE: "from-[#3a1d63] to-[#1f0d3b] border-violet/70",
  MANUAL_AUDIT: "from-[#2a2416] to-[#17140c] border-warn/60",
  ASK_CUSTOMER: "from-[#0c3b46] to-[#082730] border-agent/60",
};

export function HitlConsole() {
  const c = useConsole();
  const sus = useConsoleState((s) => s.suspension);
  const graph = useConsoleState((s) => s.graph);
  const director = useConsoleState((s) => s.director);
  const demoChoices = useConsoleState((s) => s.demoChoices);
  // Only show the card once playback has revealed the suspension (scrubbing back hides it).
  const suspendedOnScreen = useConsoleState((s) => {
    let susp = -1;
    let res = -1;
    for (let i = 0; i < s.revealed; i++) {
      const t = s.events[i]?.type;
      if (t === "RUN_SUSPENDED") susp = i;
      else if (t === "RUN_RESUMED") res = i;
    }
    return susp > res;
  });
  const operatorSaved = useConsoleState((s) => s.operator);
  const [operator, setOperator] = useState(operatorSaved);
  const [note, setNote] = useState("");
  // Choices belong to one checkpoint: a new suspension starts with a clean slate.
  const ck = sus?.checkpoint.id;
  const [local, setLocal] = useState<{ ck?: string; choices: Record<string, DecisionChoice>; tab: number }>({ choices: {}, tab: 0 });
  const choices = local.ck === ck ? local.choices : {};
  const tab = local.ck === ck ? local.tab : 0;
  const setChoices = (fn: (cs: Record<string, DecisionChoice>) => Record<string, DecisionChoice>) => setLocal((l) => ({ ck, choices: fn(l.ck === ck ? l.choices : {}), tab: l.ck === ck ? l.tab : 0 }));
  const setTab = (t: number) => setLocal((l) => ({ ck, choices: l.ck === ck ? l.choices : {}, tab: t }));
  const pending: Escalation[] = useMemo(() => sus?.checkpoint.state.pending ?? [], [sus]);
  const demoTab = Math.max(0, pending.findIndex((p) => !demoChoices[p.id]));
  const esc = pending[Math.min(director ? (pending.every((p) => demoChoices[p.id]) ? pending.length - 1 : demoTab) : tab, pending.length - 1)];
  const shownChoices = director ? demoChoices : choices;

  useEffect(() => {
    if (!esc || director) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const opt = esc.options.find((o) => o.shortcut === e.key);
      if (opt) setLocal((l) => ({ ck, choices: { ...(l.ck === ck ? l.choices : {}), [esc.id]: opt.choice }, tab: l.ck === ck ? l.tab : 0 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [esc, director, ck]);

  if (!sus || !graph || !esc || !suspendedOnScreen) return null;
  const rec = esc.kind === "POLICY" ? sus.checkpoint.state.n4?.reconciliations.find((r) => r.recordId === esc.recordId) : undefined;
  const allChosen = pending.every((p) => choices[p.id]);
  const op = operator.trim();
  const busy = sus.status === "verifying" || sus.status === "signing";

  const submit = async () => {
    if (!allChosen || !op) return;
    c.setOperator(op);
    const at = new Date().toISOString();
    const ds: HumanDecision[] = pending.map((p) => ({ escalationId: p.id, choice: choices[p.id], operator: op, note: note.trim() || undefined, at }));
    await c.decide(ds);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto p-4 pt-[7vh]" role="dialog" aria-modal="true" aria-labelledby="hitl-title">
      <div className="absolute inset-0 bg-[#050505]/60 backdrop-blur-[2px] [animation:fade-in_200ms_ease]" aria-hidden="true" />
      <div className="glass glass-strong glass-rim relative w-full max-w-[1040px] rounded-[26px] p-5 shadow-[0_0_120px_-30px_rgba(0,229,255,0.35)] [animation:dialog-in_260ms_var(--ease-out)]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="eyebrow flex items-center gap-2 text-warn!">
              <ShieldAlert size={13} aria-hidden="true" /> Run paused at node {graph.cursor}
              {director && <span className="chip chip-violet tracking-normal normal-case">Scripted demo operator</span>}
            </div>
            <h2 id="hitl-title" className="display mt-1 text-[38px] leading-[1.02] text-ink">
              Human decision <span className="iridescent italic">needed</span>
            </h2>
            {pending.length > 1 && (
              <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Escalations">
                {pending.map((p, i) => (
                  <button key={p.id} type="button" role="tab" aria-selected={p.id === esc.id} onClick={() => setTab(i)} disabled={director} className={cn("chip", p.id === esc.id && "chip-agent", shownChoices[p.id] && "chip-ok")}>
                    {i + 1}. {p.kind === "POLICY" ? p.invoice_number : p.kind === "AMBIGUOUS_DATE" ? `dates in ${p.fileName}` : "selector"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {esc.kind === "POLICY" && <Gauge value={esc.confidence} threshold={graph.config.policy.confidenceThreshold} size={92} />}
          <div className="flex flex-col items-end gap-1">
            {sus.status === "signing" && (
              <span className="chip">
                <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Signing checkpoint…
              </span>
            )}
            {sus.signature && (
              <span className={cn("chip", sus.tampered ? "chip-danger" : "chip-ok")} title={`HMAC-SHA256 ${sus.signature}`}>
                <BadgeCheck size={11} aria-hidden="true" /> {sus.tampered ? "Modified after signing" : "Verified checkpoint"} · {sus.checkpoint.stateSha256.slice(0, 10)}
              </span>
            )}
            {sus.secretMode === "ephemeral-dev" && <span className="text-[10.5px] text-ink-3">development signing key</span>}
          </div>
        </div>

        {sus.status === "sign-failed" && (
          <div className="mt-3 rounded-xl border border-danger/60 bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] p-3 text-[12.5px] text-danger">
            The server could not sign this checkpoint, so the run cannot resume: {sus.signError}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            {esc.kind === "POLICY" && rec && (
              <>
                <ul className="flex flex-wrap gap-1.5">
                  {esc.hits.map((h, i) => (
                    <li key={i} className={cn("chip", h.rule === "LOW_CONFIDENCE" ? "chip-warn" : "chip-danger")} title={describeHit(h)}>
                      {h.rule}
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-ink-2">{esc.hits.map(describeHit).join(". ")}.</p>
                <ThreeWayDiff rec={rec} />
              </>
            )}
            {esc.kind === "AMBIGUOUS_DATE" && (
              <div className="rounded-xl border border-warn/40 p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-warn">
                  <CalendarClock size={15} aria-hidden="true" /> {esc.fileName}: column <code className="font-mono">{esc.column}</code>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2">Every date has both parts at or below 12, so day-first and month-first are both valid. The engine does not guess. {esc.affectedRows.length} rows wait in quarantine.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {esc.interpretations.map((it) => (
                    <div key={it.format} className="rounded-xl border border-line bg-[var(--surface-0)]/70 p-3">
                      <div className="text-[11px] text-ink-3">Read as {it.format.slice(0, 5)}</div>
                      <div className="font-mono text-[13px] text-ink">{it.example}</div>
                      <div className="display text-[22px] text-lilac">{it.reading}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 font-mono text-[11px] text-ink-3">samples: {esc.samples.join(", ")}</p>
              </div>
            )}
            {esc.kind === "SELECTOR_CONFIRM" && (
              <div className="rounded-xl border border-agent/40 p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-agent">
                  <MousePointerClick size={15} aria-hidden="true" /> Which field is <code className="font-mono">{esc.targetKey.split(":")[1]}</code> now?
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2">The best match healed between 0.60 and 0.80 similarity. The agent never clicks a guess, so it asks.</p>
                <ol className="mt-2 space-y-1.5">
                  {esc.candidates.map((cand, i) => (
                    <li key={cand.selector} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 font-mono text-[12px]">
                      <span className="text-ink">
                        {i + 1}. &quot;{cand.label}&quot;
                      </span>
                      <span className="text-ink-3">{cand.selector.slice(0, 26)}</span>
                      <span className="text-agent">{cand.similarity.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {rec && <SlackPreview rec={rec} />}
          </div>

          <div className="space-y-3">
            <div role="radiogroup" aria-label="Decision" className="space-y-2">
              {esc.options.map((o) => {
                const on = shownChoices[esc.id] === o.choice;
                return (
                  <button
                    key={o.choice}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setChoices((cs) => ({ ...cs, [esc.id]: o.choice }))}
                    disabled={busy || director}
                    className={cn(
                      "w-full rounded-2xl border bg-gradient-to-br p-3.5 text-left transition-[transform,box-shadow,border-color] duration-150 active:scale-[0.985]",
                      CHOICE_TONE[o.choice] ?? "from-white/[0.05] to-white/[0.01] border-line-strong",
                      on ? "shadow-[0_0_0_2px_var(--agent),0_0_40px_-10px_var(--agent)]" : "opacity-90 hover:opacity-100",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-semibold text-ink">{o.label}</span>
                      <Kbd>{o.shortcut}</Kbd>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-2">{o.description}</div>
                    {o.recommended && <div className="mt-1 text-[10.5px] font-bold tracking-wider text-agent">RECOMMENDED</div>}
                  </button>
                );
              })}
            </div>
            <div>
              <label htmlFor="operator" className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                <User size={12} aria-hidden="true" /> Operator name (recorded in the audit chain)
              </label>
              <input id="operator" value={director ? (graph.config.demoOperator ?? "Demo operator") : operator} onChange={(e) => setOperator(e.target.value)} maxLength={60} placeholder="Your name" className="h-10 w-full rounded-xl border border-line-strong bg-[var(--surface-0)] px-3 text-[13px] text-ink placeholder:text-ink-3" disabled={director} />
            </div>
            <div>
              <label htmlFor="note" className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                <MessageSquare size={12} aria-hidden="true" /> Note (optional)
              </label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="w-full rounded-xl border border-line-strong bg-[var(--surface-0)] p-2.5 text-[13px] text-ink" disabled={director} />
            </div>
            {sus.verifyError && <p className="rounded-xl border border-danger/60 bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] p-2.5 text-[12.5px] text-danger" role="alert">{sus.verifyError}</p>}
            <button type="button" className="btn btn-cyan w-full" onClick={() => void submit()} disabled={!allChosen || !op || busy || !sus.signature || director}>
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={15} aria-hidden="true" />}
              {director ? "Demo operator is deciding…" : pending.length > 1 && !allChosen ? `Decide all ${pending.length} to continue` : "Verify checkpoint and resume"}
            </button>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
              {!sus.tampered ? (
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => c.tamper()} disabled={!sus.signature || busy || director} title="Edit the stored state after it was signed; the server should reject the resume">
                  <Hammer size={12} aria-hidden="true" /> Tamper with this checkpoint
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => c.restoreCheckpoint()}>
                  <RotateCcw size={12} aria-hidden="true" /> Restore the signed state
                </button>
              )}
              <span>The server recomputes the state hash and checks the HMAC before the run resumes.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
