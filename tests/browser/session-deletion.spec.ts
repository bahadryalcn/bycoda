import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`deletion stays visible until a real outcome in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/session-deletion.html?theme=${theme}`);
    const notice = page.locator("[data-session-deletion-detail]");
    await expect(notice).toContainText("Preparing deletion…");
    await expect(notice).toContainText("Still working…");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await page.getByRole("button", { name: "Close processes" }).click();
    await expect(notice).toContainText("Closing agent processes…");
    await page.screenshot({ path: test.info().outputPath(`deleting-${theme}.png`) });
    await page.getByRole("button", { name: "Delete data" }).click();
    await expect(notice).toContainText("Deleting conversation data…");
    expect(await notice.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Fail", exact: true }).click();
    await expect(notice.getByRole("alert")).toContainText("Storage unavailable");
    await expect(notice).not.toContainText("Conversation deleted.");
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(notice).toContainText("Conversation deleted.");
    await expect(notice).not.toContainText("Still working…");
    await notice.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
  });
}
