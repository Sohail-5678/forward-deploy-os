"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Loader2, PauseCircle, ShieldAlert, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="shrink-0 drop-shadow-[0_0_12px_rgba(0,229,255,0.35)]">
        <defs>
          <radialGradient id="fd-orb" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#d9c2ff" />
            <stop offset="0.45" stopColor="#6e2bd0" />
            <stop offset="1" stopColor="#1e0638" />
          </radialGradient>
        </defs>
        <circle cx="16" cy="16" r="8.5" fill="url(#fd-orb)" />
        <ellipse cx="16" cy="16" rx="13.5" ry="5" fill="none" stroke="#00e5ff" strokeWidth="1.6" transform="rotate(-28 16 16)" />
        <circle cx="26.2" cy="10.4" r="1.9" fill="#00e5ff" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="font-display text-[19px] tracking-tight text-ink">ForwardDeploy</span>
          <span className="ml-1 font-mono text-[11px] font-semibold tracking-[0.2em] text-agent">OS</span>
        </span>
      )}
    </span>
  );
}

export type Status = "idle" | "running" | "done" | "suspended" | "failed" | "blocked" | "healed" | "quarantined" | "passed" | "warn" | "info";

const STATUS: Record<Status, { word: string; cls: string; Icon: typeof CheckCircle2 }> = {
  idle: { word: "WAITING", cls: "", Icon: CircleDashed },
  running: { word: "RUNNING", cls: "chip-agent", Icon: Loader2 },
  done: { word: "DONE", cls: "chip-ok", Icon: CheckCircle2 },
  passed: { word: "PASSED", cls: "chip-ok", Icon: CheckCircle2 },
  healed: { word: "HEALED", cls: "chip-ok", Icon: Sparkles },
  suspended: { word: "PAUSED", cls: "chip-warn", Icon: PauseCircle },
  warn: { word: "WARNING", cls: "chip-warn", Icon: AlertTriangle },
  failed: { word: "FAILED", cls: "chip-danger", Icon: XCircle },
  blocked: { word: "BLOCKED", cls: "chip-danger", Icon: Ban },
  quarantined: { word: "QUARANTINED", cls: "chip-danger", Icon: ShieldAlert },
  info: { word: "INFO", cls: "chip-violet", Icon: ShieldCheck },
};

/** Status always carries an icon and a word, not just a color. */
export function StatusChip({ status, word, className }: { status: Status; word?: string; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("chip", s.cls, className)}>
      <s.Icon size={12} aria-hidden="true" className={status === "running" ? "animate-spin" : undefined} />
      {word ?? s.word}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, size = "sm" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: "xs" | "sm" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-full border border-line-strong bg-white/[0.03] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full font-mono tabular transition-[background-color,color] duration-150",
              size === "xs" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]",
              active ? "bg-agent text-[var(--on-cyan)] shadow-[0_0_18px_-4px_var(--agent)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, locked, description }: { checked: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean; locked?: boolean; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || locked}
        disabled={disabled || locked}
        onClick={() => onChange?.(!checked)}
        title={locked ? "This layer is code, not a model. It can't be turned off." : undefined}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200",
          checked ? "border-transparent bg-agent/90" : "border-line-strong bg-white/[0.06]",
          locked && "cursor-not-allowed opacity-90",
          disabled && !locked && "opacity-40",
        )}
      >
        <span
          className={cn("absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200 [transition-timing-function:var(--ease-out)]", checked ? "translate-x-[22px]" : "translate-x-0.5")}
          aria-hidden="true"
        />
        {locked && <span className="sr-only">Locked on</span>}
      </button>
    </div>
  );
}

/** Small radial gauge for calibrated confidence. */
export function Gauge({ value, threshold, size = 64, label = "confidence" }: { value: number; threshold?: number; size?: number; label?: string }) {
  const r = size / 2 - 6;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = threshold !== undefined && v < threshold ? "var(--warn)" : "var(--ok)";
  const tAngle = threshold !== undefined ? Math.PI * (1 - threshold) : 0;
  return (
    <div className="inline-flex flex-col items-center" role="img" aria-label={`${label} ${v.toFixed(2)}${threshold !== undefined ? `, threshold ${threshold.toFixed(2)}` : ""}`}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        <path d={`M 6 ${size / 2} A ${r} ${r} 0 0 1 ${size - 6} ${size / 2}`} fill="none" stroke="var(--border-strong)" strokeWidth="6" strokeLinecap="round" />
        <path d={`M 6 ${size / 2} A ${r} ${r} 0 0 1 ${size - 6} ${size / 2}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        {threshold !== undefined && (
          <line x1={size / 2 + Math.cos(tAngle) * (r - 9)} y1={size / 2 - Math.sin(tAngle) * (r - 9)} x2={size / 2 + Math.cos(tAngle) * (r + 5)} y2={size / 2 - Math.sin(tAngle) * (r + 5)} stroke="var(--text-2)" strokeWidth="2" />
        )}
      </svg>
      <span className="-mt-3 font-mono text-[13px] font-semibold tabular text-ink">{v.toFixed(2)}</span>
    </div>
  );
}

/** Accessible modal dialog: focus moves in, Escape closes, focus returns. */
export function Dialog({ open, onClose, title, children, wide, labelledBy, className }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean; labelledBy?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-autofocus], button, input, textarea, select")?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px] [animation:fade-in_160ms_ease]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        className={cn("glass glass-strong glass-rim relative max-h-[88dvh] w-full overflow-auto rounded-[20px] p-5 scroll-thin [animation:dialog-in_220ms_var(--ease-out)]", wide ? "max-w-5xl" : "max-w-xl", className)}
      >
        {title && (
          <h2 id={titleId} className="display mb-3 text-[28px] text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, side = "right", width = "max-w-[560px]" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: "right" | "left"; width?: string }) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    // Focus moves into the drawer and returns to the trigger when it closes.
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(), 10);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/40 [animation:fade-in_160ms_ease]" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("glass glass-strong glass-rim absolute top-2 bottom-2 flex w-[calc(100%-1rem)] flex-col overflow-hidden rounded-[20px]", width, side === "right" ? "right-2 [animation:drawer-in-right_280ms_var(--ease-drawer)]" : "left-2 [animation:drawer-in-left_280ms_var(--ease-drawer)]")}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="display text-[26px] text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" data-autofocus>
            Close <Kbd>Esc</Kbd>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 scroll-thin">{children}</div>
      </aside>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("eyebrow", className)}>{children}</div>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center">
      {icon && <div className="text-lilac">{icon}</div>}
      <h3 className="display text-[26px] text-ink">{title}</h3>
      {children && <p className="max-w-md text-[13px] leading-relaxed text-ink-2">{children}</p>}
      {action}
    </div>
  );
}
