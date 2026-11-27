import type { Page } from "@playwright/test";

/** Opens the inventory's Add menu and picks one entry (Quick connect, SSH settings, ...). */
export async function pickAddMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
