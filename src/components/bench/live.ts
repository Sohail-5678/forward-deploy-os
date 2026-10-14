"use client";
import { useEffect, useRef, useState } from "react";
import { useConsole } from "@/components/console/context";
import { RESULTS } from "@/lib/results";
import type { SuiteId, SuiteResult } from "@/engine/evals/types";
import type { WorkerStream } from "@/lib/worker-protocol";
import { canonicalJSON } from "@/engine/hash";

export const LIVE_SUITES: SuiteId[] = ["drift", "dates", "invariants", "calibration", "injection", "guard"];

export function matchesCommitted(r: SuiteResult): boolean {
  const committed = RESULTS.suites[r.id as SuiteId];
  return !!committed && canonicalJSON(committed.metrics) === canonicalJSON(r.metrics) && committed.cases === r.cases;
}

/** Runs suites in the engine worker; the worker only starts when a run is requested. */
export function useLiveBench() {
  const c = useConsole();
  const [progress, setProgress] = useState<{ suite?: SuiteId; done: number; total: number } | null>(null);
  const [results, setResults] = useState<Record<string, SuiteResult>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  useEffect(() => () => unsub.current?.(), []);
  const run = async (suites: SuiteId[]) => {
    setRunning(true);
    setResults({});
    setError(null);
    unsub.current?.();
    unsub.current = c.onStream((m: WorkerStream) => {
      if (m.type === "progress" && m.channel === "bench") setProgress({ suite: m.suite, done: m.done, total: m.total });
      if (m.type === "bench-suite") setResults((r) => ({ ...r, [m.result.id]: m.result }));
    });
    try {
      await c.request({ type: "bench", suites });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };
  return { progress, results, running, error, run };
}
