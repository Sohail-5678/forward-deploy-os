"use client";
import type { FieldAgreement, Reconciliation } from "@/engine/types";
import { FIELD_LABELS } from "@/engine/etl/contract";
import { formatIban } from "@/engine/iban";
import { formatPct, formatRate, formatUsd } from "@/engine/format";
import { cn } from "@/lib/cn";
import { AlertTriangle } from "lucide-react";

function show(f: FieldAgreement, v: string | number | undefined): string {
  if (v === undefined) return "—";
  switch (f.field) {
    case "gross_amount_usd":
      return formatUsd(Number(v));
    case "tax_rate":
      return formatRate(Number(v));
    case "payee_iban":
      return formatIban(String(v));
    default:
      return String(v);
  }
}

export function ThreeWayDiff({ rec, compact = false }: { rec: Reconciliation; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full border-collapse text-[12px]">
        <caption className="sr-only">Three-way comparison of PDF, CSV and ERP for {rec.invoice_number}</caption>
        <thead className="bg-[var(--surface-1)]">
          <tr className="text-left">
            <th className="px-3 py-2 font-semibold text-ink-3">Field</th>
            <th className="px-3 py-2 font-semibold text-ink-3">PDF invoice</th>
            <th className="px-3 py-2 font-semibold text-ink-3">CSV (healed)</th>
            <th className="px-3 py-2 font-semibold text-ink-3">ERP / vendor master</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rec.fields.map((f) => {
            const values = [f.pdf, f.csv, f.erp];
            const baseline = f.erp ?? f.csv ?? f.pdf;
            return (
              <tr key={f.field} className={cn("border-t border-white/[0.04]", !f.agree && "bg-[color-mix(in_oklab,var(--warn)_7%,transparent)]")}>
                <td className="px-3 py-1.5 font-sans text-ink-2">
                  {FIELD_LABELS[f.field]}
                  {!f.agree && <AlertTriangle size={11} className="ml-1 inline text-warn" aria-label="disagreement" />}
                </td>
                {values.map((v, i) => {
                  const differs = v !== undefined && baseline !== undefined && v !== baseline;
                  return (
                    <td key={i} className={cn("px-3 py-1.5", v === undefined ? "text-ink-3" : f.agree ? "text-ink-2" : differs || (i === 2 && !f.agree) ? "font-semibold text-warn" : "text-ink")}>
                      {show(f, v)}
                      {f.field === "gross_amount_usd" && i !== 2 && f.erp !== undefined && v !== undefined && Number(v) !== Number(f.erp) && (
                        <span className="ml-1.5 rounded-full bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] px-1.5 py-0.5 text-[10.5px] text-warn">
                          {formatUsd(Number(v) - Number(f.erp), { sign: true })}, {formatPct(Math.abs(Number(v) - Number(f.erp)) / Number(f.erp))}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!compact && rec.surcharges.length > 0 && (
        <div className="border-t border-line bg-[color-mix(in_oklab,var(--danger)_7%,transparent)] px-3 py-2 text-[12px] text-ink">
          <span className="font-semibold text-danger">PDF line not on the PO: </span>
          {rec.surcharges.map((s) => `${s.label} ${formatUsd(s.cents)}`).join("; ")}
        </div>
      )}
    </div>
  );
}
