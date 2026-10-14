"use client";
/**
 * Director Mode script. It drives the real engine on Scenario 5 and only
 * decides *when* to show what: scenes start on real revealed events, the
 * HITL decisions come from a clearly labeled scripted operator, and the
 * summary is computed from the run's own events.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConsole, useConsoleState } from "@/components/console/context";
import { SCENARIOS } from "@/engine/data/scenarios";
import type { DecisionChoice, Escalation, HumanDecision } from "@/engine/types";
import { speedFactor, type Speed } from "@/lib/console-store";
import { SCENES, SCENE5_DWELL_MS } from "./scenes";

export const DEMO_OPERATOR = "Demo operator - scripted";

export interface DirectorApi {
  /** 0 before start, then 1 to 6. */
  scene: number;
  started: boolean;
  playing: boolean;
  captions: boolean;
  setCaptions(v: boolean): void;
  play(): void;
  pause(): void;
  toggle(): void;
  goTo(scene: number): void;
  next(): void;
  prev(): void;
  restart(): void;
  /** Stop scripting so a person can take over at the current state. */
  release(): void;
}

function choiceFor(esc: Escalation): DecisionChoice {
  const scripted = SCENARIOS[5].demoDecisions?.[esc.kind];
  if (scripted && esc.options.some((o) => o.choice === scripted)) return scripted;
  return (esc.options.find((o) => o.recommended) ?? esc.options[0]).choice;
}

