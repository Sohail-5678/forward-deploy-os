import type { HealingConfig, PolicyConfig, RunConfig, ScenarioId, SecurityToggles } from "./types";
import { CONTRACT_V1, cloneContract } from "./etl/contract";

export const DEFAULT_POLICY: PolicyConfig = {
  absToleranceCents: 25000,
  relTolerance: 0.02,
  confidenceThreshold: 0.85,
};

export const DEFAULT_HEALING: HealingConfig = {
  healThreshold: 0.8,
  askThreshold: 0.6,
  minMargin: 0.05,
};

export const DEFAULT_SECURITY: SecurityToggles = {
  scanner: true,
  spotlighting: true,
  llmPlanner: false,
  hijackedPlanner: false,
  compromisedExtraction: false,
};

export const DEFAULT_FISCAL_WINDOW = { start: "2020-01-01", end: "2027-12-31" } as const;

/** Credentials printed on the fictional 2009 portal's login page. Not real auth. */
export const PORTAL_DEMO_LOGIN = { username: "fde.demo", password: "omnicorp2009" } as const;

export const ENGINE_VERSION = "2.0.0";

export function baseConfig(scenarioId: ScenarioId, seed = 20261014): RunConfig {
  return {
    scenarioId,
    seed,
    mode: "deterministic",
    policy: { ...DEFAULT_POLICY },
    contract: cloneContract(CONTRACT_V1),
    chaos: { seed, types: [] },
    security: { ...DEFAULT_SECURITY },
    healing: { ...DEFAULT_HEALING },
    fiscalWindow: { ...DEFAULT_FISCAL_WINDOW },
    dateOverrides: {},
    baselineFirst: false,
    warmSelectorCache: false,
  };
}
