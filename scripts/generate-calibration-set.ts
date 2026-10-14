/**
 * Writes the seeded, labeled calibration set used to fit the confidence model.
 *   npm run calibrate   (runs this, then fit-calibrator.ts)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { generateCalibrationSet } from "../src/engine/evals/calibration-data";

export const CALIBRATION_SEED = 8_312_026;
export const CALIBRATION_SIZE = 1000;

async function main() {
  const cases = generateCalibrationSet(CALIBRATION_SEED, CALIBRATION_SIZE);
  await mkdir("benchmarks", { recursive: true });
  await writeFile("benchmarks/calibration-set.json", JSON.stringify({ seed: CALIBRATION_SEED, size: cases.length, cases }) + "\n");
  const safe = cases.filter((c) => c.label === 1).length;
  console.log(`Calibration set: ${cases.length} cases (${safe} safe, ${cases.length - safe} unsafe), seed ${CALIBRATION_SEED}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
