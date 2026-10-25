import { expect, test } from "@playwright/test";

for (const [theme, width] of [
  ["dark", 1920],
  ["light", 390],
] as const) {
  test(`settings fill their panel and align cards ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const section of [
      "general",
      "chat",
      "workspace",
      "notifications",
      "appearance",
      "connections",
      "providers",
      "terminal",
      "groupLock",
      "inbox",
      "mcp",
      "keybindings",
      "worktrees",
      "archive",
      "limits",
    ]) {
      await page.goto(
        `/tests/browser/settings.html?section=${section}&theme=${theme}&lang=en&terminal=normal`,
      );
      const form = page.locator(`[data-settings-section="${section}"]`);
      await expect(form).toBeVisible();
      const dimensions = await form.evaluate((node) => ({
        width: node.clientWidth,
        parent: node.parentElement!.clientWidth,
        scroll: node.scrollWidth,
      }));
      expect(dimensions.width, section).toBeGreaterThan(dimensions.parent * 0.95);
      expect(dimensions.scroll, section).toBeLessThanOrEqual(dimensions.width + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        section,
      ).toBe(true);
      const cards = await form
        .locator(
          ":is(.general-settings, .chat-settings, .workspace-settings, .notification-alert-settings) > .settings-group > .settings-group-content, .usage-account",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const b = node.getBoundingClientRect();
            return { top: b.top, height: b.height };
          }),
        );
      for (const card of cards)
        for (const peer of cards)
          if (section !== "general" && Math.abs(card.top - peer.top) < 2)
            expect(Math.abs(card.height - peer.height), section).toBeLessThan(2);
      if (section === "notifications" && width > 1000) {
        const grid = form.locator(".notification-alert-settings");
        expect(
          await grid.evaluate(
            (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
          ),
        ).toBe(2);
      }
      if (section === "chat") {
        const templates = form.locator(".settings-templates");
        await templates.scrollIntoViewIfNeeded();
        expect(
          await templates.evaluate((node) => {
            const help = node.querySelector(".settings-advanced")!;
            return (
              help.getBoundingClientRect().left - node.parentElement!.getBoundingClientRect().left
            );
          }),
        ).toBeGreaterThanOrEqual(16);
        await page.screenshot({
          path: `temp/verification/2026-10-18-settings-layout/templates-${theme}-${width}.png`,
        });
        await page.locator("[data-settings-scroller]").evaluate((node) => {
          node.scrollTop = 0;
        });
      }
      if (["general", "chat", "notifications", "limits"].includes(section))
        await page.screenshot({
          path: `temp/verification/2026-10-18-settings-layout/${section}-${theme}-${width}.png`,
        });
    }
    await expect(page.getByRole("heading", { name: "Usage budgets", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add budget", exact: true })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Usage views" })).toHaveCount(0);
    const categoryPicker = page.locator(".bycoda-settings-category-picker");
    if (await categoryPicker.isVisible()) {
      await categoryPicker.getByRole("button").click();
      await page.getByRole("option", { name: "Usage", exact: true }).click();
    } else {
      await page
        .locator(".bycoda-settings-categories")
        .getByRole("tab", { name: "Usage", exact: true })
        .click();
    }
    await page.getByRole("radio", { name: "Limits", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add budget", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("Turkish policies and limits remain usable at intermediate widths", async ({ page }) => {
  for (const width of [1280, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/browser/settings.html?section=policies&theme=dark&lang=tr");
    await expect(
      page
        .locator(".policy-navigation")
        .getByRole("tab", { name: "Gizlilik politikası", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const categoryPicker = page.locator(".bycoda-settings-category-picker");
    if (await categoryPicker.isVisible()) {
      await categoryPicker.getByRole("button").click();
      await page.getByRole("option", { name: "Sınırlar ve bütçeler", exact: true }).click();
    } else {
      await page
        .locator(".bycoda-settings-categories")
        .getByRole("tab", { name: "Sınırlar ve bütçeler", exact: true })
        .click();
    }
    await expect(page.getByRole("button", { name: "Bütçe ekle", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-18-settings-layout/limits-tr-${width}.png`,
    });
  }
});
