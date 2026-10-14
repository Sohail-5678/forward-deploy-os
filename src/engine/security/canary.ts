/**
 * Layer 6: canary token. A per-deployment random token is placed in the LLM
 * system prompt. If it ever appears in a model output or an action argument,
 * the prompt leaked and the run aborts.
 */

export function makeCanary(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `CNRY-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function variants(canary: string): string[] {
  const core = canary.replace(/^CNRY-/, "");
  return [canary.toLowerCase(), core.toLowerCase(), core.split("").reverse().join("").toLowerCase()];
}

/** True when any string inside `value` contains the canary (or an obvious variant). */
export function containsCanary(value: unknown, canary: string): boolean {
  if (!canary) return false;
  const needles = variants(canary);
  const seen = new Set<unknown>();
  const visit = (v: unknown): boolean => {
    if (typeof v === "string") {
      const hay = v.toLowerCase().replace(/[\s\-_.]/g, "");
      return needles.some((n) => hay.includes(n.replace(/[\s\-_.]/g, "")));
    }
    if (v && typeof v === "object") {
      if (seen.has(v)) return false;
      seen.add(v);
      return Object.values(v as Record<string, unknown>).some(visit);
    }
    return false;
  };
  return visit(value);
}

export class CanaryTripped extends Error {
  constructor(where: string) {
    super(`Canary token detected in ${where}; the system prompt may have leaked. The run was aborted.`);
    this.name = "CanaryTripped";
  }
}

export function assertNoCanary(value: unknown, canary: string, where: string): void {
  if (containsCanary(value, canary)) throw new CanaryTripped(where);
}
