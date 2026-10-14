"use client";
import { useMemo, useState } from "react";
import { ClipboardList, Scale } from "lucide-react";
import { useConsoleState } from "../context";
import { ofType } from "@/lib/derive";
import { EmptyState, StatusChip } from "@/components/ui/primitives";
import { ThreeWayDiff } from "./ThreeWayDiff";
import { describeHit } from "@/engine/agent/policy";
import { formatPct, formatUsd } from "@/engine/format";
import { cn } from "@/lib/cn";

export function ReconcileView() {
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const graph = useConsoleState((s) => s.graph);
  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);
  const reconciled = useMemo(() => ofType(shown, "RECONCILED").map((e) => e.payload), [shown]);
  const [sel, setSel] = useState<string | null>(null);
  const recs = graph?.n4?.reconciliations ?? [];
  const policy = graph?.config.policy;
  const visibleIds = new Set(reconciled.map((r) => r.recordId));
  const rows = recs.filter((r) => visibleIds.has(r.recordId));
  const selected = rows.find((r) => r.recordId === sel) ?? rows.find((r) => r.policyHits.length) ?? rows[0];
  const n5 = graph?.n5;
  const n5Revealed = shown.some((e) => e.node === 5 && e.type === "NODE_FINISHED");

  if (rows.length === 0) {
    return (
      <EmptyState icon={<Scale size={28} />} title="Cross-document reconciler">
        Each invoice is compared three ways: the PDF, the healed CSV row and the ERP purchase order. Hard policy rules decide first; calibrated confidence second.
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="max-h-[300px] shrink-0 overflow-auto rounded-xl border border-line scroll-thin">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-[var(--surface-1)] text-left">
              <tr>
                <th className="px-3 py-2 text-ink-3">Invoice</th>
                <th className="px-3 py-2 text-ink-3">Source</th>
                <th className="px-3 py-2 text-ink-3">Agree</th>
                <th className="px-3 py-2 text-ink-3">Confidence</th>
                <th className="px-3 py-2 text-ink-3">Policy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ev = reconciled.find((x) => x.recordId === r.recordId)!;
                return (
                  <tr key={r.recordId} onClick={() => setSel(r.recordId)} className={cn("fade-up cursor-pointer border-t border-white/[0.04] hover:bg-white/[0.03]", selected?.recordId === r.recordId && "bg-white/[0.05]")} style={{ ["--delay" as string]: `${i * 30}ms` }}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-ink">{r.invoice_number}</td>
                    <td className="px-3 py-1.5 text-ink-2">{r.source.toUpperCase()}</td>
                    <td className="px-3 py-1.5 font-mono text-ink-2 tabular">
                      {ev.agree}/{ev.total}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                          <div className={cn("h-full rounded-full", r.confidence >= (policy?.confidenceThreshold ?? 0.85) ? "bg-ok" : "bg-warn")} style={{ width: `${r.confidence * 100}%` }} />
                        </div>
                        <span className="font-mono tabular text-ink">{r.confidence.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.policyHits.length === 0 ? (
                        <StatusChip status="passed" word="CLEAN" />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {[...new Set(r.policyHits.map((h) => h.rule))].map((rule) => (
                            <span key={rule} className={cn("chip", rule === "LOW_CONFIDENCE" ? "chip-warn" : "chip-danger")}>
                              {rule}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected && (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="display text-[22px] text-ink">{selected.invoice_number}</h3>
              <span className="text-[12px] text-ink-3">
                {selected.vendor_id} · {selected.po_number}
              </span>
              {selected.policyHits.map((h, i) => (
                <span key={i} className="text-[12px] text-warn">
                  {describeHit(h)}
                </span>
              ))}
            </div>
            <ThreeWayDiff rec={selected} />
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        <div className="rounded-xl border border-line p-3">
          <h3 className="eyebrow">Policy (rule S3: policy beats confidence)</h3>
          {policy && (
            <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
              <li>Amount differs by more than {formatUsd(policy.absToleranceCents)} → human</li>
              <li>Amount differs by more than {formatPct(policy.relTolerance)} → human</li>
              <li>Payee not in vendor master, unknown vendor, security finding → human</li>
              <li>Calibrated confidence below {policy.confidenceThreshold.toFixed(2)} → human</li>
            </ul>
          )}
        </div>
        {n5 && n5Revealed && (
          <>
            <div className="rounded-xl border border-line p-3">
              <h3 className="eyebrow">Approved for posting</h3>
              <ul className="mt-2 space-y-1 font-mono text-[12px]">
                {n5.approved.map((a) => (
                  <li key={a.recordId} className="flex items-center justify-between gap-2">
                    <span className="text-ink">{a.invoice.invoice_number}</span>
                    <span className="text-ink-2 tabular">{formatUsd(a.invoice.gross_amount_cents)}</span>
                    <span className={cn("chip", a.approval === "human" ? "chip-violet" : "chip-ok")}>{a.approval === "human" ? "HUMAN" : "AUTO"}</span>
                  </li>
                ))}
                {n5.approved.length === 0 && <li className="text-ink-3">None yet.</li>}
              </ul>
              {n5.approved.some((a) => a.shortPayNote) && <p className="mt-2 text-[11.5px] text-ink-2">{n5.approved.find((a) => a.shortPayNote)?.shortPayNote}</p>}
            </div>
            <div className="rounded-xl border border-line p-3">
              <h3 className="eyebrow flex items-center gap-1.5">
                <ClipboardList size={12} aria-hidden="true" /> Manual audit queue
              </h3>
              <ul className="mt-2 space-y-1.5 text-[12px]">
                {n5.manualAudit.map((m) => (
                  <li key={m.recordId}>
                    <span className="font-mono text-ink">{m.invoice_number}</span>
                    <span className="block text-ink-3">{m.reason}</span>
                  </li>
                ))}
                {n5.rejected.map((m) => (
                  <li key={m.recordId}>
                    <span className="font-mono text-danger">{m.invoice_number} (rejected)</span>
                    <span className="block text-ink-3">{m.reason}</span>
                  </li>
                ))}
                {n5.manualAudit.length + n5.rejected.length === 0 && <li className="text-ink-3">Empty.</li>}
              </ul>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
