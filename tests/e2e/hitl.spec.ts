import { expect, test } from "@playwright/test";
import { decide, hitl, openScenario, summary } from "./helpers";

test.describe("human-in-the-loop decisions on the $1,800 conflict", () => {
  for (const [key, label, posted] of [
    ["1", "enforce the PO amount", 2],
    ["2", "approve the override", 2],
    ["3", "send to manual audit", 1],
  ] as const) {
    test(`decision ${key}: ${label}`, async ({ page }) => {
      await openScenario(page, 2);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(hitl(page)).toBeVisible({ timeout: 60_000 });
      await expect(hitl(page).getByText("AMOUNT_DELTA_ABS").first()).toBeVisible();
      await decide(page, [key]);
      await expect(page.getByTestId("run-status").getByText("DONE")).toBeVisible({ timeout: 120_000 });
      expect(await summary(page, "Posted")).toBe(posted);
      expect(await summary(page, "Human decisions")).toBe(1);
    });
  }

  test("a checkpoint edited after signing is rejected by the server", async ({ page }) => {
    await openScenario(page, 2);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const card = hitl(page);
    await expect(card.getByText("Verified checkpoint")).toBeVisible({ timeout: 60_000 });
    await card.getByRole("button", { name: /Tamper with this checkpoint/ }).click();
    await expect(card.getByText("Modified after signing")).toBeVisible();
    await page.keyboard.press("2");
    await card.getByLabel(/Operator name/).fill("Mallory");
    await card.getByRole("button", { name: "Verify checkpoint and resume" }).click();
    await expect(card.getByRole("alert")).toContainText("Server rejected the resume");
    await card.getByRole("button", { name: /Restore the signed state/ }).click();
    await card.getByRole("button", { name: "Verify checkpoint and resume" }).click();
    await expect(page.getByTestId("run-status").getByText("DONE")).toBeVisible({ timeout: 120_000 });
  });
});
