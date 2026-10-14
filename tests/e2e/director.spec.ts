import { expect, test } from "@playwright/test";

test("Director Mode plays all six scenes to the measured summary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play the 90-second demo" }).first().click();
  const demo = page.getByRole("dialog", { name: /Director Mode/ });
  await expect(demo).toBeVisible();
  await expect(demo.getByRole("heading", { name: "Measured on this run" })).toBeVisible({ timeout: 170_000 });
  await expect(demo.getByText(/Invoices posted to the portal/)).toBeVisible();
  // Take control: the same live run becomes the full console.
  await demo.getByRole("button", { name: "Open the console" }).click();
  await expect(page.getByRole("dialog", { name: "ForwardDeploy OS console" })).toBeVisible();
  await expect(page).toHaveURL(/\/console\?scenario=5/);
});
