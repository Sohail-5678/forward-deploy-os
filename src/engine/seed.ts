/**
 * Seeded randomness (rule S5). Every generator, chaos mutation and benchmark
 * takes a seed; the same seed always produces the same output.
 */

export interface Rng {
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  bool(probability?: number): boolean;
  /** Independent child stream; the label keeps streams stable when code is reordered. */
  fork(label: string): Rng;
}

/** FNV-1a 32-bit hash, used to derive seeds from strings. */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  // mulberry32: small, fast, good enough statistical quality for test data.
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed: seed >>> 0,
    next,
    int(min, max) {
      if (max < min) throw new Error("Rng.int: max < min");
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("Rng.pick: empty list");
      return items[Math.floor(next() * items.length)];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
    fork(label) {
      return createRng(seedFromString(`${seed >>> 0}:${label}`));
    },
  };
  return rng;
}
