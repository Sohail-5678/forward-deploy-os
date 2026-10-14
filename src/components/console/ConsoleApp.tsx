"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clapperboard, FileSearch, GitBranch, Laptop, Network, Pin, PinOff, ShieldHalf, Sparkles, Workflow, X } from "lucide-react";
import { ConsoleContext, useConsole, useConsoleState } from "./context";
import { MissionBar } from "./MissionBar";
import { PipelineGraph, PipelineStepper } from "./PipelineGraph";
import { FlightRecorder } from "./FlightRecorder";
import { HitlConsole } from "./HitlConsole";
import { NodeInspector } from "./NodeInspector";
import { CommandPalette } from "./CommandPalette";
import { BenchmarksDrawer } from "./BenchmarksDrawer";
import { SandboxDrawer } from "./SandboxDrawer";
import { ChaosPanel } from "./views/ChaosPanel";
import { SchemaWorkbench } from "./views/SchemaWorkbench";
import { ReconcileView } from "./views/ReconcileView";
import { LegacySplitView } from "./views/LegacySplitView";
import { SecurityPlayground } from "./views/SecurityPlayground";
import { AuditView } from "./views/AuditView";
import { StatusChip, type Status } from "@/components/ui/primitives";
import { DirectorBar, Captions, SummaryCard, useDirectorKeys } from "@/components/director/DirectorChrome";
import { useDirector } from "@/components/director/useDirector";
import { createConsole, useControllerLifetime, type ConsoleController, type ViewId } from "@/lib/console-store";
import { describeEvent, ofType } from "@/lib/derive";
import { useTheme } from "@/lib/theme";
import { NODE_NAMES } from "@/engine/agent/runtime";
import type { NodeId, ScenarioId } from "@/engine/types";
import { formatMs } from "@/engine/format";
import { cn } from "@/lib/cn";

type Panel = "palette" | "bench" | "sandbox" | "chaos" | null;

export interface ConsoleAppProps {
  /** Use an existing controller (Director Mode hands its live run to the console). */
  controller?: ConsoleController;
  initialScenario?: ScenarioId;
  /** Deep link: run straight to this node (`/console?scenario=2&step=5`). */
  initialStep?: number;
  mode?: "console" | "director";
  /** Director Mode starts playing as soon as it mounts (the visitor already pressed Play). */
  autoStart?: boolean;
  onTakeControl?: () => void;
  onExit?: () => void;
}

export function ConsoleApp({ controller, initialScenario, initialStep, mode = "console", autoStart, onTakeControl, onExit }: ConsoleAppProps) {
  const [c] = useState(() => controller ?? createConsole());
  useControllerLifetime(c, !controller);

  return (
    <ConsoleContext.Provider value={c}>
      <ConsoleShell mode={mode} autoStart={autoStart} initialScenario={initialScenario} initialStep={initialStep} onTakeControl={onTakeControl} onExit={onExit} />
    </ConsoleContext.Provider>
  );
}

