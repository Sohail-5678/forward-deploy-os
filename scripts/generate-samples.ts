/**
 * Generates every scenario sample file from fixed definitions (rule S5) and
 * the legacy portal's ERP data file. Output is committed.
 *   npm run samples
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SCENARIOS, renderCsv, ERP_PURCHASE_ORDERS, VENDOR_MASTER, COST_CENTERS, HISTORICAL_LEDGER, type PdfSpec } from "../src/engine/data/scenarios";
import { buildInvoicePdf } from "./lib/pdf-invoice";
import { sha256Hex } from "../src/engine/hash";
import { generateDriftedFile } from "../src/engine/data/generators";
import { createRng } from "../src/engine/seed";

const ROOT = join(process.cwd(), "public");

async function write(path: string, data: string | Uint8Array) {
  const full = join(ROOT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return full;
}

async function main() {
  const manifest: { scenario: number; path: string; kind: string; sha256: string; bytes: number }[] = [];
  for (const def of Object.values(SCENARIOS)) {
    for (const f of def.csv) {
      const text = renderCsv(f);
      await write(`samples/${f.path}`, text);
      manifest.push({ scenario: def.id, path: f.path, kind: "csv", sha256: sha256Hex(text), bytes: text.length });
    }
    for (const p of def.pdfs as PdfSpec[]) {
      const bytes = await buildInvoicePdf(p);
      await write(`samples/${p.path}`, bytes);
      manifest.push({ scenario: def.id, path: p.path, kind: "pdf", sha256: sha256Hex(bytes), bytes: bytes.length });
    }
  }

  // Sandbox starter files: a drifted export a visitor can download, edit and re-upload.
  const rng = createRng(4242);
  const drifted = generateDriftedFile(rng, { rows: 12, vendorId: "V-5120", difficulty: "medium" });
  await write("samples/sandbox/cobalt_ridge_export_drifted.csv", drifted.csv);
  manifest.push({ scenario: 0, path: "sandbox/cobalt_ridge_export_drifted.csv", kind: "csv", sha256: sha256Hex(drifted.csv), bytes: drifted.csv.length });

  await write("samples/manifest.json", JSON.stringify({ generatedBy: "scripts/generate-samples.ts", files: manifest }, null, 2) + "\n");

  // The 2009 portal reads its ERP tables from a static JSON file (no build step on the portal side).
  const erp = {
    _note: "Generated from src/engine/data/*.json by scripts/generate-samples.ts. Synthetic data.",
    vendors: VENDOR_MASTER.map((v) => ({ vendor_id: v.vendor_id, name: v.name })),
    purchaseOrders: ERP_PURCHASE_ORDERS,
    costCenters: COST_CENTERS,
    historicalLedger: HISTORICAL_LEDGER,
  };
  await write("legacy/omnicorp/data/erp.json", JSON.stringify(erp, null, 2) + "\n");
  console.log(`Wrote ${manifest.length} sample files and the portal ERP data.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
