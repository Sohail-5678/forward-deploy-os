"use client";
import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { ConsoleContext } from "@/components/console/context";
import { createConsole, useControllerLifetime } from "@/lib/console-store";
import { RESULTS } from "@/lib/results";
import type { SuiteId } from "@/engine/evals/types";
import { matchesCommitted, useLiveBench } from "./live";

const SUITES: { id: SuiteId; title: string }[] = [
  { id: "drift", title: "Schema drift healing" },
  { id: "dates", title: "Ambiguous dates" },
  { id: "invariants", title: "Invariants" },
  { id: "calibration", title: "Calibration" },
  { id: "injection", title: "Injection detection" },
  { id: "guard", title: "Guard" },
  { id: "latency", title: "Node latency (this browser)" },
];

/** Re-runs the deterministic suites in this browser and checks them against the committed file. */
export function LiveRerun() {
  const [c] = useState(() => createConsole());
  useControllerLifetime(c, true);
  return (
    <ConsoleContext.Provider value={c}>
      <LiveRerunPanel />
    </ConsoleContext.Provider>
  );
}

function LiveRerunPanel() {
  const { progress, results, running, error, run } = useLiveBench();
  const latency = results.latency;
  const lt = latency?.timing ?? {};
  return (
    <div className="glass glass-strong glass-rim rounded-[22px] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">Re-run live in your browser</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">Same seeds, same code, in a Web Worker. DOM suites need the jsdom harness: run them with npm run bench.</p>
        </div>
        <button type="button" className="btn btn-cyan" onClick={() => void run(SUITES.map((s) => s.id))} disabled={running}>
          {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCcw size={15} aria-hidden="true" />} {running ? "Running…" : "Re-run live"}
        </button>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Benchmark progress" aria-valuemin={0} aria-valuemax={progress?.total ?? 1} aria-valuenow={progress?.done ?? 0}>
        <div className="h-full rounded-full bg-agent transition-[width] duration-150" style={{ width: progress ? `${(progress.done / Math.max(1, progress.total)) * 100}%` : running ? "4%" : "0%" }} />
      </div>
      <p className="mt-1 h-4 font-mono text-[11px] text-ink-3" aria-live="polite">
        {progress ? `${progress.suite}: ${progress.done}/${progress.total}` : ""}
      </p>
      {error && (
        <p className="mt-2 text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-2 divide-y divide-line">
        {SUITES.map((s) => {
          const r = results[s.id];
          const committed = RESULTS.suites[s.id];
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <span className="text-ink">
                {s.title} <span className="font-mono text-[11px] text-ink-3">{committed?.cases ?? "?"} cases</span>
              </span>
              {!r ? (
                <span className="text-ink-3">{running ? "queued" : "not run"}</span>
              ) : s.id === "latency" ? (
                <span className="chip chip-agent">measured · {Math.round(r.ms)} ms</span>
              ) : matchesCommitted(r) ? (
                <span className="chip chip-ok">
                  <CheckCircle2 size={11} aria-hidden="true" /> identical to committed · {Math.round(r.ms)} ms
                </span>
              ) : (
                <span className="chip chip-danger">
                  <XCircle size={11} aria-hidden="true" /> differs from committed
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {latency && (
        <div className="mt-4">
          <h3 className="eyebrow">Your browser: nodes 1 to 5, 100-row batch</h3>
          <table className="mt-2 w-full text-left font-mono text-[12px]">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 font-semibold">Node</th>
                <th className="py-1 font-semibold">p50</th>
                <th className="py-1 font-semibold">p95</th>
                <th className="py-1 font-semibold">100-row p95</th>
                <th className="py-1 font-semibold">Target</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((n) => {
                const p95 = lt[`batch100Node${n}P95Ms`];
                return (
                  <tr key={n} className="border-t border-line">
                    <td className="py-1 text-ink">{n}</td>
                    <td className="py-1 text-ink-2">{fmt(lt[`node${n}P50Ms`])}</td>
                    <td className="py-1 text-ink-2">{fmt(lt[`node${n}P95Ms`])}</td>
                    <td className="py-1 text-ink">{fmt(p95)}</td>
                    <td className="py-1">{p95 === undefined ? "–" : p95 < 50 ? <span className="text-ok">MET</span> : <span className="text-danger">MISSED</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmt(v: number | undefined) {
  return v === undefined ? "–" : `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms`;
}
