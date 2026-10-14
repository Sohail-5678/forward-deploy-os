import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/landing/SiteChrome";
import { StatTile } from "@/components/bench/BenchTiles";
import { DataTable, RateBars, ReliabilityDiagram, TradeoffCurve, type ReliabilityBin, type TradeoffPoint } from "@/components/bench/Charts";
import { LiveRerun } from "@/components/bench/LiveRerun";
import { headlineTiles } from "@/lib/tiles";
import { RESULTS, pct } from "@/lib/results";
import { revealInline } from "@/engine/security/normalize";
import { DEFAULT_POLICY } from "@/engine/config";
import type { SuiteId } from "@/engine/evals/types";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Benchmarks",
  description: "Seeded benchmark suites for schema healing, calibration, DOM distillation, selector healing, prompt-injection detection, the action guard, idempotency and latency. Every number is re-runnable.",
};

type Rec = Record<string, unknown>;
const M = (id: SuiteId) => (RESULTS.suites[id]?.metrics ?? {}) as Rec;
const T = (id: SuiteId) => (RESULTS.suites[id]?.timing ?? {}) as Record<string, number>;
const ms = (v: number | undefined) => (v === undefined ? "n/a" : `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`);
const r2 = (v: unknown) => (typeof v === "number" ? v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "n/a");

