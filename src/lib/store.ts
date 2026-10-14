"use client";
import { useCallback, useRef, useSyncExternalStore } from "react";

/** A tiny external store with selector subscriptions (no extra dependency). */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S, equal: (a: S, b: S) => boolean = shallowEqual): S {
  const cache = useRef<{ state: T; value: S } | null>(null);
  const get = useCallback(() => {
    const state = store.get();
    if (cache.current && cache.current.state === state) return cache.current.value;
    const value = selector(state);
    if (cache.current && equal(cache.current.value, value)) {
      cache.current = { state, value: cache.current.value };
      return cache.current.value;
    }
    cache.current = { state, value };
    return value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}
