"use client";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/cn";

// The engine, React Flow and the console load only when the visitor presses Play.
const DirectorOverlay = dynamic(() => import("./DirectorOverlay"), { ssr: false });

/** Opens Director Mode from anywhere on the page (hero button, poster, ?play=1). */
export function useDirectorLauncher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("fdos:play", onOpen);
    if (new URLSearchParams(window.location.search).get("play") === "1") {
      const t = setTimeout(onOpen, 0);
      return () => {
        clearTimeout(t);
        window.removeEventListener("fdos:play", onOpen);
      };
    }
    return () => window.removeEventListener("fdos:play", onOpen);
  }, []);
  return { open, close: () => setOpen(false) };
}

export function PlayDemoButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("fdos:play"))}>
      {children}
    </button>
  );
}

/**
 * The framed player on the landing page, paused on its first frame. The poster
 * is plain HTML rendered on the server (fast first paint); pressing Play runs
 * the real engine on Scenario 5.
 */
export function DirectorPlayer({ poster }: { poster: ReactNode }) {
  const { open, close } = useDirectorLauncher();
  return (
    <>
      <div className="group relative [perspective:1600px]">
        <div aria-hidden="true" className="absolute -inset-10 rounded-[48px] bg-[radial-gradient(60%_60%_at_60%_40%,rgba(0,229,255,0.22),transparent_70%),radial-gradient(60%_60%_at_30%_70%,rgba(110,43,208,0.45),transparent_70%)] blur-2xl" />
        <div className="glass glass-rim glass-sheen relative overflow-hidden rounded-[22px] transition-transform duration-500 [transform:rotateX(7deg)_rotateY(-11deg)_rotateZ(1deg)] [transition-timing-function:var(--ease-out)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_rotateZ(0deg)] motion-reduce:[transform:none]">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
            </span>
            <span className="ml-2 truncate font-mono text-[11px] text-ink-2">Director Mode · Scenario 5 · The Full Gauntlet</span>
            <span className="ml-auto font-mono text-[11px] text-ink-3">6 scenes</span>
          </div>
          <div className="relative">
            {poster}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("fdos:play"))}
              className="absolute inset-0 grid place-items-center bg-[radial-gradient(closest-side,rgba(5,5,5,0.35),transparent)] outline-none"
              aria-label="Play the 90-second demo"
            >
              <span className={cn("grid h-20 w-20 place-items-center rounded-full", "btn-cyan shadow-[0_0_80px_-6px_rgba(0,229,255,0.75)] transition-transform duration-200 group-hover:scale-[1.06]")}>
                <Play size={30} className="translate-x-0.5" fill="currentColor" aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>
      </div>
      {open && <DirectorOverlay onClose={close} />}
    </>
  );
}
