import { expect, test } from "@playwright/test";
import { openScenario, runToEnd, summary, type Choice } from "./helpers";

/** Each scenario's expected outcome (spec section 11), driven through the real UI and portal iframe. */
const CASES: { id: 1 | 2 | 3 | 4 | 5; choices: Choice[]; posted: number; extra?: (page: import("@playwright/test").Page) => Promise<void> }[] = [
  { id: 1, choices: ["1"], posted: 6 },
  { id: 2, choices: ["1"], posted: 2 },
  {
    id: 3,
    choices: ["1"],
    posted: 3,
    extra: async (page) => expect(await summary(page, "Selectors healed")).toBeGreaterThan(0),
  },
  {
    id: 4,
    choices: ["3"],
    posted: 1,
    extra: async (page) => expect(await summary(page, "Docs quarantined")).toBe(1),
  },
  { id: 5, choices: ["1", "3"], posted: 5 },
];

for (const c of CASES) {
  test(`scenario ${c.id} reaches its expected outcome`, async ({ page }) => {
    await openScenario(page, c.id);
    await runToEnd(page, c.choices);
    expect(await summary(page, "Posted")).toBe(c.posted);
    expect(await summary(page, "Unknown-account payments")).toBe(0);
    await c.extra?.(page);
  });
}

test("re-running scenario 1 posts nothing and prevents every duplicate", async ({ page }) => {
  await openScenario(page, 1);
  await runToEnd(page);
  await page.getByRole("button", { name: "Run again" }).click();
  await expect(page.getByTestId("run-status").getByText("DONE")).toBeVisible({ timeout: 120_000 });
  expect(await summary(page, "Posted")).toBe(0);
  expect(await summary(page, "Duplicates prevented")).toBe(6);
});