export function useDirector(enabled: boolean): DirectorApi {
  const c = useConsole();
  const events = useConsoleState((s) => s.events);
  const revealed = useConsoleState((s) => s.revealed);
  const suspension = useConsoleState((s) => s.suspension);
  const speed = useConsoleState((s) => s.speed);
  const held = useConsoleState((s) => s.held);
  const graph = useConsoleState((s) => s.graph);
  const [started, setStarted] = useState(false);
  const [summary, setSummary] = useState(false);
  const [captions, setCaptions] = useState(true);
  const skipTarget = useRef<number | null>(null);
  const restoreSpeed = useRef<Speed>(1);
  const fuzzed = useRef(false);
  /** Checkpoint the scripted operator already submitted (one attempt each; a failure is shown, not retried). */
  const decidedFor = useRef<string | null>(null);
  /** Bumped when fast-forwarding so pending demo timers restart at skip speed. */
  const [skipTick, setSkipTick] = useState(0);

  const shown = useMemo(() => events.slice(0, revealed), [events, revealed]);
  const derived = useMemo(() => {
    if (!started) return 0;
    let k = 1;
    for (const sc of SCENES.slice(1, 5)) if (sc.startsAt(shown) >= 0) k = sc.id;
    return k;
  }, [shown, started]);
  const scene = summary && derived >= 5 ? 6 : derived;
  const suspendedOnScreen = useMemo(() => {
    let susp = -1;
    let res = -1;
    shown.forEach((e, i) => {
      if (e.type === "RUN_SUSPENDED") susp = i;
      else if (e.type === "RUN_RESUMED") res = i;
    });
    return susp > res;
  }, [shown]);

  // Each scene pins its view (the console stops auto-following while directing).
  useEffect(() => {
    if (!enabled || scene === 0) return;
    c.setView(SCENES[scene - 1].view, true);
  }, [enabled, scene, c]);

  // Fast-forward ("next scene") ends once the target scene is on screen.
  useEffect(() => {
    if (skipTarget.current !== null && scene >= skipTarget.current) {
      skipTarget.current = null;
      c.setSpeed(restoreSpeed.current);
    }
  }, [scene, c]);

  // Scene 2: fuzz the synthesized transform for real (300 fast-check cases).
  useEffect(() => {
    if (!enabled || scene !== 2 || fuzzed.current || held) return;
    const file = graph?.n3?.files.find((f) => f.promoted.length > 0);
    if (!file) return;
    const t = setTimeout(() => {
      fuzzed.current = true;
      void c.fuzz(file.fileId);
    }, 1200 / Math.min(4, speedFactor(speed)));
    return () => clearTimeout(t);
  }, [enabled, scene, held, graph, speed, c]);

  // Scene 3: the scripted demo operator decides, visibly and slowly enough to read.
  useEffect(() => {
    if (!enabled || held || !suspension || suspension.status !== "awaiting" || !suspendedOnScreen) return;
    if (suspension.verifyError || decidedFor.current === suspension.checkpoint.id) return;
    const pending = suspension.checkpoint.state.pending;
    if (!pending.length) return;
    const fast = skipTarget.current !== null;
    const f = Math.min(4, speedFactor(speed));
    const first = fast ? 150 : 3200 / f;
    const gap = fast ? 120 : 1600 / f;
    const timers: ReturnType<typeof setTimeout>[] = [];
    pending.forEach((p, i) => {
      timers.push(setTimeout(() => c.store.set((s) => ({ demoChoices: { ...s.demoChoices, [p.id]: choiceFor(p) } })), first + i * gap));
    });
    timers.push(
      setTimeout(
        () => {
          const at = new Date().toISOString();
          const decisions: HumanDecision[] = pending.map((p) => ({ escalationId: p.id, choice: choiceFor(p), operator: DEMO_OPERATOR, note: "Scripted choice in Director Mode", at }));
          decidedFor.current = suspension.checkpoint.id;
          void c.decide(decisions);
        },
        first + pending.length * gap + (fast ? 150 : 1400 / f),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [enabled, held, suspension, suspendedOnScreen, speed, skipTick, c]);

  // Scene 5 looks back at the quarantined invoice, then the summary appears.
  useEffect(() => {
    if (!enabled || derived < 5 || summary || held) return;
    const t = setTimeout(() => setSummary(true), SCENE5_DWELL_MS / Math.min(4, speedFactor(speed)));
    return () => clearTimeout(t);
  }, [enabled, derived, summary, held, speed]);

  const start = useCallback(() => {
    decidedFor.current = null;
    c.selectScenario(5);
    c.resetPortal();
    c.updateConfig((cfg) => ({ ...cfg, demoOperator: DEMO_OPERATOR }));
    c.store.set({ director: true });
    fuzzed.current = false;
    skipTarget.current = null;
    setSummary(false);
    setStarted(true);
    void c.run();
  }, [c]);

  const play = useCallback(() => {
    if (!started || c.s.scenario !== 5 || !c.s.runId) return start();
    c.hold(false);
    if (c.s.graph?.status === "RUNNING" && !c.s.suspension) void c.run();
  }, [c, started, start]);

  const pause = useCallback(() => c.pause(), [c]);

  const goTo = useCallback(
    (target: number) => {
      if (!started) return start();
      const t = Math.max(1, Math.min(6, target));
      if (t === scene) return;
      if (t > scene) {
        if (t === 6 || (scene === 5 && t > 5)) {
          // Everything has run; the summary only waits on scene 5's dwell.
          if (derived >= 5) setSummary(true);
          else {
            skipTarget.current = 5;
            restoreSpeed.current = c.s.speed === "instant" ? 1 : c.s.speed;
            c.setSpeed("instant");
            play();
          }
          return;
        }
        skipTarget.current = t;
        restoreSpeed.current = c.s.speed === "instant" ? 1 : c.s.speed;
        c.setSpeed("instant");
        setSkipTick((n) => n + 1);
        play();
        return;
      }
      // Going back replays the real events from that scene's start.
      setSummary(false);
      if (t >= 5 && derived >= 5) return;
      const startIdx = t === 1 ? 0 : SCENES[t - 1].startsAt(shown);
      const wasRunning = c.s.running;
      c.pause();
      c.scrubTo(Math.max(0, startIdx));
      c.hold(false);
      if (wasRunning && c.s.graph?.status === "RUNNING") void c.run();
    },
    [c, started, start, scene, derived, shown, play],
  );

  const release = useCallback(() => {
    skipTarget.current = null;
    c.store.set({ director: false });
    if (c.s.speed === "instant") c.setSpeed(restoreSpeed.current);
    if (c.s.graph?.status === "RUNNING" && !c.s.suspension) c.pause();
    c.unpinView();
  }, [c]);

  return {
    scene,
    started,
    playing: started && !held && !summary,
    captions,
    setCaptions,
    play,
    pause,
    toggle: () => (started && !held && !summary ? pause() : play()),
    goTo,
    next: () => goTo(scene + 1),
    prev: () => goTo(scene - 1),
    restart: start,
    release,
  };
}
