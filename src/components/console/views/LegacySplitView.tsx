"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, FileCode2, Loader2, Plug, RotateCcw, Tornado, XCircle } from "lucide-react";
import { useConsole, useConsoleState } from "../context";
import { lastOfType, ofType } from "@/lib/derive";
import { createIframeDriver, PORTAL_BASE } from "@/lib/iframe-driver";
import { runBaselineScript } from "@/engine/browser/baseline";
import { compilePython, compileTypeScript, MCP_SETUP } from "@/engine/browser/playwright-compiler";
import type { ApprovedRecord, BaselineResult, SelectorCacheEntry } from "@/engine/types";
import { SCENARIOS, ERP_PURCHASE_ORDERS } from "@/engine/data/scenarios";
import { idempotencyKey } from "@/engine/etl/idempotency";
import recorded from "@/engine/data/selector-cache.v42.json";
import { Dialog, StatusChip, Segmented } from "@/components/ui/primitives";
import { Code } from "@/components/ui/Code";
import { ChaosPanel } from "./ChaosPanel";
import { cn } from "@/lib/cn";

const NATURAL_W = 980;
const NATURAL_H = 660;

export function LegacySplitView({ active }: { active: boolean }) {
  const c = useConsole();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.62);
  const [url, setUrl] = useState(PORTAL_BASE + "index.html");
  const { events, revealed } = useConsoleState((s) => ({ events: s.events, revealed: s.revealed }));
  const cursor = useConsoleState((s) => s.cursor);
  const graph = useConsoleState((s) => s.graph);
  const running = useConsoleState((s) => s.running);
  const [baseline, setBaseline] = useState<BaselineResult | "running" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [chaosOpen, setChaosOpen] = useState(false);
  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);

  useEffect(() => {
    c.attachIframe(iframeRef.current);
    return () => c.attachIframe(null);
  }, [c]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / NATURAL_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const href = iframeRef.current?.contentWindow?.location.pathname;
        if (href) setUrl(href);
      } catch {
        /* cross-origin never happens here */
      }
    }, 400);
    return () => clearInterval(t);
  }, []);

  const distilled = lastOfType(shown, "DOM_DISTILLED");
  const meter = useMemo(() => [...ofType(shown, "DOM_DISTILLED")].reverse().find((e) => e.payload.rawTokens > 0)?.payload, [shown]);
  const lastAction = lastOfType(shown, "ACTION_EXECUTED")?.payload.action;
  const heals = ofType(shown, "SELECTOR_HEALED").map((e) => e.payload);
  const blocked = ofType(shown, "GUARD_BLOCKED").map((e) => e.payload);
  const baselineEvent = lastOfType(shown, "BASELINE_RUN")?.payload;
  const activeLine = distilled?.payload.selectors && lastAction ? distilled.payload.selectors.indexOf(lastAction.selectorUsed) : -1;
  const healedBySelector = new Map(heals.map((h) => [h.to, h]));

  const sampleRecord = (): ApprovedRecord => {
    const a = graph?.n5?.approved[0];
    if (a) return a;
    const inv = SCENARIOS[3].csv[0].records[0];
    const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === inv.po_number)!;
    return { recordId: "baseline", invoice: inv, idempotencyKey: idempotencyKey(inv), approval: "auto", costCenter: po.cost_center };
  };

  const runBaseline = async () => {
    setBaseline("running");
    const driver = createIframeDriver(() => iframeRef.current);
    setBaseline(await runBaselineScript(driver, sampleRecord(), 1500));
  };

  const resetPortal = () => c.resetPortal();

  const baselineShown = baselineEvent ?? (baseline !== "running" ? baseline : null);

  return (
    <div className={cn("h-full min-h-0 flex-col gap-3 p-3", active ? "flex" : "hidden")} aria-hidden={!active}>
      <div className="flex flex-wrap items-center gap-2">
        <TokenMeter raw={meter?.rawTokens} distilled={meter?.distilledTokens} ratio={meter?.ratio} page={meter?.page} />
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" className="btn btn-amethyst btn-xs" onClick={() => setChaosOpen(true)} disabled={running}>
            <Tornado size={13} aria-hidden="true" /> Inject portal chaos
          </button>
          <button type="button" className="btn btn-glass btn-xs" onClick={() => void runBaseline()} disabled={running || baseline === "running"}>
            {baseline === "running" ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Bug size={13} aria-hidden="true" />} Run baseline script
          </button>
          <button type="button" className="btn btn-glass btn-xs" onClick={() => setExportOpen(true)}>
            <FileCode2 size={13} aria-hidden="true" /> Export Playwright
          </button>
          <button type="button" className="btn btn-glass btn-xs" onClick={() => setMcpOpen(true)}>
            <Plug size={13} aria-hidden="true" /> MCP server
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={resetPortal} disabled={running} title="Clear the portal ledger and session">
            <RotateCcw size={13} aria-hidden="true" /> Reset portal data
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* The 2009 portal in a period window frame */}
        <div className="min-h-0 overflow-hidden rounded-[10px] border border-[#3c5a8c] bg-[#d4d0c8] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#0a246a] via-[#2a5bb8] to-[#a6caf0] px-2 py-1 text-[11px] font-bold text-white" style={{ fontFamily: "Tahoma, Verdana, sans-serif" }}>
            <span className="h-3 w-3 rounded-sm bg-[#f5c542]" aria-hidden="true" />
            <span className="truncate">OmniCorp Enterprise Resource Portal — Microsoft Internet Explorer</span>
            <span className="ml-auto flex gap-0.5" aria-hidden="true">
              {["_", "□", "×"].map((ch) => (
                <span key={ch} className="grid h-4 w-4 place-items-center rounded-[2px] border border-white/60 bg-[#d4d0c8] text-[9px] text-black">
                  {ch}
                </span>
              ))}
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-[#808080] bg-[#ece9d8] px-2 py-1 text-[11px] text-black" style={{ fontFamily: "Tahoma, Verdana, sans-serif" }}>
            <span className="text-[#555]">Address</span>
            <span className="flex-1 truncate border border-[#7f9db9] bg-white px-1.5 py-0.5 font-mono text-[10.5px]">http://omnicorp-erp.internal{url}</span>
          </div>
          <div ref={boxRef} className="relative w-full overflow-hidden bg-[#d4d0c8]" style={{ height: NATURAL_H * scale }}>
            <iframe
              ref={iframeRef}
              src={PORTAL_BASE + "index.html"}
              title="OmniCorp 2009 legacy portal (the agent operates this page)"
              className="absolute left-0 top-0 origin-top-left border-0 bg-white"
              style={{ width: NATURAL_W, height: NATURAL_H, transform: `scale(${scale})` }}
            />
            <AgentOverlay cursor={cursor} scale={scale} />
          </div>
        </div>

        {/* Distilled tree */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-[var(--surface-0)]/70">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h3 className="eyebrow">What the agent reads</h3>
            <span className="font-mono text-[11px] text-ink-3">{distilled ? `${distilled.payload.page} · ${distilled.payload.nodeCount} nodes` : "no page yet"}</span>
          </div>
          <ol className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11.5px] leading-[1.55] scroll-thin" aria-label="Distilled accessibility tree">
            {(distilled?.payload.lines ?? []).map((line, i) => {
              const sel = distilled?.payload.selectors?.[i];
              const heal = sel ? healedBySelector.get(sel) : undefined;
              return (
                <li key={i} className={cn("fade-up px-3", i === activeLine && "bg-[color-mix(in_oklab,var(--agent)_14%,transparent)] text-agent shadow-[inset_2px_0_0_var(--agent)]", i !== activeLine && "text-ink-2")} style={{ ["--delay" as string]: `${Math.min(i, 30) * 18}ms` }}>
                  <span className="whitespace-pre-wrap break-all">{line}</span>
                  {heal && (
                    <span className="ml-2 text-[10.5px]">
                      <s className="text-danger/80">{heal.from}</s> <span className="text-ok">→ {heal.to.slice(0, 22)}</span> <span className="text-ink-3">({heal.similarity.toFixed(2)})</span>
                    </span>
                  )}
                </li>
              );
            })}
            {!distilled && <li className="px-3 py-6 font-sans text-[12.5px] text-ink-3">When the run reaches node 6, the portal page appears here as a numbered text map: one line per interactive element, no styles or layout.</li>}
          </ol>
          {(baselineShown || blocked.length > 0) && (
            <div className="space-y-2 border-t border-line p-3">
              {baselineShown && (
                <div className={cn("rounded-lg border p-2 text-[12px]", baselineShown.ok ? "border-ok/40 text-ok" : "border-danger/50 bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] text-danger")}>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <XCircle size={13} aria-hidden="true" /> Recorded baseline script {baselineShown.ok ? "passed (dry run, no submit)" : "failed"}
                  </div>
                  {!baselineShown.ok && <div className="mt-0.5 font-mono text-[11px]">{baselineShown.error}</div>}
                </div>
              )}
              {blocked.slice(-3).map((b, i) => (
                <div key={i} className="rounded-lg border border-danger/50 p-2 text-[11.5px] text-danger">
                  <StatusChip status="blocked" /> <span className="font-mono">{b.reasons[0]}</span>
                </div>
              ))}
            </div>
          )}
          {graph?.n7?.chaosReport && graph.n7.chaosReport.length > 0 && revealed === events.length && (
            <div className="border-t border-line p-3">
              <h4 className="eyebrow mb-1.5">Chaos report</h4>
              <table className="w-full text-[11.5px]">
                <tbody>
                  {graph.n7.chaosReport.map((r) => (
                    <tr key={r.type} className="border-t border-white/[0.04]">
                      <td className="py-1 font-mono text-ink">{r.type}</td>
                      <td className="py-1">
                        <StatusChip status={r.handled ? "healed" : r.observed ? "failed" : "idle"} word={r.handled ? "HANDLED" : r.observed ? "NOT HANDLED" : "NOT SEEN"} />
                      </td>
                      <td className="py-1 text-ink-3">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ChaosPanel open={chaosOpen} onClose={() => setChaosOpen(false)} iframe={iframeRef} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <Dialog open={mcpOpen} onClose={() => setMcpOpen(false)} title="Use the portal from Claude (MCP)" wide>
        <p className="text-[13px] text-ink-2">
          The repository ships a real MCP server (stdio) with three tools: <code className="font-mono text-agent">search_purchase_order</code>, <code className="font-mono text-agent">get_invoice_form_schema</code> and{" "}
          <code className="font-mono text-agent">submit_invoice</code>. Every submission runs the same Zod validation, policy checks and tool boundary guard, then drives the portal with Playwright.
        </p>
        <h3 className="eyebrow mt-4 mb-1.5">Claude Code (run in the project folder)</h3>
        <Code code={MCP_SETUP.claudeCode} lang="bash" />
        <h3 className="eyebrow mt-4 mb-1.5">Claude Desktop config (use the absolute path to your checkout)</h3>
        <Code code={MCP_SETUP.claudeDesktop} lang="json" />
        <p className="mt-3 text-[12px] text-ink-3">The server needs the site running locally (npm run dev) so Playwright can reach the portal at PORTAL_URL.</p>
      </Dialog>
    </div>
  );
}

function TokenMeter({ raw, distilled, ratio, page }: { raw?: number; distilled?: number; ratio?: number; page?: string }) {
  const max = Math.max(raw ?? 1, 1);
  return (
    <div className="flex min-w-[320px] flex-1 items-center gap-3 rounded-xl border border-line bg-[var(--surface-0)]/60 px-3 py-2" aria-label="Token meter">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-[72px] text-[11px] text-ink-3">Raw HTML</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-gradient-to-r from-[var(--amethyst-500)] to-[var(--amethyst-300)] transition-[width] duration-500" style={{ width: raw ? "100%" : "0%" }} />
          </div>
          <span className="w-16 text-right font-mono text-[11px] tabular text-ink-2">{raw ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-[72px] text-[11px] text-ink-3">Distilled</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-agent shadow-[0_0_10px_var(--agent)] transition-[width] duration-500" style={{ width: raw && distilled ? `${Math.max(1.5, (distilled / max) * 100)}%` : "0%" }} />
          </div>
          <span className="w-16 text-right font-mono text-[11px] tabular text-ink-2">{distilled ?? "—"}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="display iridescent text-[30px] leading-none">{ratio ? `${ratio}x` : "—"}</div>
        <div className="text-[10px] text-ink-3">{page ? `smaller · ${page}` : "o200k tokens (proxy)"}</div>
      </div>
    </div>
  );
}

function AgentOverlay({ cursor, scale }: { cursor?: { x: number; y: number; w: number; h: number; label: string; kind: string; at: number }; scale: number }) {
  if (!cursor) return null;
  const x = cursor.x * scale;
  const y = cursor.y * scale;
  const w = Math.max(cursor.w * scale, 12);
  const h = Math.max(cursor.h * scale, 10);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        className="absolute rounded-[6px] border-2 border-agent shadow-[0_0_0_4px_rgba(0,229,255,0.18),0_0_24px_rgba(0,229,255,0.55)] transition-[transform,width,height] duration-200 [transition-timing-function:var(--ease-in-out)]"
        style={{ transform: `translate(${x - 3}px, ${y - 3}px)`, width: w + 6, height: h + 6 }}
      />
      <div className="absolute transition-transform duration-200 [transition-timing-function:var(--ease-in-out)]" style={{ transform: `translate(${x + w - 6}px, ${y + h - 4}px)` }}>
        <svg width="18" height="20" viewBox="0 0 18 20">
          <path d="M1 1 L16 9 L9 11 L6 18 Z" fill="var(--cyan)" stroke="#031417" strokeWidth="1.2" />
        </svg>
        <span className="ml-3 inline-block -translate-y-1 whitespace-nowrap rounded-full bg-[#031417]/90 px-2 py-0.5 font-mono text-[10px] text-agent ring-1 ring-agent/50">
          {cursor.kind} · {cursor.label.slice(0, 28)}
        </span>
      </div>
    </div>
  );
}

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const graph = useConsoleState((s) => s.graph);
  const [lang, setLang] = useState<"ts" | "py">("ts");
  const records = graph?.n5?.approved ?? [];
  const cache = (graph?.n7?.selectorCache?.length ? graph.n7.selectorCache : (recorded as { entries: SelectorCacheEntry[] }).entries) as SelectorCacheEntry[];
  const input = { records, cache, runId: graph?.runId ?? "no-run", generatedAt: new Date().toISOString().slice(0, 19) + "Z" };
  return (
    <Dialog open={open} onClose={onClose} title="Export this run as Playwright" wide>
      <p className="mb-3 text-[13px] text-ink-2">
        {records.length ? `${records.length} approved record(s) from this run.` : "No approved records yet: run a scenario to node 5 first."} Locators try role and label first, then fingerprint healing in the page. CI runs both scripts against the portal.
      </p>
      <Segmented label="Language" value={lang} onChange={setLang} options={[{ value: "ts", label: "TypeScript" }, { value: "py", label: "Python" }]} />
      <div className="mt-3">{open && (lang === "ts" ? <Code code={compileTypeScript(input)} lang="typescript" filename="forwarddeploy-run.ts" maxHeight={480} /> : <Code code={compilePython(input)} lang="python" filename="forwarddeploy_run.py" maxHeight={480} />)}</div>
    </Dialog>
  );
}
