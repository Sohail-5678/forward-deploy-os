"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, Gauge as GaugeIcon } from "lucide-react";
import { useConsole, useConsoleState } from "./context";
import { describeEvent, NODE_COLORS, NODE_IDS } from "@/lib/derive";
import type { AnyEngineEvent, NodeId } from "@/engine/types";
import { formatMs } from "@/engine/format";
import { cn } from "@/lib/cn";

const SEVERE = new Set(["DOC_QUARANTINED", "GUARD_BLOCKED", "RUN_FAILED"]);
const NOTABLE = new Set(["RUN_SUSPENDED", "POLICY_HIT", "SELECTOR_HEALED", "POSTED", "DUPLICATE_PREVENTED", "HUMAN_DECISION", "INJECTION_FLAGGED"]);

function useFps(): number {
  const [fps, setFps] = useState(60);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      frames++;
      if (t - last >= 1000) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export function FlightRecorder() {
  const c = useConsole();
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const running = useConsoleState((s) => s.running);
  const [filter, setFilter] = useState<NodeId | "all" | "important">("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fps = useFps();

  const visible = useMemo(() => {
    const shown = events.slice(0, revealed);
    return shown.filter((e) => (filter === "all" ? true : filter === "important" ? SEVERE.has(e.type) || NOTABLE.has(e.type) : e.node === filter));
  }, [events, revealed, filter]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const download = () => {
    const file = c.exportRun();
    if (!file) return;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.runId}.flight-recorder.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      setLoadError("That file is larger than 8 MB.");
      return;
    }
    setLoadError(await c.loadRun(await f.text()));
  };

  const total = events.length;
  return (
    <section className="panel mx-3 mb-3 flex min-h-0 flex-col" aria-label="Flight recorder">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="eyebrow mr-1">Flight recorder</h2>
        <span className="font-mono text-[11px] text-ink-3 tabular">
          {revealed}/{total} events
        </span>
        <div className="mx-2 flex items-center gap-1" role="group" aria-label="Filter events">
          {(["all", "important"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("chip", filter === f && "chip-agent")}>
              {f}
            </button>
          ))}
          {NODE_IDS.map((n) => (
            <button key={n} type="button" onClick={() => setFilter(n)} className={cn("chip px-2", filter === n && "chip-agent")} aria-label={`Only node ${n}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_COLORS[n] }} aria-hidden="true" />
              {n}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className={cn("chip", fps >= 55 ? "chip-ok" : fps >= 40 ? "chip-warn" : "chip-danger")} title="Frames per second measured on this page">
            <GaugeIcon size={12} aria-hidden="true" /> {fps} fps
          </span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={download} disabled={!total}>
            <Download size={13} aria-hidden="true" /> Download run
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => fileRef.current?.click()} disabled={running}>
            <FolderOpen size={13} aria-hidden="true" /> Load run
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </div>
      {loadError && <p className="px-3 pt-2 text-[12px] text-danger">{loadError}</p>}

      {/* Timeline scrubber: one tick per event, colored by node. */}
      <div className="relative mx-3 mt-2 h-7">
        <div className="absolute inset-x-0 top-3 h-px bg-line" aria-hidden="true" />
        <div className="absolute inset-0" aria-hidden="true">
          {events.map((e, i) => (
            <span
              key={e.seq}
              className="absolute top-1.5 w-[2px] rounded-full transition-opacity"
              style={{ left: `${total > 1 ? (i / (total - 1)) * 100 : 0}%`, height: SEVERE.has(e.type) || NOTABLE.has(e.type) ? 16 : 10, top: SEVERE.has(e.type) || NOTABLE.has(e.type) ? 4 : 7, background: SEVERE.has(e.type) ? "var(--danger)" : NODE_COLORS[e.node], opacity: i < revealed ? 0.95 : 0.25 }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          value={revealed}
          onChange={(e) => c.scrubTo(Number(e.target.value))}
          disabled={running || total === 0}
          aria-label="Scrub through the event log"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
        {total > 0 && <span className="pointer-events-none absolute top-0 h-7 w-px bg-agent shadow-[0_0_10px_var(--agent)]" style={{ left: `${(revealed / Math.max(1, total)) * 100}%` }} aria-hidden="true" />}
      </div>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-[11.5px] scroll-thin" aria-live="off">
        {visible.length === 0 && <li className="py-6 text-center font-sans text-[13px] text-ink-3">No events yet. Pick a scenario and press Run.</li>}
        {visible.slice(-400).map((e: AnyEngineEvent) => (
          <li key={e.seq} className={cn("grid grid-cols-[52px_22px_160px_1fr_70px] items-baseline gap-2 border-b border-white/[0.03] py-[3px]", SEVERE.has(e.type) ? "text-danger" : NOTABLE.has(e.type) ? "text-ink" : "text-ink-2")}>
            <span className="tabular text-ink-3">{e.at.toFixed(1)}</span>
            <span className="font-semibold" style={{ color: NODE_COLORS[e.node] }}>
              {e.node}
            </span>
            <span className="truncate">{e.type}</span>
            <span className="truncate font-sans text-[12px]">{describeEvent(e)}</span>
            <span className="text-right tabular text-ink-3">{e.ms !== undefined ? formatMs(e.ms) : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
