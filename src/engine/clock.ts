/**
 * Time sources. `now()` is a monotonic millisecond clock for measured
 * durations (rule T2 shows real timings). `Clock` gives ISO timestamps for
 * audit entries; tests and benchmarks inject a fixed clock so results stay
 * reproducible (rule S5).
 */

export function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export interface Clock {
  iso(): string;
}

export const systemClock: Clock = {
  iso: () => new Date().toISOString(),
};

/** Deterministic clock: starts at `start` and advances one second per call. */
export function fixedClock(start = "2026-10-14T09:00:00.000Z"): Clock {
  let t = Date.parse(start);
  return {
    iso() {
      const out = new Date(t).toISOString();
      t += 1000;
      return out;
    },
  };
}
