/**
 * Conservative safe-regex check for `regexExtract` normalizers. A transform
 * spec is data (rule S1), but a regex in it could still cause catastrophic
 * backtracking. We reject anything that is not obviously linear-ish.
 */

export const REGEX_LIMITS = { maxPatternLength: 120, maxInputLength: 256 } as const;

export interface SafeRegexVerdict {
  safe: boolean;
  reason?: string;
}

export function checkSafeRegex(pattern: string): SafeRegexVerdict {
  if (pattern.length === 0) return { safe: false, reason: "empty pattern" };
  if (pattern.length > REGEX_LIMITS.maxPatternLength) return { safe: false, reason: "pattern too long" };
  if (/\\[1-9]|\\k</.test(pattern)) return { safe: false, reason: "backreferences are not allowed" };
  if (/\(\?[=!<]/.test(pattern)) return { safe: false, reason: "lookaround is not allowed" };
  try {
    new RegExp(pattern);
  } catch {
    return { safe: false, reason: "pattern does not compile" };
  }
  // Star height > 1: a quantified group that itself contains a quantifier.
  const stack: { hasQuantifier: boolean }[] = [];
  let hasQuantifierAtTop = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") {
      // skip character class
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "(") {
      stack.push({ hasQuantifier: false });
      continue;
    }
    if (ch === ")") {
      const group = stack.pop();
      if (!group) return { safe: false, reason: "unbalanced parentheses" };
      const next = pattern[i + 1];
      const quantified = next === "*" || next === "+" || next === "?" || next === "{";
      if (quantified && group.hasQuantifier) {
        return { safe: false, reason: "nested quantifiers (possible catastrophic backtracking)" };
      }
      const parentHas = group.hasQuantifier || quantified;
      if (stack.length > 0) stack[stack.length - 1].hasQuantifier ||= parentHas;
      else hasQuantifierAtTop ||= parentHas;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "{" || ch === "?") {
      if (stack.length > 0) stack[stack.length - 1].hasQuantifier = true;
      else hasQuantifierAtTop = true;
    }
    if (ch === "|" && stack.length > 0) {
      // Alternation inside a quantified group can also blow up; be strict.
      const next = findGroupEndQuantifier(pattern, i);
      if (next) return { safe: false, reason: "alternation inside a quantified group" };
    }
  }
  if (stack.length > 0) return { safe: false, reason: "unbalanced parentheses" };
  void hasQuantifierAtTop;
  return { safe: true };
}

function findGroupEndQuantifier(pattern: string, from: number): boolean {
  let depth = 0;
  for (let i = from; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      if (depth === 0) {
        const next = pattern[i + 1];
        return next === "*" || next === "+" || next === "{";
      }
      depth--;
    }
  }
  return false;
}

const compiled = new Map<string, RegExp>();

/** Run a validated pattern against bounded input. Returns null on no match or unsafe pattern. */
export function safeExtract(pattern: string, group: number, input: string): string | null {
  const verdict = checkSafeRegex(pattern);
  if (!verdict.safe) return null;
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    compiled.set(pattern, re);
  }
  const m = re.exec(input.slice(0, REGEX_LIMITS.maxInputLength));
  if (!m) return null;
  return m[group] ?? null;
}
