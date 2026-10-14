"use client";
import { useMemo, useState } from "react";
import { ChevronRight, GitFork, Hammer } from "lucide-react";
import { useConsole, useConsoleState } from "./context";
import { Drawer, Segmented, Dialog } from "@/components/ui/primitives";
import { NODE_BLURBS, NODE_NAMES } from "@/engine/agent/runtime";
import { describeEvent, nodeInfo } from "@/lib/derive";
import type { ChaosType, GraphState, NodeId } from "@/engine/types";
import { formatMs, formatUsd } from "@/engine/format";
import { CHAOS_INFO } from "./views/ChaosPanel";
import { cn } from "@/lib/cn";

const SECTION_FOR: Record<NodeId, (keyof GraphState)[]> = {
  1: ["input"],
  2: ["n1"],
  3: ["n2"],
  4: ["n3"],
  5: ["n4"],
  6: ["n5"],
  7: ["n6", "n5"],
  8: ["n7"],
};
const OUTPUT_FOR: Record<NodeId, keyof GraphState> = { 1: "n1", 2: "n2", 3: "n3", 4: "n4", 5: "n5", 6: "n6", 7: "n7", 8: "n8" };

/** Lazy, collapsible JSON tree (large states stay cheap to render). */
export function JsonTree({ value, name, depth = 0 }: { value: unknown; name?: string; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isObj = value !== null && typeof value === "object";
  if (!isObj) {
    return (
      <div className="font-mono text-[11.5px] leading-[1.6]" style={{ paddingLeft: depth * 12 }}>
        {name !== undefined && <span className="text-lilac">{name}: </span>}
        <span className={typeof value === "string" ? "text-[#9ff0c7]" : typeof value === "number" ? "text-agent" : "text-warn"}>{JSON.stringify(value)?.slice(0, 300)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-mono text-[11.5px] leading-[1.6] text-ink-2 hover:text-ink" aria-expanded={open}>
        <ChevronRight size={11} className={cn("transition-transform duration-150", open && "rotate-90")} aria-hidden="true" />
        {name !== undefined && <span className="text-lilac">{name}</span>}
        <span className="text-ink-3">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && entries.slice(0, 200).map(([k, v]) => <JsonTree key={k} name={k} value={v} depth={1} />)}
      {open && entries.length > 200 && <div className="pl-4 font-mono text-[11px] text-ink-3">… {entries.length - 200} more</div>}
    </div>
  );
}

export function NodeInspector() {
  const c = useConsole();
  const node = useConsoleState((s) => s.selectedNode);
  const checkpoints = useConsoleState((s) => s.checkpoints);
  const events = useConsoleState((s) => s.events);
  const revealed = useConsoleState((s) => s.revealed);
  const suspension = useConsoleState((s) => s.suspension);
  const running = useConsoleState((s) => s.running);
  const [tab, setTab] = useState<"input" | "output" | "events" | "timing">("output");
  const [forkOpen, setForkOpen] = useState(false);
  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);
  if (!node) return null;
  const info = nodeInfo(shown)[node];
  const before = [...checkpoints].reverse().find((cp) => cp.atNode < node) ?? checkpoints[0];
  const after = [...checkpoints].reverse().find((cp) => cp.atNode === node);
  const nodeEvents = shown.filter((e) => e.node === node);
  const inputValue = before ? Object.fromEntries(SECTION_FOR[node].map((k) => [k, before.state[k]])) : null;
  const outputValue = after ? after.state[OUTPUT_FOR[node]] : null;
  const suspendedHere = suspension && suspension.checkpoint.state.cursor === node;

  return (
    <>
      <Drawer open onClose={() => c.selectNode(undefined)} title={`${String(node).padStart(2, "0")} · ${NODE_NAMES[node]}`}>
        <p className="text-[13px] text-ink-2">{NODE_BLURBS[node]}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="chip">{info.status.toUpperCase()}</span>
          {info.ms !== undefined && <span className="chip chip-agent">{formatMs(info.ms)} measured</span>}
          {info.runs > 1 && <span className="chip">ran {info.runs}×</span>}
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="btn btn-amethyst btn-xs" onClick={() => setForkOpen(true)} disabled={running || !before}>
              <GitFork size={12} aria-hidden="true" /> Fork from here
            </button>
            {suspendedHere && (
              <button type="button" className="btn btn-glass btn-xs" onClick={() => c.tamper()} disabled={!suspension?.signature || suspension.tampered}>
                <Hammer size={12} aria-hidden="true" /> Tamper with this checkpoint
              </button>
            )}
          </div>
        </div>
        {info.summary && <p className="mt-3 rounded-xl border border-line bg-[var(--surface-0)]/60 p-3 text-[12.5px] text-ink">{info.summary}</p>}
        <div className="mt-4">
          <Segmented
            label="Inspector tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: "input", label: "Input state" },
              { value: "output", label: "Output state" },
              { value: "events", label: `Events (${nodeEvents.length})` },
              { value: "timing", label: "Timing" },
            ]}
          />
        </div>
        <div className="mt-3 rounded-xl border border-line bg-[var(--surface-0)]/60 p-3">
          {tab === "input" && (inputValue ? <JsonTree value={inputValue} /> : <p className="text-[12px] text-ink-3">No checkpoint before this node yet.</p>)}
          {tab === "output" && (outputValue ? <JsonTree value={outputValue} /> : <p className="text-[12px] text-ink-3">This node has not run yet.</p>)}
          {tab === "events" && (
            <ol className="space-y-1 font-mono text-[11.5px]">
              {nodeEvents.map((e) => (
                <li key={e.seq} className="text-ink-2">
                  <span className="text-ink-3">{e.at.toFixed(1)}ms</span> <span className="text-agent">{e.type}</span> {describeEvent(e)}
                </li>
              ))}
              {nodeEvents.length === 0 && <li className="font-sans text-ink-3">No events yet.</li>}
            </ol>
          )}
          {tab === "timing" && (
            <dl className="grid grid-cols-2 gap-y-1.5 text-[12px]">
              <dt className="text-ink-3">Engine time (measured)</dt>
              <dd className="text-right font-mono text-ink">{info.ms !== undefined ? formatMs(info.ms) : "—"}</dd>
              {nodeEvents
                .filter((e) => e.ms !== undefined && e.type !== "NODE_FINISHED")
                .slice(0, 30)
                .map((e) => (
                  <div key={e.seq} className="contents">
                    <dt className="truncate text-ink-3">{e.type}</dt>
                    <dd className="text-right font-mono text-ink-2">{formatMs(e.ms!)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      </Drawer>
      <ForkDialog open={forkOpen} onClose={() => setForkOpen(false)} node={node} />
    </>
  );
}

function ForkDialog({ open, onClose, node }: { open: boolean; onClose: () => void; node: NodeId }) {
  const c = useConsole();
  const config = useConsoleState((s) => s.config);
  const [abs, setAbs] = useState(config.policy.absToleranceCents / 100);
  const [rel, setRel] = useState(config.policy.relTolerance * 100);
  const [thr, setThr] = useState(config.policy.confidenceThreshold);
  const [chaos, setChaos] = useState<ChaosType[]>(config.chaos.types);
  const [seed, setSeed] = useState(config.chaos.seed);
  const [scanner, setScanner] = useState(config.security.scanner);
  const [fromNode, setFromNode] = useState<NodeId>(Math.max(2, node) as NodeId);

  const go = () => {
    const changes: string[] = [];
    if (abs * 100 !== config.policy.absToleranceCents) changes.push(`tolerance ${formatUsd(Math.round(abs * 100))}`);
    if (thr !== config.policy.confidenceThreshold) changes.push(`threshold ${thr}`);
    if (chaos.join() !== config.chaos.types.join()) changes.push(`chaos ${chaos.join("+") || "off"}`);
    if (scanner !== config.security.scanner) changes.push(`scanner ${scanner ? "on" : "off"}`);
    void c.fork(fromNode, { policy: { absToleranceCents: Math.round(abs * 100), relTolerance: rel / 100, confidenceThreshold: thr }, chaos: { seed, types: chaos }, security: { scanner } }, `Fork @${fromNode}: ${changes.join(", ") || "same parameters"}`);
    onClose();
    c.selectNode(undefined);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Fork this run" wide>
      <p className="text-[13px] text-ink-2">Start a branch from the checkpoint before a node, change parameters, and re-run from there. The original run stays intact for comparison.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-[12px] text-ink-2">
          Re-run from node
          <select value={fromNode} onChange={(e) => setFromNode(Number(e.target.value) as NodeId)} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-[var(--surface-0)] px-2 text-[13px] text-ink">
            {([2, 3, 4, 5, 6, 7] as NodeId[]).map((n) => (
              <option key={n} value={n}>
                {n}. {NODE_NAMES[n]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] text-ink-2">
          Amount tolerance (USD)
          <input type="number" min={0} step={50} value={abs} onChange={(e) => setAbs(Math.max(0, Number(e.target.value)))} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-[var(--surface-0)] px-2 font-mono text-[13px] text-ink" />
        </label>
        <label className="block text-[12px] text-ink-2">
          Relative tolerance (%)
          <input type="number" min={0} max={100} step={0.5} value={rel} onChange={(e) => setRel(Math.max(0, Number(e.target.value)))} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-[var(--surface-0)] px-2 font-mono text-[13px] text-ink" />
        </label>
        <label className="block text-[12px] text-ink-2">
          Confidence threshold: <span className="font-mono text-ink">{thr.toFixed(2)}</span>
          <input type="range" min={0.5} max={0.99} step={0.01} value={thr} onChange={(e) => setThr(Number(e.target.value))} className="mt-2 w-full accent-[var(--agent)]" />
        </label>
      </div>
      <div className="mt-4">
        <div className="text-[12px] text-ink-2">Portal chaos (seed {seed})</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CHAOS_INFO.map((ci) => (
            <button key={ci.type} type="button" aria-pressed={chaos.includes(ci.type)} onClick={() => setChaos((cs) => (cs.includes(ci.type) ? cs.filter((x) => x !== ci.type) : [...cs, ci.type]))} className={cn("chip", chaos.includes(ci.type) && "chip-violet")}>
              {ci.type}
            </button>
          ))}
          <input aria-label="Chaos seed" type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="h-[22px] w-28 rounded-full border border-line-strong bg-transparent px-2 font-mono text-[11px] text-ink" />
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-[12.5px] text-ink-2">
        <input type="checkbox" checked={scanner} onChange={(e) => setScanner(e.target.checked)} className="accent-[var(--agent)]" /> Injection scanner on
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-cyan btn-sm" onClick={go}>
          <GitFork size={14} aria-hidden="true" /> Fork and run
        </button>
      </div>
    </Dialog>
  );
}
