import { expect, test } from "@playwright/test";

for (const dark of [false, true]) {
  test(`prompt preview stays compact without duplicate tooltip, ${dark ? "dark" : "light"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/chat-chrome.html?count=10&preview${dark ? "&dark" : ""}`);
    const rail = page.getByRole("toolbar", { name: "Prompts", exact: true });
    const first = rail.locator("[data-prompt-bar='prompt-0']");
    const card = page.getByLabel("Prompt preview", { exact: true });
    await first.hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Failed to authenticate: OAuth session expired and could not be refreshed");
    await expect(card.locator("p")).toHaveCount(2);
    await expect.poll(() => card.locator("p").first().evaluate((el) => {
      const style = getComputedStyle(el);
      return el.scrollWidth > el.clientWidth && style.textOverflow === "ellipsis";
    })).toBe(true);
    // Shared tooltips wait before opening; keep hovering beyond that delay.
    await page.waitForTimeout(1000);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.screenshot({ path: `temp/verification/2026-11-05-prompt-outline/${dark ? "dark" : "light"}-1280.png` });
    await page.mouse.move(500, 700);
    await expect(card).toBeHidden();
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(rail.locator("[data-prompt-bar='prompt-1']")).toBeFocused();
    await expect(card).toHaveText("Prompt 1");
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await first.click();
    await expect.poll(() => page.locator(".agent-transcript").evaluate((el) => el.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(rail).toBeHidden();
    await expect(card).toBeHidden();
    await page.screenshot({ path: `temp/verification/2026-11-05-prompt-outline/${dark ? "dark" : "light"}-800.png` });
  });

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
