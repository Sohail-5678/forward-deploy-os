"use client";
import { useState } from "react";
import { BadgeCheck, Hammer, Link2, RotateCcw, ScrollText, User } from "lucide-react";
import { useConsoleState } from "../context";
import { verifyAuditChain, type ChainVerdict } from "@/engine/agent/audit";
import type { AuditEntry } from "@/engine/types";
import { EmptyState, StatusChip } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export function AuditView() {
  const audit = useConsoleState((s) => s.graph?.audit ?? []);
  const summary = useConsoleState((s) => s.graph?.n8?.summary);
  const [local, setLocal] = useState<AuditEntry[] | null>(null);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const entries = local ?? audit;

  if (audit.length === 0) {
    return (
      <EmptyState icon={<ScrollText size={28} />} title="Tamper-evident audit log">
        Every quarantine, mapping, escalation, human decision and posting is appended to a hash chain: each entry hashes the previous one, so editing any entry breaks every link after it.
      </EmptyState>
    );
  }

  const tamper = () => {
    const copy = structuredClone(audit);
    const idx = copy.findIndex((e) => e.kind === "POSTED" || e.kind === "HUMAN_DECISION");
    const i = idx >= 0 ? idx : Math.floor(copy.length / 2);
    copy[i] = { ...copy[i], data: { ...(copy[i].data as object), tampered: "amount changed after the fact" } };
    setLocal(copy);
    setVerdict(verifyAuditChain(copy));
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <ol className="min-h-0 overflow-auto rounded-xl border border-line scroll-thin" aria-label="Audit hash chain">
        {entries.map((e, i) => {
          const broken = verdict && !verdict.valid && verdict.brokenAt !== undefined && i >= verdict.brokenAt;
          return (
            <li key={e.seq} className={cn("relative border-b border-white/[0.04] py-2 pl-10 pr-3", broken && "bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]")}>
              <span className={cn("absolute left-4 top-0 h-full w-px", broken ? "bg-danger/60" : "bg-[var(--amethyst-500)]/40")} aria-hidden="true" />
              <span className={cn("absolute left-[11px] top-3 h-[11px] w-[11px] rounded-full border-2", broken ? "border-danger bg-danger/30" : "border-lilac bg-[var(--surface-1)]")} aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-ink-3">#{e.seq}</span>
                <span className="text-[12.5px] font-semibold text-ink">{e.kind}</span>
                <span className={cn("chip", e.actor.startsWith("human:") ? "chip-violet" : "")}>
                  {e.actor.startsWith("human:") ? <User size={10} aria-hidden="true" /> : null}
                  {e.actor}
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-ink-3">{e.at.slice(11, 19)}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-2">{JSON.stringify(e.data).slice(0, 180)}</div>
              <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ink-3">
                <Link2 size={10} aria-hidden="true" /> {e.prevHash.slice(0, 10)} → <span className={broken ? "text-danger" : "text-agent"}>{e.hash.slice(0, 10)}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <aside className="flex flex-col gap-3">
        <div className="rounded-xl border border-line p-3">
          <h3 className="eyebrow mb-2">Verify the chain</h3>
          <p className="text-[12px] text-ink-2">hash = sha256(prevHash + canonicalJSON(entry without hash)). Recomputed here in your browser.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-cyan btn-sm" onClick={() => setVerdict(verifyAuditChain(entries))}>
              <BadgeCheck size={14} aria-hidden="true" /> Verify chain
            </button>
            <button type="button" className="btn btn-glass btn-sm" onClick={tamper}>
              <Hammer size={14} aria-hidden="true" /> Tamper with an entry
            </button>
            {local && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setLocal(null), setVerdict(null))}>
                <RotateCcw size={14} aria-hidden="true" /> Restore
              </button>
            )}
          </div>
          {verdict && (
            <div className={cn("mt-3 rounded-lg border p-2.5 text-[12.5px]", verdict.valid ? "border-ok/50 text-ok" : "border-danger/60 text-danger")} role="status">
              {verdict.valid ? (
                <>
                  <StatusChip status="passed" word="CHAIN VALID" /> <span className="ml-1">{verdict.checked} entries verified.</span>
                </>
              ) : (
                <>
                  <StatusChip status="failed" word="CHAIN BROKEN" /> <span className="ml-1">First broken link: entry #{verdict.brokenAt} ({verdict.reason}).</span>
                </>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-ink-3">This is tamper evidence, not a signature: operator names are typed text recorded in the chain.</p>
        </div>
        {summary && (
          <div className="rounded-xl border border-line p-3">
            <h3 className="eyebrow mb-2">Run summary</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              {(
                [
                  ["Invoices in", summary.recordsIn],
                  ["Rows promoted", summary.recordsPromoted],
                  ["Posted", summary.recordsPosted],
                  ["Duplicates prevented", summary.duplicatesPrevented],
                  ["Escalations", summary.escalations],
                  ["Human decisions", summary.decisions],
                  ["Docs quarantined", summary.quarantinedDocs],
                  ["Selectors healed", summary.selectorsHealed],
                  ["Guard blocks", summary.guardBlocks],
                  ["Unknown-account payments", summary.paymentsToUnknownAccounts],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="text-right font-mono tabular text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </aside>
    </div>
  );
}
