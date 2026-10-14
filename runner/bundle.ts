/** Builds the in-page distiller bundle (an IIFE) with esbuild. */
import { build } from "esbuild";
import { join } from "node:path";

let cached: string | null = null;

export async function distillerBundle(): Promise<string> {
  if (cached) return cached;
  const out = await build({
    entryPoints: [join(process.cwd(), "runner", "inpage.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    minify: true,
    legalComments: "none",
    logLevel: "silent",
  });
  cached = out.outputFiles[0].text;
  return cached;
}
