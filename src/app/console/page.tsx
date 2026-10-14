import type { Metadata } from "next";
import { ConsoleApp } from "@/components/console/ConsoleApp";
import type { ScenarioId } from "@/engine/types";

export const metadata: Metadata = {
  title: "Console",
  description: "Run the five scenarios or your own files through the 8-node pipeline: heal drifted exports, stop for a human, drive the 2009 portal, and verify the audit chain.",
};

type Search = Record<string, string | string[] | undefined>;

function parseScenario(v: string | string[] | undefined): ScenarioId | undefined {
  if (v === "sandbox") return "sandbox";
  if (typeof v === "string" && /^[1-5]$/.test(v)) return Number(v) as 1 | 2 | 3 | 4 | 5;
  return undefined;
}

function parseStep(v: string | string[] | undefined): number | undefined {
  const n = typeof v === "string" && /^[1-8]$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
}

/** `/console?scenario=2&step=5` opens Scenario 2 and runs it up to node 5 (used by the README and Slack messages). */
export default async function ConsolePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return <ConsoleApp initialScenario={parseScenario(sp.scenario)} initialStep={parseStep(sp.step)} />;
}
