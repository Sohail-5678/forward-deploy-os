import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { runScenario, EXPECTED_POSTINGS } from "../../runner/agent-runner";
import { startStaticPortal, type StaticPortal } from "../../runner/static-server";

/** The real Playwright agent completes Scenarios 1 to 3 headless (spec 17). */
describe("agent runner (headless Chromium)", () => {
  let browser: Browser;
  let portal: StaticPortal;
  beforeAll(async () => {
    portal = await startStaticPortal();
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await portal?.close();
  });

  for (const id of [1, 2, 3] as const) {
    it(`scenario ${id} reaches its expected outcome`, async () => {
      const r = await runScenario(browser, id, portal.baseUrl);
      expect(r.problems).toEqual([]);
      expect(r.state.n7?.postings).toHaveLength(EXPECTED_POSTINGS[id]);
      if (id === 3) {
        expect(r.state.n6?.baseline?.ok).toBe(false);
        expect(r.state.n8?.summary.selectorsHealed).toBeGreaterThan(0);
      }
    });
  }
});
