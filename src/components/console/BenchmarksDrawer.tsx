"use client";
import Link from "next/link";
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { Drawer } from "@/components/ui/primitives";
import { headlineTiles, StatTile } from "@/components/bench/BenchTiles";
import { RESULTS } from "@/lib/results";
import { LIVE_SUITES, matchesCommitted, useLiveBench } from "@/components/bench/live";

export function BenchmarksDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { progress, results, running, run } = useLiveBench();
  return (
    <Drawer open={open} onClose={onClose} title="Benchmarks" width="max-w-[720px]">
      <p className="text-[13px] text-ink-2">
        Every number comes from <code className="font-mono text-agent">benchmarks/results.json</code> (produced by <code className="font-mono">npm run bench</code>, seed {RESULTS.seed}) or from a live run in this browser.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {headlineTiles().map((t) => (
          <StatTile key={t.id} tile={t} compact />
        ))}
      </div>
      <div className="mt-5 rounded-2xl border border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Re-run live in your browser</h3>
          <button type="button" className="btn btn-cyan btn-sm" onClick={() => void run(LIVE_SUITES)} disabled={running}>
            {running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCcw size={14} aria-hidden="true" />} {running ? "Running…" : "Re-run live"}
          </button>
        </div>
        <p className="mt-1 text-[12px] text-ink-3">Runs the deterministic suites in the engine Web Worker with the same seeds and checks them against the committed file. DOM suites run on the full benchmarks page.</p>
        {progress && (
          <div className="mt-3">
            <div className="flex justify-between font-mono text-[11px] text-ink-2">
              <span>{progress.suite}</span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-agent transition-[width] duration-150" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
        )}
        <ul className="mt-3 space-y-1.5">
          {LIVE_SUITES.map((id) => {
            const r = results[id];
            return (
              <li key={id} className="flex items-center justify-between text-[12.5px]">
                <span className="font-mono text-ink">{id}</span>
                {r ? (
                  matchesCommitted(r) ? (
                    <span className="chip chip-ok">
                      <CheckCircle2 size={11} aria-hidden="true" /> matches committed results · {Math.round(r.ms)} ms
                    </span>
                  ) : (
                    <span className="chip chip-danger">
                      <XCircle size={11} aria-hidden="true" /> differs from committed results
                    </span>
                  )
                ) : (
                  <span className="text-ink-3">{running ? "queued" : "not run"}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Link href="/benchmarks" className="btn btn-glass btn-sm mt-4">
        Open the full benchmark report
      </Link>
    </Drawer>
  );
}
