"use client";
import { useEffect, useState } from "react";
import { ConsoleApp } from "@/components/console/ConsoleApp";
import { createConsole, useControllerLifetime } from "@/lib/console-store";

/**
 * Director Mode opened in place over the landing page. "Take control" turns
 * the same live run into the full console (same engine, same portal iframe),
 * so the visitor continues exactly where the demo was.
 */
export default function DirectorOverlay({ onClose }: { onClose: () => void }) {
  const [c] = useState(() => createConsole());
  const [mode, setMode] = useState<"director" | "console">("director");
  useControllerLifetime(c, true);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const close = () => {
    void c.stop();
    window.history.replaceState(null, "", "/");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-bg" role="dialog" aria-modal="true" aria-label={mode === "director" ? "Director Mode: the 90-second guided demo" : "ForwardDeploy OS console"}>
      <ConsoleApp
        controller={c}
        mode={mode}
        autoStart
        onTakeControl={() => {
          setMode("console");
          window.history.replaceState(null, "", "/console?scenario=5");
        }}
        onExit={close}
      />
    </div>
  );
}
