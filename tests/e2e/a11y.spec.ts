import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const path of ["/", "/console", "/benchmarks", "/how-it-works"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.nodes[0]?.target.join(" ")})`)).toEqual([]);
  });
}
