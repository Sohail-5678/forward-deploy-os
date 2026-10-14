/**
 * Records fingerprints on the clean portal ("before the weekend release").
 *   npx tsx scripts/record-selector-cache.ts
 * Output: src/engine/data/selector-cache.v42.json (committed; scenarios 3 and 5 start from it).
 */
import { writeFile } from "node:fs/promises";
import { recordSelectorCache } from "./lib/record-cache";

async function main() {
  const entries = await recordSelectorCache();
  await writeFile("src/engine/data/selector-cache.v42.json", JSON.stringify({ portal: "OmniCorp ERP v4.2 (clean)", entries }, null, 2) + "\n");
  console.log(`Recorded ${entries.length} selector fingerprints.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
