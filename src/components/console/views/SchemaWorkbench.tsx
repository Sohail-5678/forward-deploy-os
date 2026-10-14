"use client";
import { useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Download, FlaskConical, Hash, Loader2, Sparkles, XCircle } from "lucide-react";
import { useConsole, useConsoleState } from "../context";
import { ofType } from "@/lib/derive";
import { parseCsv, parseJsonTable } from "@/engine/etl/csv";
import { downloadHealed, downloadSpec } from "@/lib/exports";
import { describeRecipe } from "@/engine/etl/schema-healer";
import type { DriftError, FieldMapping, InvariantResult } from "@/engine/types";
import { EmptyState, StatusChip } from "@/components/ui/primitives";
import { formatMs } from "@/engine/format";
import { cn } from "@/lib/cn";

const ROW_LIMIT = 8;

export function SchemaWorkbench() {
  const c = useConsole();
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const graph = useConsoleState((s) => s.graph);
  const fuzz = useConsoleState((s) => s.fuzz);
  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);
  const files = graph?.input.files ?? [];
  const [fileId, setFileId] = useState<string | undefined>(undefined);
  const active = files.find((f) => f.id === fileId) ?? files[0];

  const drift = useMemo(() => ofType(shown, "DRIFT_DETECTED").find((e) => e.payload.fileId === active?.id)?.payload, [shown, active]);
  const quarantined = useMemo(() => {
    const ev = ofType(shown, "ROWS_QUARANTINED").filter((e) => e.payload.fileId === active?.id);
    const last = ev[ev.length - 1];
    return new Map((last?.payload.rows ?? []).map((r) => [r.rowIndex, r]));
  }, [shown, active]);
  const mapping = useMemo(() => ofType(shown, "MAPPING_SYNTHESIZED").filter((e) => e.payload.fileId === active?.id).pop()?.payload, [shown, active]);
  const invariants: InvariantResult[] = useMemo(() => ofType(shown, "INVARIANT_RESULT").filter((e) => e.payload.fileId === active?.id).map((e) => e.payload.result).slice(-5), [shown, active]);
  const promoted = useMemo(() => ofType(shown, "ROWS_PROMOTED").filter((e) => e.payload.fileId === active?.id).pop()?.payload.count, [shown, active]);
  const table = useMemo(() => (active ? (active.kind === "json" ? parseJsonTable(active.text, active.id) : parseCsv(active.text, active.id)) : null), [active]);
  const healResult = graph?.n3?.files.find((f) => f.fileId === active?.id);

  if (!active || !table) {
    return (
      <EmptyState icon={<Sparkles size={28} />} title="Schema workbench">
        Pick a scenario and press Run. Drifted vendor exports appear here with their drift errors, the synthesized mapping and the invariant checks that prove it safe.
      </EmptyState>
    );
  }

  const errorsByColumn = new Map<string, DriftError[]>();
  for (const e of drift?.errors ?? []) if (e.column) errorsByColumn.set(e.column, [...(errorsByColumn.get(e.column) ?? []), e]);
  const codes = [...new Set((drift?.errors ?? []).map((e) => e.code))];

  const onDownloadHealed = () => graph && downloadHealed(graph, active.id);
  const onDownloadSpec = () => graph && downloadSpec(graph, active.id);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {files.length > 1 &&
          files.map((f) => (
            <button key={f.id} type="button" onClick={() => setFileId(f.id)} className={cn("chip", f.id === active.id && "chip-agent")}>
              {f.name}
            </button>
          ))}
        {files.length === 1 && <span className="font-mono text-[12px] text-ink-2">{active.name}</span>}
        <span className="font-mono text-[11px] text-ink-3">
          {table.rows.length} rows · {table.headers.length} columns · delimiter {JSON.stringify(table.delimiter)}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {codes.map((code) => (
            <span key={code} className="chip chip-danger" title={`${(drift?.errors ?? []).filter((e) => e.code === code).length} occurrences`}>
              <XCircle size={11} aria-hidden="true" /> {code}
            </span>
          ))}
          {drift && codes.length === 0 && <StatusChip status="passed" word="NO DRIFT" />}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        {/* Left: the drifted file */}
        <section className="min-h-0 overflow-hidden rounded-xl border border-line bg-[var(--surface-0)]/60" aria-label="Drifted file">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h3 className="eyebrow">Drifted file</h3>
            <span className="text-[11px] text-ink-3">{quarantined.size ? `${quarantined.size} quarantined` : drift ? "all rows valid" : "waiting for node 2"}</span>
          </div>
          <div className="max-h-full overflow-auto scroll-thin">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead className="sticky top-0 bg-[var(--surface-1)]">
                <tr>
                  <th className="px-2 py-1.5 text-left text-ink-3">#</th>
                  {table.headers.map((h) => {
                    const errs = errorsByColumn.get(h);
                    return (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-ink">
                        <span className="mr-1">{h}</span>
                        {errs && (
                          <span className="chip chip-danger h-[18px] px-1.5 text-[9px]" title={errs.map((e) => `${e.code}${e.sample ? ` (e.g. ${e.sample})` : ""}`).join("\n")}>
                            DRIFT
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, ROW_LIMIT).map((row, i) => {
                  const q = quarantined.get(i);
                  return (
                    <tr key={i} className={cn("border-t border-white/[0.04]", q && "bg-[color-mix(in_oklab,var(--danger)_6%,transparent)]")}>
                      <td className="px-2 py-1 text-ink-3">
                        {q ? (
                          <span className="inline-flex items-center gap-1 text-danger" title={q.reasons.join("\n")}>
                            <Hash size={10} aria-hidden="true" />
                            {q.sha256.slice(0, 6)}
                          </span>
                        ) : (
                          i + 1
                        )}
                      </td>
                      {table.headers.map((h) => (
                        <td key={h} className="max-w-[160px] truncate whitespace-nowrap px-2 py-1 text-ink-2" title={row[h]}>
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {table.rows.length > ROW_LIMIT && <p className="px-3 py-2 text-[11px] text-ink-3">+ {table.rows.length - ROW_LIMIT} more rows</p>}
          </div>
        </section>

        {/* Center: mapping curves */}
        <section className="min-h-0 overflow-auto rounded-xl border border-line bg-[var(--surface-0)]/60 scroll-thin" aria-label="Column mapping">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h3 className="eyebrow">Declarative mapping</h3>
            {mapping && <span className="font-mono text-[10.5px] text-ink-3">spec {mapping.specId.slice(0, 10)}</span>}
          </div>
          {mapping ? <MappingCurves key={mapping.specId} mappings={mapping.mappings} unmappedTarget={mapping.unmappedTarget} unmappedSource={mapping.unmappedSource} targets={graph?.config.contract.fields.map((f) => f.key) ?? []} /> : <p className="p-4 text-[12px] text-ink-3">Waiting for node 3 to synthesize a TransformSpec.</p>}
          {mapping?.dateDecision?.status === "ambiguous" && (
            <div className="mx-3 mb-3 rounded-xl border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] p-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-warn">
                <CalendarClock size={14} aria-hidden="true" /> Ambiguous dates: not guessing
              </div>
              <p className="mt-1 text-[12px] text-ink-2">{mapping.dateDecision.reason}.</p>
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                {(["DD/MM/YYYY", "MM/DD/YYYY"] as const).map((fmt) => (
                  <div key={fmt} className="rounded-lg border border-line p-2">
                    <div className="text-ink-3">Read as {fmt.slice(0, 5)}</div>
                    <div className="text-ink">{mapping.dateDecision!.samples[0]} → {readAs(mapping.dateDecision!.samples[0], fmt)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-3">Recommended: ask the customer. The rows stay quarantined until a human decides at node 5.</p>
            </div>
          )}
        </section>

        {/* Right: invariants + fuzz */}
        <section className="flex min-h-0 flex-col gap-3 overflow-auto scroll-thin" aria-label="Invariant gate">
          <div className="rounded-xl border border-line bg-[var(--surface-0)]/60">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <h3 className="eyebrow">Invariant gate</h3>
              <span className="font-mono text-[11px] text-ink-3">{invariants.length ? `${invariants.filter((i) => i.passed).length}/5 passed` : "5 checks"}</span>
            </div>
            <ol className="divide-y divide-white/[0.04]">
              {invariants.map((inv, i) => (
                <li key={inv.name} className="fade-up px-3 py-2" style={{ ["--delay" as string]: `${i * 40}ms` }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11.5px] font-semibold text-ink">{inv.name}</span>
                    <StatusChip status={inv.passed ? "passed" : "failed"} />
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-2">{inv.detail}</p>
                  <p className="font-mono text-[10px] text-ink-3">{formatMs(inv.ms)}</p>
                </li>
              ))}
              {invariants.length === 0 && <li className="px-3 py-4 text-[12px] text-ink-3">Row count, money sum, primary keys, date window and idempotency are checked on the whole batch before any row leaves quarantine.</li>}
            </ol>
            {promoted !== undefined && (
              <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-ok">
                <CheckCircle2 size={14} aria-hidden="true" /> {promoted} rows promoted
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-[var(--surface-0)]/60 p-3">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">Property test</h3>
              <span className="text-[10.5px] text-ink-3">fast-check, in your browser</span>
            </div>
            <p className="mt-1 text-[12px] text-ink-2">Generate 300 random records, render them in the formats this spec claims to read, heal them back, and require an exact round trip with every invariant passing.</p>
            <button type="button" className="btn btn-amethyst btn-sm mt-2 w-full" disabled={!healResult || fuzz?.running} onClick={() => healResult && void c.fuzz(healResult.fileId)}>
              {fuzz?.running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={14} aria-hidden="true" />}
              {fuzz?.running ? `Fuzzing ${fuzz.done}/${fuzz.total}` : "Fuzz this transform"}
            </button>
            {fuzz?.result && (
              <div className="mt-2 rounded-lg border border-line p-2 font-mono text-[11px]">
                {fuzz.result.failed ? (
                  <>
                    <div className="text-danger">Counterexample after {fuzz.result.counterexample?.shrinks ?? 0} shrinks</div>
                    <div className="mt-1 break-all text-ink-2">{fuzz.result.counterexample?.error}</div>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-ink-3 scroll-thin">{JSON.stringify(fuzz.result.counterexample?.row, null, 1)}</pre>
                  </>
                ) : (
                  <div className="text-ok">
                    {fuzz.result.passed}/{fuzz.result.numRuns} cases passed in {formatMs(fuzz.result.ms)} · seed {fuzz.result.seed}
                  </div>
                )}
              </div>
            )}
            {fuzz?.error && <p className="mt-2 text-[12px] text-danger">{fuzz.error}</p>}
          </div>

          {healResult && (
            <div className="flex gap-2">
              <button type="button" className="btn btn-glass btn-xs flex-1" onClick={onDownloadHealed} disabled={!healResult.promoted.length}>
                <Download size={12} aria-hidden="true" /> Healed CSV
              </button>
              <button type="button" className="btn btn-glass btn-xs flex-1" onClick={onDownloadSpec}>
                <Download size={12} aria-hidden="true" /> TransformSpec JSON
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function readAs(v: string, fmt: "DD/MM/YYYY" | "MM/DD/YYYY"): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!m) return v;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [d, mo] = fmt === "DD/MM/YYYY" ? [+m[1], +m[2]] : [+m[2], +m[1]];
  return `${d} ${months[mo - 1]} ${m[3]}`;
}

/** SVG Bezier curves from source columns to target fields, drawn in on reveal. */
function MappingCurves({ mappings, unmappedTarget, unmappedSource, targets }: { mappings: FieldMapping[]; unmappedTarget: string[]; unmappedSource: string[]; targets: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const sources = [...mappings.map((m) => m.source), ...unmappedSource];
  const rowH = 30;
  const height = Math.max(sources.length, targets.length) * rowH + 16;
  const width = 360;
  const leftX = 128;
  const rightX = width - 128;
  const ref = useRef<SVGSVGElement>(null);
  const yOf = (i: number) => 16 + i * rowH;
  return (
    <div className="p-2">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width="100%" className="overflow-visible" role="img" aria-label={`${mappings.length} source columns mapped to target fields`}>
        <defs>
          <linearGradient id="curve-grad" x1="0" x2="1">
            <stop offset="0" stopColor="var(--amethyst-300)" />
            <stop offset="1" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        {sources.map((s, i) => (
          <text key={s} x={leftX - 8} y={yOf(i) + 4} textAnchor="end" className={cn("font-mono text-[10.5px]", unmappedSource.includes(s) ? "fill-[var(--text-3)]" : "fill-[var(--text-1)]")}>
            {s.length > 18 ? s.slice(0, 17) + "…" : s}
          </text>
        ))}
        {targets.map((t, i) => (
          <text key={t} x={rightX + 8} y={yOf(i) + 4} className={cn("font-mono text-[10.5px]", unmappedTarget.includes(t) ? "fill-[var(--danger)]" : "fill-[var(--text-1)]")}>
            {t}
            {unmappedTarget.includes(t) ? " ✕" : ""}
          </text>
        ))}
        {mappings.map((m, i) => {
          const si = sources.indexOf(m.source);
          const ti = targets.indexOf(m.target);
          if (ti < 0) return null;
          const y1 = yOf(si);
          const y2 = yOf(ti);
          const d = `M ${leftX} ${y1} C ${leftX + 70} ${y1}, ${rightX - 70} ${y2}, ${rightX} ${y2}`;
          const midX = (leftX + rightX) / 2;
          const midY = (y1 + y2) / 2;
          const strong = m.score >= 0.75;
          return (
            <g key={m.target} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} role="button" aria-label={`${describeRecipe(m)}, score ${m.score.toFixed(2)}`}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
              <path
                d={d}
                fill="none"
                stroke={hover === i ? "var(--cyan)" : "url(#curve-grad)"}
                strokeWidth={hover === i ? 2.4 : 1.6}
                strokeOpacity={hover === null || hover === i ? (strong ? 0.95 : 0.6) : 0.18}
                className="draw-in"
                style={{ ["--len" as string]: 420, ["--delay" as string]: `${i * 90}ms`, filter: hover === i ? "drop-shadow(0 0 6px var(--cyan))" : undefined }}
              />
              <circle cx={leftX} cy={y1} r={2.6} fill="var(--amethyst-300)" />
              <circle cx={rightX} cy={y2} r={2.6} fill="var(--cyan)" />
              <g transform={`translate(${midX - 17}, ${midY - 8})`} className="fade-up" style={{ ["--delay" as string]: `${i * 90 + 300}ms` }}>
                <rect width={34} height={16} rx={8} fill="var(--surface-2)" stroke={strong ? "color-mix(in oklab, var(--ok) 60%, transparent)" : "color-mix(in oklab, var(--warn) 60%, transparent)"} />
                <text x={17} y={11.5} textAnchor="middle" className="font-mono text-[9.5px] fill-[var(--text-1)]">
                  {m.score.toFixed(2)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      <div className="min-h-[64px] rounded-lg border border-line bg-[var(--surface-1)]/60 px-3 py-2 font-mono text-[11px]">
        {hover !== null && mappings[hover] ? (
          <>
            <div className="text-ink">{describeRecipe(mappings[hover])}</div>
            <div className="mt-1 text-ink-2">{mappings[hover].evidence.join(" · ") || "matched by value fingerprint"}</div>
            <div className="mt-1 truncate text-ink-3">samples: {mappings[hover].evidenceSamples.join(" | ")}</div>
            <div className="mt-0.5 text-ink-3">
              name {mappings[hover].nameScore.toFixed(2)} · values {mappings[hover].valueScore.toFixed(2)} · distribution {mappings[hover].distScore.toFixed(2)} · by {mappings[hover].proposedBy}
            </div>
          </>
        ) : (
          <span className="text-ink-3">Hover a curve to see the recipe and the sampled values that justified it. Score = 0.45 name + 0.45 values + 0.10 distribution; below 0.55 stays unmapped.</span>
        )}
      </div>
    </div>
  );
}
