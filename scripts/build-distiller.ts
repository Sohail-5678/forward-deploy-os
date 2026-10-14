/**
 * Writes the in-page distiller bundle (esbuild IIFE) that the Playwright
 * runner and the MCP server inject into every portal page. The runner builds
 * it in memory on start; this script writes it to disk for inspection and CI.
 *
 *   npm run build:distiller   ->  runner/dist/distiller.iife.js
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { distillerBundle } from "../runner/bundle";

async function main() {
  const code = await distillerBundle();
  const dir = join(process.cwd(), "runner", "dist");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "distiller.iife.js"), code);
  console.log(`wrote runner/dist/distiller.iife.js (${(code.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
