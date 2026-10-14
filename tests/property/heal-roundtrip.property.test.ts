import { describe, expect, it } from "vitest";
import { parseCsv } from "@/engine/etl/csv";
import { healFile } from "@/engine/etl/schema-healer";
import { CONTRACT_V1 } from "@/engine/etl/contract";
import { renderCsv, SCENARIOS } from "@/engine/data/scenarios";
import { fuzzTransform } from "@/workers/fuzz";

/** The same property test the console runs in the browser ("Fuzz this transform"). */
describe("healing round trip (fast-check)", () => {
  for (const [id, file] of [
    [1, SCENARIOS[1].csv[0]],
    [2, SCENARIOS[2].csv[0]],
    [5, SCENARIOS[5].csv[0]],
  ] as const) {
    it(`scenario ${id}: ${file.name} spec heals 300 random records exactly`, () => {
      const table = parseCsv(renderCsv(file), file.id);
      const healed = healFile(table, CONTRACT_V1, { fileName: file.name, fiscalWindow: { start: "2020-01-01", end: "2027-12-31" }, ledger: [] });
      const r = fuzzTransform(healed.spec, CONTRACT_V1, 300, 20261014, () => undefined);
      expect(r.counterexample, JSON.stringify(r.counterexample)).toBeUndefined();
      expect(r.failed).toBe(false);
      expect(r.passed).toBe(300);
    });
  }
});
