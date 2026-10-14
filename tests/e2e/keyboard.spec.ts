import { expect, test, type Page } from "@playwright/test";
import { hitl, openScenario, summary } from "./helpers";

async function tabTo(page: Page, matches: () => Promise<boolean>, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await matches()) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("could not reach the control with the keyboard");
}

test("scenario 2 runs end to end with the keyboard only", async ({ page }) => {
  await openScenario(page, 2);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await tabTo(page, () => page.evaluate(() => document.activeElement?.textContent?.trim() === "Run"));
  await page.keyboard.press("Enter");
  const card = hitl(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("1");
  await tabTo(page, () => page.evaluate(() => document.activeElement?.id === "operator"));
  await page.keyboard.type("Keyboard Operator");
  await tabTo(page, () => page.evaluate(() => document.activeElement?.textContent?.includes("Verify checkpoint and resume") ?? false));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("run-status").getByText("DONE")).toBeVisible({ timeout: 120_000 });
  expect(await summary(page, "Posted")).toBe(2);
});
