/**
 * Records Director Mode with Playwright: docs/demo.webm (and docs/demo.gif when ffmpeg is installed).
 *   npm run record-demo -- http://localhost:3000
 */
import { execFileSync } from "node:child_process";
import { mkdir, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DOCS = join(process.cwd(), "docs");

async function main() {
  await mkdir(DOCS, { recursive: true });
  const tmp = join(DOCS, ".video");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", recordVideo: { dir: tmp, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Play the 90-second demo" }).first().click();
  await page.getByRole("heading", { name: "Measured on this run" }).waitFor({ timeout: 200_000 });
  await page.waitForTimeout(4000);
  await context.close();
  await browser.close();
  const [file] = await readdir(tmp);
  const out = join(DOCS, "demo.webm");
  await rename(join(tmp, file), out);
  console.log("wrote docs/demo.webm");
  try {
    execFileSync("ffmpeg", ["-y", "-i", out, "-vf", "fps=10,scale=960:-1:flags=lanczos", join(DOCS, "demo.gif")], { stdio: "ignore" });
    console.log("wrote docs/demo.gif");
  } catch {
    console.log("ffmpeg not found: skipped the GIF");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