function ConsoleShell({ mode, autoStart, initialScenario, initialStep, onTakeControl, onExit }: Omit<ConsoleAppProps, "controller">) {
  const c = useConsole();
  const view = useConsoleState((s) => s.view);
  // /console?scenario=sandbox opens straight into the "use your own data" drawer.
  const [panel, setPanel] = useState<Panel>(() => (mode !== "director" && initialScenario === "sandbox" ? "sandbox" : null));
  const [, toggleTheme] = useTheme();
  const director = mode === "director";
  const d = useDirector(director);
  useDirectorKeys(d, director, onExit);
  const deepLinked = useRef(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!director || !autoStart || autoStarted.current) return;
    autoStarted.current = true;
    d.play();
  }, [director, autoStart, d]);

  // Deep links: select the scenario, then run at full speed to the requested node.
  useEffect(() => {
    if (director || deepLinked.current || !initialScenario) return;
    deepLinked.current = true;
    c.selectScenario(initialScenario);
    if (!initialStep || initialScenario === "sandbox") return;
    void (async () => {
      c.setSpeed("instant");
      while (c.s.scenario === initialScenario && (!c.s.graph || (c.s.graph.status === "RUNNING" && c.s.graph.cursor <= Math.min(8, initialStep)))) {
        const before = c.s.graph?.cursor;
        await c.step();
        if (c.s.error || c.s.graph?.cursor === before) break;
      }
      c.setSpeed(1);
    })();
  }, [c, director, initialScenario, initialStep]);

  const takeControl = () => {
    d.release();
    onTakeControl?.();
  };

  return (
    <div className="relative isolate h-dvh overflow-hidden bg-bg text-ink">
      <div className="nebula" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col">
        {director ? <DirectorBar d={d} onTakeControl={takeControl} onExit={onExit} /> : <MissionBar onOpen={(p) => setPanel(p)} onHome={onExit} />}
        <SmallScreenNote />
        <ErrorBanner />
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
          <aside className="panel hidden w-[292px] shrink-0 flex-col overflow-hidden xl:flex" aria-label="Pipeline">
            <RunHeader />
            <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
              <PipelineGraph />
            </div>
            <Branches />
          </aside>
          <div className="xl:hidden">
            <PipelineStepper />
          </div>
          <section className="panel relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Active view">
            <ViewTabs />
            <div className="relative min-h-0 flex-1 overflow-auto scroll-thin">
              {view === "workbench" && <SchemaWorkbench />}
              {view === "reconcile" && <ReconcileView />}
              {view === "security" && <SecurityPlayground />}
              {view === "audit" && <AuditView />}
              {/* The portal iframe stays mounted so the agent can work while another view is open. */}
              <LegacySplitView active={view === "portal"} />
              {director && <SummaryCard d={d} onTakeControl={takeControl} />}
            </div>
          </section>
        </main>
        {director ? (
          <Captions d={d} />
        ) : (
          <div className="h-[184px] shrink-0">
            <FlightRecorder />
          </div>
        )}
      </div>
      <HitlConsole />
      <NodeInspector />
      {!director && (
        <>
          <ChaosPanel open={panel === "chaos"} onClose={() => setPanel(null)} />
          <BenchmarksDrawer open={panel === "bench"} onClose={() => setPanel(null)} />
          <SandboxDrawer open={panel === "sandbox"} onClose={() => setPanel(null)} />
          <CommandPalette open={panel === "palette"} setOpen={(v) => setPanel(v ? "palette" : null)} onOpenPanel={(p) => setPanel(p)} toggleTheme={toggleTheme} />
        </>
      )}
      <LiveRegion />
    </div>
  );
}

// ------------------------------------------------------------------ pieces

const STATUS_FOR: Record<string, Status> = { RUNNING: "running", SUSPENDED_HITL: "suspended", COMPLETED: "done", FAILED: "failed" };

function RunHeader() {
  const graph = useConsoleState((s) => s.graph);
  const running = useConsoleState((s) => s.running);
  const held = useConsoleState((s) => s.held);
  const replayOnly = useConsoleState((s) => s.replayOnly);
  const busy = useConsoleState((s) => s.busy);
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const engineMs = useMemo(() => ofType(events.slice(0, revealed), "NODE_FINISHED").reduce((a, e) => a + (e.ms ?? 0), 0), [events, revealed]);
  const status: Status = !graph ? "idle" : held && graph.status === "RUNNING" ? "suspended" : graph.status === "RUNNING" && !running ? "idle" : (STATUS_FOR[graph.status] ?? "idle");
  const word = !graph ? (busy ? "STARTING" : "NO RUN YET") : held && graph.status === "RUNNING" ? "PAUSED" : graph.status === "RUNNING" && !running ? "READY" : graph.status === "SUSPENDED_HITL" ? "NEEDS A HUMAN" : undefined;
  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow">Pipeline</h2>
        <span data-testid="run-status">
          <StatusChip status={status} word={word} />
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] text-ink-3">
        <span className="truncate" title={graph?.runId}>
          {graph ? graph.runId : "press Run or Step"}
        </span>
        <span className="tabular" title="Sum of measured node times (portal nodes include viewing pace)">{engineMs ? `${formatMs(engineMs)} in nodes` : ""}</span>
      </div>
      {replayOnly && <p className="mt-1 text-[11px] text-lilac">Loaded run: replay only. Run starts a fresh run.</p>}
    </div>
  );
}

