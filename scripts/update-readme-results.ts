/**
 * Writes the results table into README.md between the markers, from
 * benchmarks/results.json, so README numbers can never drift (rule T1).
 *   npm run readme:results
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { headlineTiles } from "../src/lib/tiles";
import { RESULTS } from "../src/lib/results";

const START = "<!-- results:start -->";
const END = "<!-- results:end -->";

async function main() {
  const file = join(process.cwd(), "README.md");
  const readme = await readFile(file, "utf8");
  const rows = headlineTiles().map((t) => `| ${t.label[0].toUpperCase()}${t.label.slice(1)} | **${t.value}** | ${t.detail} | ${t.cases ?? "?"} | ${t.seed ?? "?"} |`);
  const budgets = RESULTS.budgets.map((b) => `| ${b.item} | ${b.target} | ${b.measured} | ${b.met === true ? "met" : b.met === false ? "**missed**" : "not measured"} |`);
  const block = [
    START,
    `_Generated from \`benchmarks/results.json\` (${RESULTS.generatedAt}, seed ${RESULTS.seed}, ${RESULTS.environment.runtime}). Do not edit by hand: run \`npm run readme:results\`._`,
    "",
    "| Metric | Value | Detail | Cases | Seed |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "| Budget | Target | Measured | Status |",
    "|---|---|---|---|",
    ...budgets,
    END,
  ].join("\n");
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < 0) throw new Error("README.md has no results markers");
  await writeFile(file, readme.slice(0, a) + block + readme.slice(b + END.length));
  console.log("README results table updated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
