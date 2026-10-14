"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useConsole, useConsoleState } from "./context";
import { SCENARIOS } from "@/engine/data/scenarios";
import { NODE_NAMES } from "@/engine/agent/runtime";
import type { NodeId } from "@/engine/types";
import type { ViewId } from "@/lib/console-store";
import { Kbd } from "@/components/ui/primitives";

/**
 * Command palette (⌘K / Ctrl+K). Opened from the keyboard many times a day,
 * so it appears instantly with no animation.
 */
export function CommandPalette({ open, setOpen, onOpenPanel, toggleTheme }: { open: boolean; setOpen: (v: boolean) => void; onOpenPanel: (p: "bench" | "sandbox" | "chaos") => void; toggleTheme: () => void }) {
  const c = useConsole();
  const router = useRouter();
  const running = useConsoleState((s) => s.running);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  const views: [ViewId, string][] = [
    ["workbench", "Schema workbench"],
    ["reconcile", "Reconciler and HITL"],
    ["portal", "Legacy portal split view"],
    ["security", "Security playground"],
    ["audit", "Audit log"],
  ];
  const download = () => {
    const f = c.exportRun();
    if (!f) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(f, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.runId}.flight-recorder.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[14vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
      <Command label="Command palette" className="glass glass-strong glass-rim relative w-full max-w-[600px] overflow-hidden rounded-[20px]" loop>
        <Command.Input autoFocus placeholder="Run, switch scenario, open a view…" className="h-14 w-full border-b border-line bg-transparent px-5 text-[15px] text-ink outline-none placeholder:text-ink-3" />
        <Command.List className="max-h-[52vh] overflow-auto p-2 scroll-thin">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">No matching command.</Command.Empty>
          <Command.Group heading="Run" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <Item onSelect={act(() => (running ? c.pause() : void c.run()))} hint="Run / pause">
              {running ? "Pause the run" : "Run the current scenario"}
            </Item>
            <Item onSelect={act(() => void c.step())} hint="Step">
              Run the next node
            </Item>
            <Item onSelect={act(() => c.reset())}>Reset the run</Item>
            <Item onSelect={act(download)}>Download run (flight recorder JSON)</Item>
          </Command.Group>
          <Command.Group heading="Scenarios" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {([1, 2, 3, 4, 5] as const).map((id) => (
              <Item key={id} onSelect={act(() => c.selectScenario(id))} hint={`0${id}`}>
                {SCENARIOS[id].title}
              </Item>
            ))}
            <Item onSelect={act(() => (c.selectScenario("sandbox"), onOpenPanel("sandbox")))}>Sandbox: use your own data</Item>
          </Command.Group>
          <Command.Group heading="Views" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {views.map(([id, label]) => (
              <Item key={id} onSelect={act(() => c.setView(id))}>
                Open {label}
              </Item>
            ))}
            {([1, 2, 3, 4, 5, 6, 7, 8] as NodeId[]).map((n) => (
              <Item key={n} onSelect={act(() => c.selectNode(n))}>
                Inspect node {n}: {NODE_NAMES[n]}
              </Item>
            ))}
          </Command.Group>
          <Command.Group heading="Tools" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <Item onSelect={act(() => onOpenPanel("chaos"))}>Toggle portal chaos</Item>
            <Item onSelect={act(() => onOpenPanel("bench"))}>Open benchmarks</Item>
            <Item onSelect={act(toggleTheme)}>Toggle light / dark theme</Item>
            <Item onSelect={act(() => router.push("/?play=1"))}>Play the 90-second demo</Item>
            <Item onSelect={act(() => router.push("/how-it-works"))}>How it works</Item>
          </Command.Group>
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </Command>
    </div>
  );
}

function Item({ children, onSelect, hint }: { children: React.ReactNode; onSelect: () => void; hint?: string }) {
  return (
    <Command.Item onSelect={onSelect} className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-white/[0.07] data-[selected=true]:text-ink">
      <span>{children}</span>
      {hint && <span className="font-mono text-[11px] text-ink-3">{hint}</span>}
    </Command.Item>
  );
}
