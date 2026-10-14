"use client";
import { createContext, useContext } from "react";
import type { ConsoleController, ConsoleState } from "@/lib/console-store";
import { useStore } from "@/lib/store";

export const ConsoleContext = createContext<ConsoleController | null>(null);

export function useConsole(): ConsoleController {
  const c = useContext(ConsoleContext);
  if (!c) throw new Error("useConsole must be used inside <ConsoleContext.Provider>");
  return c;
}

export function useConsoleState<S>(selector: (s: ConsoleState) => S): S {
  const c = useConsole();
  return useStore(c.store, selector);
}

/** Events revealed so far by playback (the only events views may render). */
export function useRevealed() {
  return useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
}
