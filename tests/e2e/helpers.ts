import { expect, type Page } from "@playwright/test";

export type Choice = "1" | "2" | "3";

/** Open a scenario in the console at instant presentation speed. */
export async function openScenario(page: Page, id: 1 | 2 | 3 | 4 | 5) {
  await page.goto(`/console?scenario=${id}`);
  await expect(page.getByTestId("run-status")).toBeVisible();
  // A fresh portal ledger, so expected postings are deterministic.
  await page.evaluate(() => {
    localStorage.removeItem("omnicorp.v42.ledger");
    sessionStorage.clear();
  });
  await page.getByRole("radio", { name: "Instant" }).click();
}

export const hitl = (page: Page) => page.getByRole("dialog", { name: /Human decision/ });

/** Answer every pending escalation with the given shortcut keys, then verify and resume. */
export async function decide(page: Page, choices: Choice[], operator = "E2E Operator") {
  const card = hitl(page);
  await expect(card).toBeVisible();
  const tabs = card.getByRole("tab");
  const n = Math.max(1, await tabs.count());
  for (let i = 0; i < n; i++) {
    if (n > 1) await tabs.nth(i).click();
    await page.keyboard.press(choices[Math.min(i, choices.length - 1)]);
  }
  await card.getByLabel(/Operator name/).fill(operator);
  await card.getByRole("button", { name: "Verify checkpoint and resume" }).click();
}

export async function runToEnd(page: Page, choices: Choice[] = ["1"]) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    const done = page.getByTestId("run-status").getByText("DONE");
    const paused = hitl(page);
    await expect(done.or(paused)).toBeVisible({ timeout: 120_000 });
    if (await done.isVisible()) return;
    await decide(page, choices);
    await expect(paused).toBeHidden({ timeout: 30_000 });
  }
  await expect(page.getByTestId("run-status").getByText("DONE")).toBeVisible({ timeout: 120_000 });
}

export async function summary(page: Page, label: string): Promise<number> {
  await page.getByRole("tab", { name: /Audit log/ }).click();
  const dd = page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
  return Number(await dd.textContent());
}
