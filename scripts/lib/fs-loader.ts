import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SampleLoader } from "../../src/engine/data/scenarios";

/** Loads committed scenario samples from public/samples. */
export const fsLoader: SampleLoader = {
  text: (p) => readFile(join(process.cwd(), "public", "samples", p), "utf8"),
  bytes: async (p) => new Uint8Array(await readFile(join(process.cwd(), "public", "samples", p))),
};
