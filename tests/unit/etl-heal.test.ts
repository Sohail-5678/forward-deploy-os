import { describe, expect, it } from "vitest";
import { parseCsv } from "@/engine/etl/csv";
import { detectDrift, healFile, describeRecipe } from "@/engine/etl/schema-healer";
import { CONTRACT_V1 } from "@/engine/etl/contract";
import { renderScenarioCsvFiles, SCENARIOS } from "@/engine/data/scenarios";
import { DEFAULT_FISCAL_WINDOW } from "@/engine/config";

const fiscalWindow = { ...DEFAULT_FISCAL_WINDOW };

describe("Scenario 1: Apex export changed overnight", () => {
  const def = SCENARIOS[1];
  const file = def.csv[0];
  const csv = renderScenarioCsvFiles(1)[file.path];
  const table = parseCsv(csv, file.id);

  it("parses the drifted export with quoted currency strings", () => {
    expect(table.headers).toContain("gross_inv_val");
    expect(table.rows).toHaveLength(6);
    expect(table.rows[0].gross_inv_val).toBe("$18,450.00 USD");
    expect(table.rows[0].dt_issued).toBe("14.10.2026");
    expect(table.rows[0].vat_pct).toBe("8.25%");
  });

  it("node 2 reports drift and quarantines all 6 rows", () => {
    const drift = detectDrift(table, CONTRACT_V1);
    const missing = drift.errors.filter((e) => e.code === "MISSING_REQUIRED_COLUMN");
    expect(missing).toHaveLength(7);
    expect(drift.errors.some((e) => e.code === "DATE_FORMAT_DRIFT" && e.column === "dt_issued")).toBe(true);
    expect(drift.errors.some((e) => e.code === "CURRENCY_STRING_CONTAMINATION" && e.column === "gross_inv_val")).toBe(true);
    expect(drift.errors.some((e) => e.code === "PERCENT_STRING" && e.column === "vat_pct")).toBe(true);
    expect(drift.quarantined).toHaveLength(6);
    expect(drift.quarantined[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("node 3 heals: maps every field, passes 5/5 invariants, promotes 6 exact records", () => {
    const healed = healFile(table, CONTRACT_V1, { ledger: [], fiscalWindow });
    const byTarget = Object.fromEntries(healed.spec.mappings.map((m) => [m.target, m.source]));
    expect(byTarget).toEqual({
      vendor_id: "supplier_code",
      customer_id: "client_ref_no",
      po_number: "procurement_doc_id",
      invoice_number: "invoice_number",
      invoice_date: "dt_issued",
      gross_amount_usd: "gross_inv_val",
      tax_rate: "vat_pct",
      line_items_count: "line_items_count",
      payee_iban: "beneficiary_acct",
    });
    expect(healed.spec.unmappedSource).toEqual(["memo"]);
    expect(healed.invariants.map((i) => [i.name, i.passed])).toEqual([
      ["ROW_COUNT_CONSERVED", true],
      ["MONEY_SUM_CONSERVED", true],
      ["PRIMARY_KEY_VALID", true],
      ["DATES_IN_WINDOW", true],
      ["IDEMPOTENT", true],
    ]);
    expect(healed.promoted).toHaveLength(6);
    healed.promoted.forEach((p, i) => expect(p.invoice).toEqual(file.records[i]));
    const recipe = healed.spec.mappings.find((m) => m.target === "customer_id")!;
    expect(describeRecipe(recipe)).toBe("client_ref_no → customer_id · trim · upper");
    for (const m of healed.spec.mappings) expect(m.score).toBeGreaterThanOrEqual(0.55);
  });
});

describe("Scenario 5: ambiguous dates are never guessed", () => {
  const file = SCENARIOS[5].csv.find((f) => f.id === "medcore-export-wk42")!;
  const table = parseCsv(renderScenarioCsvFiles(5)[file.path], file.id);

  it("raises AMBIGUOUS_DATE_FORMAT and keeps rows quarantined", () => {
    const drift = detectDrift(table, CONTRACT_V1);
    expect(drift.errors.some((e) => e.code === "AMBIGUOUS_DATE_FORMAT")).toBe(true);
    const healed = healFile(table, CONTRACT_V1, { ledger: [], fiscalWindow });
    expect(healed.spec.dateDecision?.status).toBe("ambiguous");
    expect(healed.awaitingDecision).toBe(true);
    expect(healed.promoted).toHaveLength(0);
    expect(healed.quarantined).toHaveLength(2);
  });

  it("heals once a human picks the format", () => {
    const healed = healFile(table, CONTRACT_V1, { ledger: [], fiscalWindow, dateOverride: "DD/MM/YYYY" });
    expect(healed.promoted.map((p) => p.invoice.invoice_date)).toEqual(["2026-04-03", "2026-06-05"]);
    const mdy = healFile(table, CONTRACT_V1, { ledger: [], fiscalWindow, dateOverride: "MM/DD/YYYY" });
    expect(mdy.promoted.map((p) => p.invoice.invoice_date)).toEqual(["2026-03-04", "2026-05-06"]);
  });
});
