/**
 * Small SVG charts for the benchmark report. Each chart is paired with a text
 * table (spec 14.8: every chart has a text alternative), and colors always
 * come with a legend word.
 */
import { cn } from "@/lib/cn";

export interface ReliabilityBin {
  bin: number;
  predicted: number;
  observed: number;
  count: number;
}

export interface TradeoffPoint {
  threshold: number;
  autoPostRate: number;
  errorRate: number;
  autoPosted: number;
  wrong: number;
}

const W = 360;
const H = 260;
const PAD = { l: 40, r: 14, t: 14, b: 34 };
const x = (v: number) => PAD.l + v * (W - PAD.l - PAD.r);
const y = (v: number) => H - PAD.b - v * (H - PAD.t - PAD.b);

function Axes({ xLabel, yLabel }: { xLabel: string; yLabel: string }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g className="text-[9px]" fill="var(--text-3)">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
            {t.toFixed(2)}
          </text>
          <text x={x(t)} y={H - PAD.b + 13} textAnchor="middle">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={(x(0) + x(1)) / 2} y={H - 4} textAnchor="middle" fill="var(--text-2)">
        {xLabel}
      </text>
      <text x={10} y={(y(0) + y(1)) / 2} textAnchor="middle" fill="var(--text-2)" transform={`rotate(-90 10 ${(y(0) + y(1)) / 2})`}>
        {yLabel}
      </text>
    </g>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" stroke={i.color} strokeWidth="2.5" strokeDasharray={i.dashed ? "4 3" : undefined} />
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Predicted probability vs observed frequency, calibrated vs uncalibrated. */
export function ReliabilityDiagram({ calibrated, baseline }: { calibrated: ReliabilityBin[]; baseline: ReliabilityBin[] }) {
  const pts = (bins: ReliabilityBin[]) =>
    bins
      .filter((b) => b.count > 0)
      .map((b) => `${x(b.predicted)},${y(b.observed)}`)
      .join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reliability diagram: predicted probability against observed frequency for the calibrated model and the uncalibrated baseline">
        <Axes xLabel="predicted probability safe" yLabel="observed frequency safe" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--text-3)" strokeDasharray="3 4" />
        <polyline points={pts(baseline)} fill="none" stroke="var(--warn)" strokeWidth="2" strokeDasharray="5 4" />
        <polyline points={pts(calibrated)} fill="none" stroke="var(--agent)" strokeWidth="2.4" />
        {calibrated
          .filter((b) => b.count > 0)
          .map((b) => (
            <circle key={b.bin} cx={x(b.predicted)} cy={y(b.observed)} r={2 + Math.min(5, Math.sqrt(b.count) / 2)} fill="var(--agent)" fillOpacity="0.85" />
          ))}
      </svg>
      <Legend
        items={[
          { label: "Calibrated logistic model", color: "var(--agent)" },
          { label: "Uncalibrated heuristic", color: "var(--warn)", dashed: true },
          { label: "Perfect calibration", color: "var(--text-3)", dashed: true },
        ]}
      />
    </figure>
  );
}

/** Auto-post rate and error rate as the confidence threshold moves. */
export function TradeoffCurve({ points, current }: { points: TradeoffPoint[]; current?: number }) {
  const ts = points.map((p) => p.threshold);
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  const tx = (t: number) => (max === min ? 0 : (t - min) / (max - min));
  const line = (key: "autoPostRate" | "errorRate") => points.map((p) => `${x(tx(p.threshold))},${y(p[key])}`).join(" ");
  // Greedy label thinning: keep a tick label only if it clears the previous one.
  const labelled: TradeoffPoint[] = [];
  for (const p of points) {
    const last = labelled[labelled.length - 1];
    if (!last || x(tx(p.threshold)) - x(tx(last.threshold)) >= 28) labelled.push(p);
  }
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Threshold trade-off: auto-post rate and error rate at each confidence threshold">
        <g className="text-[9px]" fill="var(--text-3)">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {labelled.map((p) => (
            <text key={p.threshold} x={x(tx(p.threshold))} y={H - PAD.b + 13} textAnchor="middle">
              {p.threshold.toFixed(2)}
            </text>
          ))}
          <text x={(x(0) + x(1)) / 2} y={H - 4} textAnchor="middle" fill="var(--text-2)">
            confidence threshold
          </text>
        </g>
        {current !== undefined && current >= min && current <= max && <line x1={x(tx(current))} x2={x(tx(current))} y1={y(0)} y2={y(1)} stroke="var(--amethyst-300)" strokeDasharray="2 3" />}
        <polyline points={line("autoPostRate")} fill="none" stroke="var(--agent)" strokeWidth="2.4" />
        <polyline points={line("errorRate")} fill="none" stroke="var(--danger)" strokeWidth="2.2" strokeDasharray="5 3" />
      </svg>
      <Legend
        items={[
          { label: "Auto-post rate", color: "var(--agent)" },
          { label: "Error rate among auto-posted", color: "var(--danger)", dashed: true },
          ...(current !== undefined ? [{ label: `Default threshold ${current.toFixed(2)}`, color: "var(--amethyst-300)", dashed: true }] : []),
        ]}
      />
    </figure>
  );
}

/** Horizontal bars for rates in [0, 1]. */
export function RateBars({ rows, tone = "agent" }: { rows: { label: string; value: number; note?: string }[]; tone?: "agent" | "ok" | "violet" }) {
  return (
    <ul className="space-y-1.5" role="list">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
          <span className="truncate font-mono text-ink-2" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
            <span className={cn("block h-full rounded-full", tone === "ok" ? "bg-ok" : tone === "violet" ? "bg-lilac" : "bg-agent")} style={{ width: `${Math.max(0, Math.min(1, r.value)) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular text-ink">
            {(r.value * 100).toFixed(1).replace(/\.0$/, "")}%{r.note ? <span className="text-ink-3"> {r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line scroll-thin" tabIndex={0} role="region" aria-label={caption ?? head.join(", ")}>
      <table className="w-full text-left text-[12.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-ink-3">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-1.5", j === 0 ? "font-mono text-ink" : "font-mono tabular text-ink-2")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
