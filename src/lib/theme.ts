"use client";
import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const read = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** Theme shared by every component (the source of truth is the <html data-theme> attribute). */
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const toggle = useCallback(() => {
    const next: Theme = read() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("fdos-theme", next);
    } catch {
      /* storage blocked: the choice lasts for this page view */
    }
  }, []);
  return [theme, toggle];
}
