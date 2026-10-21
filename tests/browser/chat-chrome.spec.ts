import { expect, test } from "@playwright/test";

for (const dark of [false, true]) {
  test(`chat ruler fits dense and resized panes, ${dark ? "dark" : "light"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/chat-chrome.html?count=300${dark ? "&dark" : ""}`);
    const rail = page.getByRole("toolbar", { name: "Prompts", exact: true });
    await expect(rail).toBeVisible();
    for (const height of [800, 400, 240]) {
      await page.setViewportSize({ width: 1280, height });
      await expect
        .poll(async () =>
          rail.evaluate((el) => {
            const scope = el.parentElement!.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            const bars = [...el.querySelectorAll<HTMLElement>("[data-prompt-bar]")];
            return (
              box.top >= scope.top &&
              box.bottom <= scope.bottom &&
              box.height <= 331 &&
              bars.every((bar) => {
                const rect = bar.getBoundingClientRect();
                return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
              })
            );
          }),
        )
        .toBe(true);
    }
    const last = rail.locator("[data-prompt-bar]").last();
    await last.focus();
    await expect(page.getByLabel("Prompt preview", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 768, height: 600 });
    await expect(rail).toBeHidden();
  });
}

test("project, find, notes and close share one working group", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat-chrome.html?count=10");
  const toolbar = page.getByRole("toolbar", { name: "Project actions", exact: true });
  await expect(toolbar.getByRole("button")).toHaveCount(5);
  await toolbar.getByRole("button", { name: "Project actions", exact: true }).click();
  await expect(page.getByRole("menuitem").filter({ hasText: "Add action" })).toBeVisible();
  await page.keyboard.press("Escape");
  const find = toolbar.getByRole("button", { name: "Find in conversation", exact: true });
  await find.click();
  await expect(find).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("search")).toBeVisible();
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.locator("output")).toContainText("Notes opened");
  await toolbar.getByRole("button", { name: "Close pane", exact: true }).click();
  await expect(page.locator("output")).toContainText("Pane closed");
});