function Branches() {
  const branches = useConsoleState((s) => s.branches);
  const runId = useConsoleState((s) => s.runId);
  if (branches.length < 2) return null;
  return (
    <div className="border-t border-line px-3 py-2.5">
      <h3 className="eyebrow mb-2 flex items-center gap-1.5">
        <GitBranch size={12} aria-hidden="true" /> Branches
      </h3>
      <table className="w-full text-[11.5px]">
        <thead className="text-ink-3">
          <tr>
            <th className="text-left font-semibold">Run</th>
            <th className="text-right font-semibold">Posted</th>
            <th className="text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.runId} className={cn(b.runId === runId && "text-agent")}>
              <td className="max-w-[120px] truncate py-0.5" title={b.runId}>
                {b.label}
              </td>
              <td className="text-right font-mono tabular">{b.state?.n7 ? b.state.n7.postings.length : "–"}</td>
              <td className="text-right font-mono text-[10.5px]">{b.state?.status.toLowerCase().replace("_hitl", "") ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VIEWS: { id: ViewId; label: string; Icon: typeof Sparkles }[] = [
  { id: "workbench", label: "Schema workbench", Icon: Sparkles },
  { id: "reconcile", label: "Reconcile & HITL", Icon: FileSearch },
  { id: "portal", label: "Legacy portal", Icon: Network },
  { id: "security", label: "Security", Icon: ShieldHalf },
  { id: "audit", label: "Audit log", Icon: Workflow },
];

function ViewTabs() {
  const c = useConsole();
  const view = useConsoleState((s) => s.view);
  const pinned = useConsoleState((s) => s.viewPinned);
  const director = useConsoleState((s) => s.director);
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const badges = useMemo(() => {
    const shown = events.slice(0, revealed);
    return {
      workbench: ofType(shown, "DRIFT_DETECTED").reduce((n, e) => n + e.payload.errors.length, 0),
      reconcile: ofType(shown, "POLICY_HIT").length,
      portal: ofType(shown, "POSTED").length,
      security: ofType(shown, "DOC_QUARANTINED").length + ofType(shown, "GUARD_BLOCKED").length,
      audit: ofType(shown, "AUDIT_COMMITTED").pop()?.payload.entries ?? 0,
    } as Record<ViewId, number>;
  }, [events, revealed]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length];
    c.setView(next.id);
    document.getElementById(`view-tab-${next.id}`)?.focus();
  };
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5 scroll-thin">
      <div role="tablist" aria-label="Views" className="flex items-center gap-0.5">
        {VIEWS.map((v, i) => {
          const active = v.id === view;
          return (
            <button
              key={v.id}
              id={`view-tab-${v.id}`}
              role="tab"
              type="button"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => c.setView(v.id)}
              className={cn("relative flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-150", active ? "bg-white/[0.07] text-ink" : "text-ink-3 hover:text-ink-2")}
            >
              <v.Icon size={13} aria-hidden="true" className={active ? "text-agent" : undefined} />
              {v.label}
              {badges[v.id] > 0 && <span className={cn("rounded-full px-1.5 font-mono text-[10px] tabular", active ? "bg-agent/15 text-agent" : "bg-white/[0.06] text-ink-2")}>{badges[v.id]}</span>}
              {active && <span className="absolute inset-x-3 -bottom-[7px] h-[2px] rounded-full bg-agent shadow-[0_0_10px_var(--agent)]" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {!director && (
        <div className="ml-auto pl-2">
          {pinned ? (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => c.unpinView()} title="Let the view follow the node that is working">
              <PinOff size={12} aria-hidden="true" /> Follow the run
            </button>
          ) : (
            <span className="chip" title="The view switches to the node that is working. Pick a tab to pin it.">
              <Pin size={11} aria-hidden="true" /> Following the run
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBanner() {
  const c = useConsole();
  const error = useConsoleState((s) => s.error);
  if (!error) return null;
  return (
    <div role="alert" className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-danger/50 bg-[color-mix(in_oklab,var(--danger)_10%,var(--surface-1))] px-3 py-2 text-[13px] text-ink">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <span className="flex-1">{error}</span>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => c.store.set({ error: undefined })} aria-label="Dismiss">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

function SmallScreenNote() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-line-strong bg-[var(--surface-1)] px-3 py-2 text-[12.5px] text-ink-2 md:hidden">
      <Laptop size={15} className="mt-0.5 shrink-0 text-agent" aria-hidden="true" />
      <span className="flex-1">
        Best on a laptop: the console is built for screens 1280px and wider. On a phone, the{" "}
        <Link href="/?play=1" className="text-agent underline">
          <Clapperboard size={11} className="inline" aria-hidden="true" /> 90-second demo
        </Link>{" "}
        tells the story better.
      </span>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Announces node completions, suspensions and failures to screen readers (spec 14.8). */
function LiveRegion() {
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const [message, setMessage] = useState("");
  const last = useRef(0);
  useEffect(() => {
    if (revealed < last.current) last.current = revealed;
    const fresh = events.slice(last.current, revealed).filter((e) => e.type === "NODE_FINISHED" || e.type === "RUN_SUSPENDED" || e.type === "RUN_FAILED" || e.type === "AUDIT_COMMITTED");
    last.current = revealed;
    const e = fresh[fresh.length - 1];
    if (!e) return;
    const text = e.type === "NODE_FINISHED" ? `Node ${e.node}, ${NODE_NAMES[e.node as NodeId]}, finished: ${describeEvent(e)}` : describeEvent(e);
    const t = setTimeout(() => setMessage(text), 0);
    return () => clearTimeout(t);
  }, [events, revealed]);
  return (
    <div className="sr-only" aria-live="polite" role="status">
      {message}
    </div>
  );
}
