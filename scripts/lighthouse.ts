/**
 * Runs Lighthouse on the landing page and records the scores and LCP in
 * benchmarks/results.json ("web"), then recomputes the budgets so a missed
 * target shows as missed on /benchmarks.
 *   npm run lighthouse -- https://your-deployment.vercel.app
 * Uses `npx lighthouse` (downloaded on first use) and the Playwright Chromium.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { computeBudgets, type BenchResults } from "../src/engine/evals/run";

const URL_ = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "") + "/";

async function main() {
  const out = execFileSync("npx", ["-y", "lighthouse", URL_, "--output=json", "--quiet", "--only-categories=performance,accessibility,best-practices", `--chrome-path=${chromium.executablePath()}`, "--chrome-flags=--headless=new --no-sandbox"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const lhr = JSON.parse(out) as { categories: Record<string, { score: number }>; audits: Record<string, { numericValue?: number }> };
  const score = (k: string) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
  const file = join(process.cwd(), "benchmarks", "results.json");
  const results = JSON.parse(await readFile(file, "utf8")) as BenchResults;
  results.web = {
    lighthouse: { performance: score("performance"), accessibility: score("accessibility"), bestPractices: score("best-practices") },
    lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0),
    measuredAt: new Date().toISOString(),
    url: URL_,
    note: "Lighthouse default (mobile, simulated throttling)",
  };
  results.budgets = computeBudgets(results.suites, results.web);
  await writeFile(file, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results.web, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
