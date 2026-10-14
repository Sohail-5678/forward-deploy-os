"use client";
import Link from "next/link";
import { useState } from "react";
import { BarChart3, ChevronDown, Command, FlaskConical, Moon, Pause, Play, RotateCcw, SkipForward, Sun, Tornado, Upload, Clapperboard } from "lucide-react";
import { Logo, Segmented, Kbd } from "@/components/ui/primitives";
import { useConsole, useConsoleState } from "./context";
import { SCENARIOS } from "@/engine/data/scenarios";
import type { ScenarioId } from "@/engine/types";
import type { Speed } from "@/lib/console-store";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

const SPEEDS: { value: string; label: string }[] = [
  { value: "0.25", label: "¼x" },
  { value: "0.5", label: "½x" },
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
  { value: "instant", label: "Instant" },
];

export { useTheme };

export function ModeBadge() {
  const health = useConsoleState((s) => s.health);
  const mode = useConsoleState((s) => s.config.mode);
  const byok = useConsoleState((s) => s.byokActive);
  const llm = mode === "llm" && (health?.llm.configured || byok);
  return (
    <span className={cn("chip", llm ? "chip-violet" : "chip-agent")} title={llm ? `LLM-assisted: answers validated by Zod; model ${health?.model ?? "llama-3.3-70b-versatile"}${byok ? " (your key)" : ""}` : "Deterministic: no model is called"}>
      <span className={cn("h-1.5 w-1.5 rounded-full", llm ? "bg-lilac" : "bg-agent")} aria-hidden="true" />
      {llm ? `LLM-assisted · ${health?.model ?? "your key"}` : "Deterministic"}
    </span>
  );
}

export function MissionBar({ onOpen, onHome }: { onOpen: (panel: "palette" | "bench" | "sandbox" | "chaos") => void; onHome?: () => void }) {
  const c = useConsole();
  const scenario = useConsoleState((s) => s.scenario);
  const running = useConsoleState((s) => s.running);
  const busy = useConsoleState((s) => s.busy);
  const speed = useConsoleState((s) => s.speed);
  const status = useConsoleState((s) => s.graph?.status);
  const chaos = useConsoleState((s) => s.config.chaos.types.length);
  const suspended = useConsoleState((s) => !!s.suspension);
  const held = useConsoleState((s) => s.held);
  const [theme, toggleTheme] = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const scenarioLabel = scenario === "sandbox" ? "Sandbox: your data" : `${scenario}. ${SCENARIOS[scenario].title}`;

  const choose = (id: ScenarioId) => {
    c.selectScenario(id);
    setPickerOpen(false);
  };

  return (
    <header className="glass glass-rim relative z-40 mx-3 mt-3 flex flex-wrap items-center gap-1.5 rounded-[22px] px-3 py-2">
      <Link
        href="/"
        className="mr-1 rounded-full pr-2"
        aria-label="ForwardDeploy OS home"
        onClick={(e) => {
          if (onHome) {
            e.preventDefault();
            onHome();
          }
        }}
      >
        <Logo />
      </Link>

      <div className="relative">
        <button type="button" className="btn btn-glass btn-sm max-w-[280px]" aria-haspopup="listbox" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)} disabled={running}>
          <span className="truncate">{scenarioLabel}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {pickerOpen && (
          <div role="listbox" aria-label="Scenarios" className="glass glass-rim absolute left-0 top-[calc(100%+8px)] z-50 w-[420px] origin-top-left rounded-2xl p-1.5 [animation:dialog-in_180ms_var(--ease-out)]">
            {([1, 2, 3, 4, 5] as const).map((id) => (
              <button key={id} role="option" aria-selected={scenario === id} type="button" onClick={() => choose(id)} className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]", scenario === id && "bg-white/[0.07]")}>
                <span className="mt-0.5 font-mono text-[12px] text-agent">0{id}</span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{SCENARIOS[id].title}</span>
                  <span className="block text-[12px] text-ink-3">{SCENARIOS[id].vendor}</span>
                </span>
              </button>
            ))}
            <div className="hairline my-1" />
            <button role="option" aria-selected={scenario === "sandbox"} type="button" onClick={() => choose("sandbox")} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06]">
              <Upload size={14} className="mt-0.5 text-lilac" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-semibold text-ink">Sandbox: run your own CSV, JSON or PDF</span>
                <span className="block text-[12px] text-ink-3">Files stay in your browser unless you turn on LLM assist</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {running ? (
          <button type="button" className="btn btn-glass btn-sm" onClick={() => c.pause()} aria-label="Pause">
            <Pause size={15} aria-hidden="true" /> Pause
          </button>
        ) : (
          <button type="button" className="btn btn-cyan btn-sm" onClick={() => void c.run()} disabled={(busy && !held) || suspended} aria-label={status === "COMPLETED" ? "Run again" : held && status === "RUNNING" ? "Resume" : "Run"}>
            <Play size={15} aria-hidden="true" /> {status === "COMPLETED" ? "Run again" : held && status === "RUNNING" ? "Resume" : "Run"}
          </button>
        )}
        <button type="button" className="btn btn-glass btn-sm" onClick={() => void c.step()} disabled={running || busy || suspended || status === "COMPLETED"} title="Run the next node">
          <SkipForward size={15} aria-hidden="true" /> Step
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => c.reset()} title="Reset this scenario" aria-label="Reset">
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>

      <Segmented label="Presentation speed" value={String(speed)} options={SPEEDS} onChange={(v) => c.setSpeed((v === "instant" ? "instant" : Number(v)) as Speed)} size="xs" />

      <ModeBadge />

      <div className="ml-auto flex flex-wrap items-center gap-0.5">
        <button type="button" className={cn("btn btn-xs", chaos ? "btn-amethyst" : "btn-ghost")} onClick={() => onOpen("chaos")} title="Inject portal chaos">
          <Tornado size={14} aria-hidden="true" /> Chaos{chaos ? ` · ${chaos}` : ""}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onOpen("sandbox")} title="Use your own data">
          <FlaskConical size={14} aria-hidden="true" /> Your data
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onOpen("bench")} title="Benchmarks">
          <BarChart3 size={14} aria-hidden="true" /> Benchmarks
        </button>
        <Link href="/?play=1" className="btn btn-ghost btn-xs" title="90-second guided demo">
          <Clapperboard size={14} aria-hidden="true" /> Demo
        </Link>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => onOpen("palette")} aria-label="Command palette">
          <Command size={14} aria-hidden="true" />
          <Kbd>K</Kbd>
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
          {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
