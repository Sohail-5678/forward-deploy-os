"use client";
import type { RefObject } from "react";
import { Shuffle } from "lucide-react";
import { useConsole, useConsoleState } from "../context";
import { Dialog } from "@/components/ui/primitives";
import type { ChaosType } from "@/engine/types";
import { cn } from "@/lib/cn";
import { createRng } from "@/engine/seed";

export const CHAOS_INFO: { type: ChaosType; title: string; what: string; agent: string }[] = [
  { type: "ids", title: "Randomize ids", what: "Every id, name and CSS class changes (#vendor_id becomes #fld_9948x).", agent: "Heal from fingerprints." },
  { type: "labels", title: "Reword labels", what: "\"Vendor ID\" becomes \"Vendor No.\", \"Invoice Total\" becomes \"Total Amt\".", agent: "Heal using synonyms and neighbor text." },
  { type: "reorder", title: "Shuffle fields", what: "Rows inside each tab are shuffled.", agent: "Heal; ordinal weight must not dominate." },
  { type: "nesting", title: "Nest the submit button", what: "The submit button moves into nested table cells.", agent: "Heal by role and label." },
  { type: "interstitial", title: "Session modal", what: "\"Session will expire, click Continue\" appears at a random step.", agent: "Detect the dialog in the distilled tree, dismiss, resume." },
  { type: "latency", title: "Slow responses", what: "Search and submit take 300 to 1500 ms.", agent: "Wait for state, never sleep blindly." },
  { type: "strip-labels", title: "Strip label links", what: "<label for> links are removed; only table-cell text remains.", agent: "Heal from neighbor text." },
];

export function ChaosPanel({ open, onClose, iframe }: { open: boolean; onClose: () => void; iframe?: RefObject<HTMLIFrameElement | null> }) {
  const c = useConsole();
  const chaos = useConsoleState((s) => s.config.chaos);
  const running = useConsoleState((s) => s.running);

  const toggle = (t: ChaosType) =>
    c.updateConfig((cfg) => ({ ...cfg, chaos: { ...cfg.chaos, types: cfg.chaos.types.includes(t) ? cfg.chaos.types.filter((x) => x !== t) : [...cfg.chaos.types, t] } }));

  const applyNow = () => {
    const w = (iframe?.current ?? c.portalFrame())?.contentWindow;
    if (!w) return;
    // Same-origin postMessage to the portal's chaos.js (it checks the origin).
    w.postMessage({ type: "omnicorp:chaos", seed: chaos.seed, types: chaos.types, clear: chaos.types.length === 0 }, window.location.origin);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Inject portal chaos" wide>
      <p className="mb-4 text-[13px] text-ink-2">Simulate the customer’s weekend release. Chaos is seeded: the same seed breaks the page the same way every time. It applies to the next run, or to the portal window right now.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CHAOS_INFO.map((info) => {
          const on = chaos.types.includes(info.type);
          return (
            <button
              key={info.type}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(info.type)}
              disabled={running}
              className={cn("rounded-xl border p-3 text-left transition-[border-color,background-color] duration-150", on ? "border-violet/70 bg-[color-mix(in_oklab,var(--amethyst-500)_16%,transparent)]" : "border-line hover:border-line-strong")}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">{info.title}</span>
                <span className={cn("chip", on ? "chip-violet" : "")}>{on ? "ON" : "OFF"}</span>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">{info.what}</p>
              <p className="mt-1 text-[11.5px] text-agent">Agent: {info.agent}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-ink-2" htmlFor="chaos-seed">
          Seed
        </label>
        <input
          id="chaos-seed"
          type="number"
          min={0}
          value={chaos.seed}
          onChange={(e) => c.updateConfig((cfg) => ({ ...cfg, chaos: { ...cfg.chaos, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) } }))}
          className="h-8 w-36 rounded-lg border border-line-strong bg-white/[0.04] px-2 font-mono text-[12px] text-ink"
        />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => c.updateConfig((cfg) => ({ ...cfg, chaos: { ...cfg.chaos, seed: createRng(cfg.chaos.seed).int(0, 2 ** 31 - 1) } }))}>
          <Shuffle size={12} aria-hidden="true" /> Next seed
        </button>
        <div className="ml-auto flex gap-2">
          {(iframe || c.portalFrame()) && (
            <button type="button" className="btn btn-glass btn-sm" onClick={applyNow} disabled={running}>
              Apply to the portal now
            </button>
          )}
          <button type="button" className="btn btn-cyan btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