function Suite({ id, title, children, baseline }: { id: SuiteId; title: string; children: React.ReactNode; baseline?: string }) {
  const s = RESULTS.suites[id];
  return (
    <section id={id} className="panel scroll-mt-28 p-6" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="display text-[30px] text-ink">
          {title}
        </h2>
        <span className="font-mono text-[11.5px] text-ink-3">
          {s?.cases ?? "?"} cases · seed {s?.seed ?? "?"} · {s?.environment ?? "?"}
          {baseline ? ` · baseline: ${baseline}` : ""}
        </span>
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
          <dt className="text-[13px] text-ink-2">{k}</dt>
          <dd className="font-mono text-[13px] tabular text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function BenchmarksPage() {
  const drift = M("drift");
  const dates = M("dates");
  const inv = M("invariants");
  const cal = M("calibration");
  const dis = M("distillation");
  const sel = M("selectors");
  const inj = M("injection");
  const guard = M("guard");
  const idem = M("idempotency");
  const lat = T("latency");
  const reliability = (cal.reliability ?? []) as ReliabilityBin[];
  const baseRel = (cal.baselineReliability ?? []) as ReliabilityBin[];
  const tradeoff = (cal.tradeoff ?? []) as TradeoffPoint[];
  const perType = (sel.perType ?? {}) as Record<string, { healRate: number; humanEscalationRate: number; failRate: number; wrongElementRate: number; baselineSuccessRate: number }>;
  const pages = (dis.portalPages ?? {}) as Record<string, { rawTokens: number; distilledTokens: number; ratio: number; minRatio?: number }>;
  const fixtures = (dis.fixtures ?? {}) as Record<string, { title: string; rawTokens: number; distilledTokens: number; ratio: number; nodes: number }>;
  const misses = (inj.exampleMisses ?? []) as string[];

  return (
    <div className="relative min-h-dvh bg-bg">
      <div className="nebula" aria-hidden="true" />
      <SiteNav current="benchmarks" />
      <main className="relative z-10 mx-auto max-w-[1180px] px-5 pb-24 pt-32">
        <p className="eyebrow">Benchmarks</p>
        <h1 className="display mt-4 text-[clamp(42px,6vw,84px)] leading-[0.95] text-ink">
          Every number, <span className="iridescent italic">and how it was measured.</span>
        </h1>
        <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-ink-2">
          Generated {new Date(RESULTS.generatedAt).toUTCString()} with seed {RESULTS.seed} on {RESULTS.environment.runtime}, {RESULTS.environment.platform}. {RESULTS.environment.note}. Misses are shown as misses.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="grid gap-4 sm:grid-cols-2">
            {headlineTiles().map((t) => (
              <StatTile key={t.id} tile={t} compact />
            ))}
          </div>
          <LiveRerun />
        </div>

        <section className="panel mt-8 p-6" aria-labelledby="budgets-title">
          <h2 id="budgets-title" className="display text-[30px] text-ink">
            Budgets
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">Targets, not claims. A missed target stays visible here.</p>
          <ul className="mt-4 divide-y divide-line">
            {RESULTS.budgets.map((b) => (
              <li key={b.item} className="grid gap-2 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center">
                <span className="text-ink">{b.item}</span>
                <span className="text-ink-2">{b.target}</span>
                <span className="font-mono text-ink">{b.measured}</span>
                <span className="flex items-center gap-2">
                  {b.met === true ? (
                    <span className="chip chip-ok">
                      <CheckCircle2 size={11} aria-hidden="true" /> MET
                    </span>
                  ) : b.met === false ? (
                    <span className="chip chip-danger">
                      <XCircle size={11} aria-hidden="true" /> MISSED
                    </span>
                  ) : (
                    <span className="chip">
                      <CircleDashed size={11} aria-hidden="true" /> NOT MEASURED HERE
                    </span>
                  )}
                  <span className="text-[11.5px] text-ink-3">{b.source}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8 grid gap-6">
          <Suite id="drift" title="Schema drift healing" baseline={RESULTS.suites.drift?.baseline}>
            <Kv
              rows={[
                ["Field mapping accuracy", pct(drift.fieldMappingAccuracy as number)],
                ["Exact-name baseline", pct(drift.baselineFieldMappingAccuracy as number)],
                ["Full-file heal rate", pct(drift.fullFileHealRate as number)],
                ["Baseline full-file heal rate", pct(drift.baselineFullFileHealRate as number)],
                ["McNemar χ² (paired, per file)", r2((drift.mcnemar as Rec | undefined)?.chi2)],
                ["McNemar p-value", (drift.mcnemar as Rec | undefined)?.pValue === 0 ? "< 1e-6" : r2((drift.mcnemar as Rec | undefined)?.pValue)],
              ]}
            />
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="eyebrow mb-2">Accuracy per contract field</h3>
                <RateBars rows={Object.entries((drift.perField ?? {}) as Record<string, number>).map(([k, v]) => ({ label: k, value: v }))} />
              </div>
              <div>
                <h3 className="eyebrow mb-2">Full-file heal rate by difficulty</h3>
                <RateBars tone="violet" rows={Object.entries((drift.byDifficulty ?? {}) as Record<string, { files: number; healRate: number }>).map(([k, v]) => ({ label: `${k} (${v.files} files)`, value: v.healRate }))} />
                <p className="mt-3 text-[12.5px] text-ink-2">
                  A file counts as healed only if every field maps correctly and all invariants pass. Weakest fields:{" "}
                  {Object.entries((drift.perField ?? {}) as Record<string, number>)
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, 2)
                    .map(([k, v]) => `${k} (${pct(v)})`)
                    .join(" and ")}
                  .
                </p>
              </div>
            </div>
          </Suite>

          <Suite id="dates" title="Ambiguous dates">
            <Kv
              rows={[
                ["Ambiguous files correctly escalated", pct(dates.correctlyEscalatedRate as number)],
                ["Guessed instead of escalating", String(dates.guessed ?? "n/a")],
                ["Decidable control files read correctly", pct(dates.decidableControlsCorrect as number)],
                ["False escalations on decidable files", String(dates.falseEscalations ?? "n/a")],
              ]}
            />
          </Suite>

          <Suite id="invariants" title="Invariant gate">
            <DataTable
              caption="Planted bugs and detection"
              head={["Planted bug", "Files", "Detected", "Caught by the expected invariant"]}
              rows={Object.entries((inv.perBug ?? {}) as Record<string, { planted: number; detectionRate: number; caughtByExpectedInvariant: number }>).map(([k, v]) => [k, v.planted, pct(v.detectionRate), pct(v.caughtByExpectedInvariant)])}
            />
            <p className="text-[13px] text-ink-2">False alarms on clean files: {String(inv.cleanFileFalseAlarms ?? "n/a")}.</p>
          </Suite>

          <Suite id="calibration" title="Reconciliation and calibration" baseline={RESULTS.suites.calibration?.baseline}>
            <Kv
              rows={[
                ["Brier score (held-out)", r2(cal.brier)],
                ["Expected calibration error", r2(cal.ece)],
                ["Baseline Brier", r2(cal.baselineBrier)],
                ["Baseline ECE", r2(cal.baselineEce)],
                ["Trained on / held out", `${cal.trainedOn ?? "?"} / ${cal.heldOut ?? "?"}`],
                ["Safe fraction in the set", pct(cal.safeFraction as number)],
              ]}
            />
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="eyebrow mb-2">Reliability diagram</h3>
                <ReliabilityDiagram calibrated={reliability} baseline={baseRel} />
              </div>
              <div>
                <h3 className="eyebrow mb-2">Threshold trade-off</h3>
                <TradeoffCurve points={tradeoff} current={DEFAULT_POLICY.confidenceThreshold} />
              </div>
            </div>
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-ink">Show the charts as tables</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <DataTable caption="Reliability bins" head={["Bin", "Predicted", "Observed", "Count"]} rows={reliability.map((b) => [b.bin, b.predicted.toFixed(3), b.observed.toFixed(3), b.count])} />
                <DataTable caption="Threshold trade-off" head={["Threshold", "Auto-post", "Error", "Wrong / posted"]} rows={tradeoff.map((p) => [p.threshold.toFixed(2), pct(p.autoPostRate), pct(p.errorRate), `${p.wrong} / ${p.autoPosted}`])} />
              </div>
            </details>
            <p className="text-[12.5px] text-ink-2">Calibration only ranks the cases that pass hard policy. A record that breaks a policy rule goes to a person whatever its confidence (rule S3).</p>
          </Suite>

          <Suite id="distillation" title="DOM distillation" baseline={RESULTS.suites.distillation?.baseline}>
            <DataTable
              caption="Portal pages"
              head={["Page", "Raw HTML tokens", "Distilled tokens", "Ratio (median)", "Worst chaos seed"]}
              rows={Object.entries(pages).map(([k, v]) => [k, v.rawTokens, v.distilledTokens, `${v.ratio}x`, v.minRatio !== undefined ? `${v.minRatio}x` : "–"])}
            />
            <DataTable caption="Large fixture pages" head={["Fixture", "Raw", "Distilled", "Ratio", "Nodes"]} rows={Object.values(fixtures).map((f) => [f.title, f.rawTokens, f.distilledTokens, `${f.ratio}x`, f.nodes])} />
            <Kv
              rows={[
                ["Task success acting only on the distilled tree", `${pct(dis.taskSuccessRate as number)} of ${dis.tasks ?? "?"} tasks`],
                ["Tokenizer", String(dis.tokenizer ?? "n/a")],
                ["Distillation p50 / p95 (jsdom in Node)", `${ms(T("distillation").distillP50Ms)} / ${ms(T("distillation").distillP95Ms)}`],
              ]}
            />
          </Suite>

          <Suite id="selectors" title="Selector healing" baseline={RESULTS.suites.selectors?.baseline}>
            <DataTable
              caption="Per chaos type"
              head={["Chaos type", "Healed", "Asked a human", "Failed", "Wrong element", "Recorded-selector baseline"]}
              rows={Object.entries(perType).map(([k, v]) => [k, pct(v.healRate), pct(v.humanEscalationRate), pct(v.failRate), pct(v.wrongElementRate), pct(v.baselineSuccessRate)])}
            />
            <p className="text-[12.5px] text-ink-2">
              Auto-heal at similarity ≥ {String((sel.thresholds as Rec | undefined)?.heal ?? "?")} with a margin of {String((sel.thresholds as Rec | undefined)?.minMargin ?? "?")} over the runner-up; ask a person between {String((sel.thresholds as Rec | undefined)?.ask ?? "?")} and that. Heal p50 / p95: {ms(T("selectors").healP50Ms)} / {ms(T("selectors").healP95Ms)}. A wrong-element action is the failure that matters, and it must stay at zero.
            </p>
          </Suite>

          <Suite id="injection" title="Prompt-injection detection">
            <Kv
              rows={[
                ["Detection rate", `${pct(inj.detectionRate as number)} of ${inj.attacks ?? "?"} attacks`],
                ["False-positive rate", `${pct(inj.falsePositiveRate as number)} of ${inj.benign ?? "?"} benign documents`],
              ]}
            />
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="eyebrow mb-2">Detection by technique</h3>
                <RateBars tone="violet" rows={Object.entries((inj.perTechnique ?? {}) as Record<string, number>).map(([k, v]) => ({ label: k, value: v }))} />
              </div>
              <div>
                <h3 className="eyebrow mb-2">Examples it misses</h3>
                <ul className="space-y-1.5">
                  {misses.slice(0, 6).map((m, i) => (
                    <li key={i} className="rounded-lg border border-line bg-[var(--surface-0)] px-3 py-1.5 font-mono text-[11px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
                      {revealInline(m).slice(0, 180)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-ink-3">The scanner is one layer. These misses still cannot move money: value binding and the guard stop them (next suite).</p>
              </div>
            </div>
          </Suite>

          <Suite id="guard" title="Tool boundary guard">
            <Kv
              rows={[
                ["Malicious plans blocked", `${pct(guard.blockedRate as number)} of ${guard.maliciousPlans ?? "?"}`],
                ["Legitimate actions allowed", `${pct(guard.legitimateAllowedRate as number)} of ${guard.legitimateActions ?? "?"}`],
              ]}
            />
            <RateBars tone="ok" rows={Object.entries((guard.perType ?? {}) as Record<string, number>).map(([k, v]) => ({ label: k, value: v }))} />
          </Suite>

          <Suite id="idempotency" title="Idempotency">
            <Kv
              rows={[
                ["Batches replayed", String(idem.batches ?? "n/a")],
                ["Records posted on the first pass", String(idem.postedFirstPass ?? "n/a")],
                ["Duplicates prevented on replay", String(idem.duplicatesPrevented ?? "n/a")],
                ["Duplicate postings", String(idem.duplicatePostings ?? "n/a")],
              ]}
            />
          </Suite>

          <Suite id="latency" title="Node latency">
            <DataTable
              caption="Latency per node"
              head={["Node", "p50", "p95", "100-row batch p95", "Target (p95, 100 rows)"]}
              rows={[1, 2, 3, 4, 5].map((n) => {
                const b = lat[`batch100Node${n}P95Ms`];
                return [n, ms(lat[`node${n}P50Ms`]), ms(lat[`node${n}P95Ms`]), ms(b), b === undefined ? "–" : b < 50 ? "under 50 ms: met" : "under 50 ms: MISSED"];
              })}
            />
            <p className={cn("text-[12.5px] text-ink-2")}>Measured in {RESULTS.suites.latency?.environment === "browser" ? "a browser" : "Node"} when the file was generated. Use “Re-run live” above to measure your own browser.</p>
          </Suite>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
