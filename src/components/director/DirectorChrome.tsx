"use client";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ArrowRight, Captions as CaptionsIcon, ChevronLeft, ChevronRight, Gamepad2, Pause, Play, RotateCcw, X } from "lucide-react";
import { Logo, Segmented, Kbd } from "@/components/ui/primitives";
import { useConsole, useConsoleState } from "@/components/console/context";
import { headlineTiles } from "@/components/bench/BenchTiles";
import { formatMs } from "@/engine/format";
import type { Speed } from "@/lib/console-store";
import { cn } from "@/lib/cn";
import { SCENES, summarize } from "./scenes";
import type { DirectorApi } from "./useDirector";

const SPEEDS = [
  { value: "0.5", label: "½x" },
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
];

/** Space play/pause, arrows for scenes, C for captions. */
export function useDirectorKeys(d: DirectorApi, enabled: boolean, onExit?: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.code === "Space") {
        if (t?.tagName === "BUTTON") return; // the focused button handles Space itself
        e.preventDefault();
        d.toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        d.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        d.prev();
      } else if (e.key.toLowerCase() === "c") d.setCaptions(!d.captions);
      else if (e.key === "Escape" && onExit && !document.querySelector("[role=dialog][aria-modal=true]")) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, enabled, onExit]);
}

export function DirectorBar({ d, onTakeControl, onExit }: { d: DirectorApi; onTakeControl: () => void; onExit?: () => void }) {
  const c = useConsole();
  const speed = useConsoleState((s) => s.speed);
  return (
    <header className="glass glass-rim relative z-40 mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-[22px] px-3 py-2">
      <Logo className="mr-1" />
      <span className="chip chip-violet">Director Mode · Scenario 5, The Full Gauntlet</span>
      <ol className="mx-1 flex items-center gap-1" aria-label="Scenes">
        {SCENES.map((sc) => {
          const state = d.scene === sc.id ? "now" : d.scene > sc.id ? "done" : "next";
          return (
            <li key={sc.id}>
              <button
                type="button"
                onClick={() => d.goTo(sc.id)}
                aria-current={state === "now" ? "step" : undefined}
                className={cn("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors duration-150", state === "now" ? "border-agent/70 bg-agent/10 text-agent" : state === "done" ? "border-line-strong text-ink-2" : "border-line text-ink-3 hover:text-ink-2")}
              >
                <span className="font-mono">{sc.id}</span>
                <span className="hidden lg:inline">{sc.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={d.prev} aria-label="Previous scene" disabled={d.scene <= 1}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-cyan btn-sm min-w-[96px]" onClick={d.toggle} aria-label={d.playing ? "Pause" : "Play"}>
          {d.playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {d.playing ? "Pause" : d.started ? "Play" : "Play demo"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={d.next} aria-label="Next scene" disabled={d.scene >= 6}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <Segmented label="Demo speed" size="xs" value={speed === "instant" ? "4" : String(speed)} options={SPEEDS} onChange={(v) => c.setSpeed(Number(v) as Speed)} />
      <button type="button" className={cn("btn btn-sm", d.captions ? "btn-glass" : "btn-ghost")} aria-pressed={d.captions} onClick={() => d.setCaptions(!d.captions)} title="Captions (C)">
        <CaptionsIcon size={15} aria-hidden="true" /> CC
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-1 text-[11px] text-ink-3 xl:flex">
          <Kbd>Space</Kbd> <Kbd>←</Kbd> <Kbd>→</Kbd>
        </span>
        <button type="button" className="btn btn-amethyst btn-sm" onClick={onTakeControl}>
          <Gamepad2 size={15} aria-hidden="true" /> Take control
        </button>
        {onExit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onExit} aria-label="Close the demo">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}

/** Bottom-center glass caption strip. It sits in its own band, so it never covers the element being discussed. */
export function Captions({ d }: { d: DirectorApi }) {
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const graph = useConsoleState((s) => s.graph);
  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);
  const sc = d.scene ? SCENES[d.scene - 1] : null;
  const text = sc ? sc.caption(shown, graph) : "Press Play: 8 invoices from 3 vendors go through the real engine and the real 2009 portal, with captions.";
  return (
    <div className="flex h-[76px] shrink-0 items-center justify-center px-3 pb-3">
      {d.captions && (
        <div className="glass glass-rim flex max-w-[860px] items-center gap-3 rounded-2xl px-5 py-3" aria-live="polite">
          {sc && <span className="font-mono text-[11px] text-agent">{String(sc.id).padStart(2, "0")}</span>}
          <p key={text} className="fade-up text-[15px] leading-snug text-ink">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

export function SummaryCard({ d, onTakeControl }: { d: DirectorApi; onTakeControl: () => void }) {
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const sum = useMemo(() => summarize(events.slice(0, revealed)), [events, revealed]);
  const tiles = useMemo(() => headlineTiles().filter((t) => ["drift", "selectors", "guard"].includes(t.id)), []);
  if (d.scene !== 6) return null;
  const rows: [string, string][] = [
    ["Rows healed and promoted", String(sum.rowsHealed)],
    ["Invariant checks passed", `${sum.invariantsPassed} of ${sum.invariantsTotal}`],
    ["Decisions by the scripted demo operator", sum.decisions.length ? sum.decisions.join(", ") : "none"],
    ["Selectors healed after the portal change", sum.meanHealScore !== undefined ? `${sum.selectorsHealed} (mean score ${sum.meanHealScore.toFixed(2)})` : String(sum.selectorsHealed)],
    ["Invoices posted to the portal", String(sum.posted)],
    ["Hostile documents quarantined", String(sum.quarantinedDocs)],
    ["Engine time for all 8 nodes", formatMs(sum.engineMs)],
    ["Audit entries sealed", sum.auditEntries !== undefined ? `${sum.auditEntries}, chain ${sum.chainValid ? "valid" : "broken"}` : "pending"],
  ];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-auto bg-[#050505]/55 p-4 backdrop-blur-[2px]">
      <div className="glass glass-rim w-full max-w-[860px] rounded-[26px] p-6 [animation:dialog-in_260ms_var(--ease-out)]">
        <div className="eyebrow text-agent!">Scene 6 · Proof</div>
        <h2 className="display mt-1 text-[40px] leading-none text-ink">
          Measured on <span className="iridescent italic">this run</span>
        </h2>
        <dl className="mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
              <dt className="text-[13px] text-ink-2">{k}</dt>
              <dd className="text-right font-mono text-[13px] tabular text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.id} className="rounded-2xl border border-line p-3">
              <div className="display text-[30px] leading-none text-ink">{t.value}</div>
              <div className="mt-1 text-[12px] text-ink-2">{t.label}</div>
              <div className="mt-1 font-mono text-[10.5px] text-ink-3">
                benchmark · {t.cases} cases · seed {t.seed}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="btn btn-cyan" onClick={onTakeControl}>
            Open the console <ArrowRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-glass" onClick={d.restart}>
            <RotateCcw size={15} aria-hidden="true" /> Replay
          </button>
          <Link href="/benchmarks" className="btn btn-ghost">
            See every benchmark
          </Link>
        </div>
      </div>
    </div>
  );
}
