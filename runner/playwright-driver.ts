/**
 * PortalDriver over real headless Chromium (Playwright). Reading uses the
 * engine's own distiller, injected into every page; acting uses Playwright's
 * native fill/select/click, which fire real input events.
 */
import type { Page } from "playwright";
import { CHAOS_STORAGE_KEY, LEDGER_STORAGE_KEY, PortalError, pageFromUrl, type PortalDriver, type PortalPage, type ProbeResult, type WaitCondition } from "../src/engine/browser/driver";
import type { ChaosType, DistillResult, LedgerEntry } from "../src/engine/types";
import { distillerBundle } from "./bundle";
import { portalUrl } from "./static-server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PlaywrightDriverOptions {
  /** Origin that serves /legacy/omnicorp/ (the static portal server or the running app). */
  baseUrl: string;
  /** Optional pause after each action, to make a headed run watchable. */
  slowMoMs?: number;
}

export async function createPlaywrightDriver(page: Page, opts: PlaywrightDriverOptions): Promise<PortalDriver> {
  await page.addInitScript({ content: await distillerBundle() });

  async function settle() {
    // Follow the portal's own script redirects (for example, to the log-on page) until the URL is stable.
    let last = "";
    let stable = 0;
    for (let i = 0; i < 120 && stable < 3; i++) {
      const href = page.url();
      const ready = await page.evaluate(() => document.readyState).catch(() => "loading");
      if (ready === "complete" && href === last) stable++;
      else stable = 0;
      last = href;
      await sleep(25);
    }
  }

  async function unique(selector: string) {
    const loc = page.locator(selector);
    let n: number;
    try {
      n = await loc.count();
    } catch {
      throw new PortalError(`invalid selector: ${selector}`, "SELECTOR_NOT_FOUND");
    }
    if (n === 0) throw new PortalError(`selector not found: ${selector}`, "SELECTOR_NOT_FOUND");
    if (n > 1) throw new PortalError(`selector is ambiguous (${n} matches): ${selector}`, "AMBIGUOUS_SELECTOR");
    if (await loc.isDisabled().catch(() => false)) throw new PortalError(`element is disabled (is a dialog open?): ${selector}`, "UNREACHABLE");
    return loc;
  }

  async function pace() {
    if (opts.slowMoMs) await sleep(opts.slowMoMs);
  }

  const evalCheck = (conds: WaitCondition[]) =>
    page
      .evaluate((cs) => {
        return cs.some((c) => {
          switch (c.kind) {
            case "page": {
              const m = /\/legacy\/omnicorp\/([^/?#]*)/.exec(location.href);
              const p = m ? (m[1] === "" ? "index.html" : m[1]) : "unknown";
              return p === c.page && document.readyState === "complete";
            }
            case "text":
              return (document.body?.textContent ?? "").includes(c.text);
            case "selector":
              return !!document.querySelector(c.selector);
            case "idle":
              return document.readyState !== "loading";
          }
          return false;
        });
      }, conds)
      .catch(() => false);

  const driver: PortalDriver = {
    kind: "playwright",
    async goto(p: PortalPage) {
      try {
        await page.goto(portalUrl(opts.baseUrl, p), { waitUntil: "load", timeout: 15_000 });
      } catch (e) {
        throw new PortalError(`navigation failed: ${e instanceof Error ? e.message : String(e)}`, "NAVIGATION");
      }
      await settle();
    },
    async currentPage() {
      return pageFromUrl(page.url());
    },
    async distill(): Promise<DistillResult> {
      return page.evaluate(() => window.__FDOS__!.distill()) as Promise<DistillResult>;
    },
    async probe(selector: string): Promise<ProbeResult | null> {
      return page.evaluate((s) => window.__FDOS__!.probe(s), selector) as Promise<ProbeResult | null>;
    },
    async fill(selector: string, value: string) {
      const loc = await unique(selector);
      await loc.fill(value, { timeout: 3000 });
      // Read after write: focusing this field can fire the previous field's change event, which may
      // open the session dialog and disable this field before the text arrives; those keystrokes are lost.
      const same = (v: string | null) => v !== null && v.trim().toUpperCase() === value.trim().toUpperCase();
      if (!same(await loc.inputValue().catch(() => null))) {
        if (await loc.isDisabled().catch(() => false)) throw new PortalError(`the field was disabled while typing (is a dialog open?): ${selector}`, "UNREACHABLE");
        await loc.fill(value, { timeout: 3000 });
        if (!same(await loc.inputValue().catch(() => null))) throw new PortalError(`the value did not stick in ${selector}`, "UNREACHABLE");
      }
      await pace();
    },
    async select(selector: string, value: string) {
      const loc = await unique(selector);
      try {
        await loc.selectOption({ value }, { timeout: 3000 });
      } catch {
        try {
          await loc.selectOption({ label: value }, { timeout: 3000 });
        } catch {
          throw new PortalError(`option "${value}" not found in ${selector}`, "SELECTOR_NOT_FOUND");
        }
      }
      if (await loc.isDisabled().catch(() => false)) throw new PortalError(`the list was disabled while selecting (is a dialog open?): ${selector}`, "UNREACHABLE");
      await pace();
    },
    async click(selector: string) {
      const loc = await unique(selector);
      await loc.click({ timeout: 5000 });
      await pace();
    },
    async waitFor(cond: WaitCondition | WaitCondition[], timeoutMs = 8000) {
      const conds = Array.isArray(cond) ? cond : [cond];
      const start = Date.now();
      for (;;) {
        if (await evalCheck(conds)) return true;
        if (Date.now() - start > timeoutMs) return false;
        await sleep(25);
      }
    },
    async readLedger(): Promise<LedgerEntry[]> {
      if (pageFromUrl(page.url()) === "unknown") await driver.goto("index.html");
      const raw = await page.evaluate((k) => window.localStorage.getItem(k), LEDGER_STORAGE_KEY).catch(() => null);
      try {
        return raw ? (JSON.parse(raw) as LedgerEntry[]) : [];
      } catch {
        return [];
      }
    },
    async setChaos(cfg: { seed: number; types: ChaosType[] } | null) {
      if (pageFromUrl(page.url()) === "unknown") await driver.goto("index.html");
      await page.evaluate(
        ({ key, value }) => {
          if (value) window.sessionStorage.setItem(key, value);
          else window.sessionStorage.removeItem(key);
          window.sessionStorage.removeItem("omnicorp.v42.interstitial");
        },
        { key: CHAOS_STORAGE_KEY, value: cfg && cfg.types.length ? JSON.stringify(cfg) : null },
      );
    },
    async portalInfo() {
      return page.evaluate(() => {
        const c = (window as unknown as { OmniChaos?: { active: boolean; types: ChaosType[]; applied: Record<string, unknown> } }).OmniChaos;
        return { chaos: c && c.active ? { types: c.types, applied: c.applied } : null };
      });
    },
  };
  return driver;
}
