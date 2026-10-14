/**
 * npm run bench          -> runs every suite with fixed seeds, writes benchmarks/results.json and results.md
 * npm run bench -- drift guard   -> runs only those suites (merged into the existing file)
 * npm run bench:check    -> re-runs the deterministic suites and fails if they differ from the committed file
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import { JSDOM } from "jsdom";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { createJsdomPortal } from "./lib/jsdom-portal";
import { fsLoader } from "./lib/fs-loader";
import { BENCH_SEED, RESULTS_FORMAT, computeBudgets, deterministicView, runSuite, type BenchResults } from "../src/engine/evals/run";
import { SUITE_IDS, type PortalFactory, type SuiteEnv, type SuiteId } from "../src/engine/evals/types";
import { buildScenarioInput } from "../src/engine/data/scenarios";
import { canonicalJSON } from "../src/engine/hash";
import { renderResultsMarkdown } from "./lib/results-md";

const RESULTS = "benchmarks/results.json";

const portal: PortalFactory = {
  async open({ page, chaos, loggedIn, ledger }) {
    const p = await createJsdomPortal({ chaos, loggedIn, ledger, latencyScale: 0 });
    await p.load(page);
    return {
      driver: p.driver,
      document: () => p.window().document,
      truthOf: (selector) => {
        try {
          const el = p.window().document.querySelector(selector);
          if (!el) return null;
          return (el as unknown as { __omniTruth?: string }).__omniTruth ?? el.id ?? null;
        } catch {
          return null;
        }
      },
      close: () => p.close(),
    };
  },
  async session({ ledger }) {
    const p = await createJsdomPortal({ ledger, latencyScale: 0 });
    return { driver: p.driver, close: () => p.close() };
  },
  parseHtml(html) {
    return new JSDOM(html).window.document;
  },
};

function bar(done: number, total: number) {
  const w = 24;
  const f = Math.round((done / Math.max(1, total)) * w);
  return `[${"#".repeat(f)}${".".repeat(w - f)}] ${done}/${total}`;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const only = args.filter((a) => !a.startsWith("--")) as SuiteId[];
  const ids: SuiteId[] = check ? SUITE_IDS.filter((s) => s !== "latency" && s !== "idempotency") : only.length ? only : [...SUITE_IDS];
  const previous: BenchResults | null = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : null;
  const results: BenchResults = {
    format: RESULTS_FORMAT,
    generatedAt: new Date().toISOString(),
    seed: BENCH_SEED,
    environment: { runtime: `Node ${process.version}`, platform: `${platform()} (${cpus().length} cores)`, note: "DOM suites run against the real portal files in jsdom" },
    suites: only.length && previous ? { ...previous.suites } : {},
    budgets: [],
    web: previous?.web,
  };
  if (existsSync("benchmarks/web.json")) results.web = JSON.parse(readFileSync("benchmarks/web.json", "utf8"));

  for (const id of ids) {
    const env: SuiteEnv = {
      seed: BENCH_SEED,
      countTokens: (t) => countTokens(t),
      portal,
      loadScenario: (n) => buildScenarioInput(n, fsLoader, []),
      environment: "node",
      progress: (d, t) => process.stdout.write(`\r  ${id.padEnd(13)} ${bar(d, t)}`),
    };
    const t0 = Date.now();
    const r = await runSuite(id, env);
    results.suites[id] = r;
    process.stdout.write(`\r  ${id.padEnd(13)} done in ${((Date.now() - t0) / 1000).toFixed(1)} s${" ".repeat(30)}\n`);
  }
  results.budgets = computeBudgets(results.suites, results.web);

  if (check) {
    if (!previous) {
      console.error("No committed benchmarks/results.json to check against. Run `npm run bench` first.");
      process.exit(1);
    }
    const committed = deterministicView({ ...previous, suites: Object.fromEntries(ids.map((i) => [i, previous.suites[i]])) } as BenchResults);
    const now = deterministicView(results);
    if (canonicalJSON(committed) !== canonicalJSON(now)) {
      console.error("Benchmark results differ from the committed benchmarks/results.json. Re-run `npm run bench` and commit the result.");
      for (const id of ids) {
        const a = canonicalJSON((committed as Record<string, unknown>)[id]);
        const b = canonicalJSON((now as Record<string, unknown>)[id]);
        if (a !== b) console.error(`  differs: ${id}`);
      }
      process.exit(1);
    }
    console.log("Deterministic benchmark results match the committed file.");
    return;
  }

  await mkdir("benchmarks", { recursive: true });
  await writeFile(RESULTS, JSON.stringify(results, null, 2) + "\n");
  await writeFile("benchmarks/results.md", renderResultsMarkdown(results));
  console.log(`Wrote ${RESULTS} and benchmarks/results.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
