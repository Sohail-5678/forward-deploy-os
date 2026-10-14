"use client";
import { memo, useMemo } from "react";
import { ReactFlow, Handle, Position, BaseEdge, getBezierPath, type Node, type Edge, type NodeProps, type EdgeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CheckCircle2, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useConsole, useConsoleState } from "./context";
import { nodeInfo, NODE_IDS, type NodeInfo } from "@/lib/derive";
import { NODE_NAMES } from "@/engine/agent/runtime";
import type { NodeId } from "@/engine/types";
import { formatMs } from "@/engine/format";
import { cn } from "@/lib/cn";

type PNode = Node<{ n: NodeId; name: string; info: NodeInfo; selected: boolean }, "pipeline">;

const STATUS_ICON = { idle: CircleDashed, running: Loader2, done: CheckCircle2, suspended: PauseCircle, failed: XCircle } as const;
const STATUS_WORD = { idle: "WAITING", running: "RUNNING", done: "DONE", suspended: "PAUSED", failed: "FAILED" } as const;
const STATUS_COLOR = { idle: "text-ink-3", running: "text-agent", done: "text-ok", suspended: "text-warn", failed: "text-danger" } as const;

function countsLine(n: NodeId, info: NodeInfo): string {
  const c = info.counts;
  if (!c) return "";
  switch (n) {
    case 1:
      return `${c.docs} docs · ${c.quarantined} quarantined`;
    case 2:
      return `${c.errors} drift errors · ${c.quarantinedRows} rows held`;
    case 3:
      return `${c.promoted} promoted · ${c.invariantsPassed} checks passed`;
    case 4:
      return `${c.reconciled} reconciled · ${c.withHits} flagged`;
    case 5:
      return `${c.approved} approved · ${c.pending} waiting`;
    case 6:
      return c.rawTokens ? `${c.rawTokens} → ${c.distilledTokens} tokens` : `${c.nodes} nodes`;
    case 7:
      return `${c.posted} posted · ${c.healed} healed · ${c.blocked} blocked`;
    case 8:
      return `${c.auditEntries} audit entries`;
  }
}

const PipelineNodeView = memo(function PipelineNodeView({ data }: NodeProps<PNode>) {
  const { n, name, info, selected } = data;
  const Icon = STATUS_ICON[info.status];
  return (
    <div
      className={cn(
        "group relative w-[246px] rounded-[14px] border bg-[var(--surface-1)]/90 px-3 py-2 transition-[transform,box-shadow] duration-200",
        info.status === "running" && "rail-running",
        info.status === "done" && "rail-done",
        info.status === "suspended" && "rail-suspended",
        info.status === "failed" && "rail-failed",
        info.status === "idle" && "border-line",
        selected ? "border-agent/70" : "border-line",
      )}
      aria-label={`Node ${n}, ${name}: ${STATUS_WORD[info.status].toLowerCase()}${info.ms !== undefined ? `, ${formatMs(info.ms)}` : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <div className="flex items-center gap-2.5">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg border font-mono text-[11px] font-semibold", info.status === "idle" ? "border-line text-ink-3" : "border-line-strong text-ink")}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-2 tabular">{info.ms !== undefined ? formatMs(info.ms) : ""}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-flex shrink-0 items-center gap-1 text-[9.5px] font-bold tracking-wider", STATUS_COLOR[info.status])}>
              <Icon size={10} className={info.status === "running" ? "animate-spin" : undefined} aria-hidden="true" />
              {STATUS_WORD[info.status]}
            </span>
            <span className="truncate font-mono text-[10.5px] text-ink-3 tabular">{countsLine(n, info)}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
    </div>
  );
});

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<{ active: boolean; done: boolean }>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const active = data?.active;
  const done = data?.done;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: done ? "color-mix(in oklab, var(--ok) 55%, transparent)" : "rgba(184,139,255,0.22)", strokeWidth: 1.5 }} />
      {active && <path d={path} className="edge-flow" fill="none" stroke="var(--agent)" strokeWidth={2.2} style={{ filter: "drop-shadow(0 0 6px var(--agent))" }} />}
    </>
  );
}

const nodeTypes = { pipeline: PipelineNodeView };
const edgeTypes = { flow: FlowEdge };

export function PipelineGraph() {
  const c = useConsole();
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const selected = useConsoleState((s) => s.selectedNode);
  const info = useMemo(() => nodeInfo(events.slice(0, revealed)), [events, revealed]);

  const nodes: PNode[] = useMemo(
    () =>
      NODE_IDS.map((n, i) => ({
        id: String(n),
        type: "pipeline",
        position: { x: i % 2 === 0 ? 0 : 16, y: i * 68 },
        data: { n, name: NODE_NAMES[n], info: info[n], selected: selected === n },
        draggable: false,
        connectable: false,
      })),
    [info, selected],
  );
  const edges: Edge<{ active: boolean; done: boolean }>[] = useMemo(
    () =>
      NODE_IDS.slice(0, -1).map((n) => {
        const next = (n + 1) as NodeId;
        return {
          id: `e${n}`,
          source: String(n),
          target: String(next),
          type: "flow",
          data: { active: info[n].status === "done" && (info[next].status === "running" || info[next].status === "suspended"), done: info[n].status === "done" && info[next].status === "done" },
        };
      }),
    [info],
  );

  return (
    <div className="relative h-full min-h-[300px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
        minZoom={0.4}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        onNodeClick={(_, node) => c.selectNode(Number(node.id) as NodeId)}
        aria-label="Pipeline graph"
      />
    </div>
  );
}

/** Compact horizontal stepper used below 1280px. */
export function PipelineStepper() {
  const c = useConsole();
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const info = useMemo(() => nodeInfo(events.slice(0, revealed)), [events, revealed]);
  return (
    <ol className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin" aria-label="Pipeline">
      {NODE_IDS.map((n) => {
        const Icon = STATUS_ICON[info[n].status];
        return (
          <li key={n}>
            <button type="button" onClick={() => c.selectNode(n)} className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px]", info[n].status === "running" ? "border-agent/60 text-agent" : info[n].status === "suspended" ? "border-warn/60 text-warn" : info[n].status === "done" ? "border-ok/40 text-ok" : "border-line text-ink-3")}>
              <Icon size={12} aria-hidden="true" className={info[n].status === "running" ? "animate-spin" : undefined} />
              <span className="font-mono">{n}</span> {NODE_NAMES[n]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
