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
      // Inbox credentials retired into Integrations; "inbox" now redirects there.
      "integrations",
      "mcp",
      "keybindings",
      "worktrees",
      "archive",
      "limits",
    ]) {
      await page.goto(
        `/tests/browser/settings/settings.html?section=${section}&theme=${theme}&lang=en&terminal=normal`,
      );
      const form = page.locator(`[data-settings-section="${section}"]`);
      await expect(form).toBeVisible();
      // Every page shares one bounded column: the form fills the panel until it reaches the single
      // column cap (80rem; 96rem only when the dialog is maximized), then centres.
      const dimensions = await form.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const parent = node.parentElement!.getBoundingClientRect();
        const cap = Number.parseFloat(getComputedStyle(node).maxWidth);
        return {
          width: node.clientWidth,
          parent: node.parentElement!.clientWidth,
          scroll: node.scrollWidth,
          cap: Number.isFinite(cap) ? cap : Infinity,
          leading: bounds.left - parent.left,
          trailing: parent.right - bounds.right,
        };
      });
      // No page keeps its own track any more: preferences, collections and list/detail libraries
      // all measure the same 80rem column.
      expect(dimensions.cap, section).toBe(80 * 16);
      expect(dimensions.width, section).toBeGreaterThan(
        Math.min(dimensions.parent, dimensions.cap) * 0.95,
      );
      expect(dimensions.width, section).toBeLessThanOrEqual(dimensions.cap + 1);
      // Once capped the column centres in the panel (the scroller's stable gutter allows a few px).
      if (dimensions.parent - dimensions.width > 40)
        expect(Math.abs(dimensions.leading - dimensions.trailing), section).toBeLessThanOrEqual(20);
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
      if (section === "notifications") {
        // Topics stack in one readable column; project exceptions are a separate collection below.
        const grid = form.locator(".notification-alert-settings");
        expect(
          await grid.evaluate(
            (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
          ),
        ).toBe(1);
      }
      if (section === "chat") {
        const templates = form.getByRole("region", { name: "Prompt templates", exact: true });
        await templates.scrollIntoViewIfNeeded();
        await expect(
          templates.getByRole("button", { name: "Add template", exact: true }),
        ).toBeVisible();
        await templates.getByRole("button", { name: "How to use templates", exact: true }).click();
        const templateHelp = page.getByRole("dialog", {
          name: "How to use templates",
          exact: true,
        });
        await expect(templateHelp).toContainText("Name and text are required.");
        const helpBounds = (await templateHelp.boundingBox())!;
        expect(helpBounds.x).toBeGreaterThanOrEqual(0);
        expect(helpBounds.x + helpBounds.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
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
      await page.getByRole("option", { name: "Provider usage", exact: true }).click();
    } else {
      await page
        .locator(".bycoda-settings-categories")
        .getByRole("tab", { name: "Provider usage", exact: true })
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
    await page.goto("/tests/browser/settings/settings.html?section=policies&theme=dark&lang=tr");
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

test("keybinding rows keep command and key on one line at 800px", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/tests/browser/settings/settings.html?section=keybindings&theme=light&lang=en");
  const rows = page.locator('[data-settings-section="keybindings"] .settings-row');
  await expect(rows.first()).toBeVisible();
  const sampled = await rows.evaluateAll((nodes) =>
    nodes.slice(0, 12).map((node) => {
      const label = node.querySelector(".settings-row-label")!.getBoundingClientRect();
      const control = node.querySelector(".settings-row-control")!.getBoundingClientRect();
      return {
        sameLine: control.top < label.bottom - 1,
        height: node.getBoundingClientRect().height,
      };
    }),
  );
  expect(sampled.length).toBeGreaterThan(5);
  for (const row of sampled) expect(row.sameLine).toBe(true);
});

test("a wide row preview keeps its height when the row stacks at 800px", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en");
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  const slot = page.locator("#setting-crew-theme > .settings-row-feedback");
  const stage = page.locator("#setting-crew-theme .crew-stage-card");
  const picker = page.locator("#setting-crew-theme > .settings-row-control");
  await expect(stage).toBeVisible();
  const [slotBox, stageBox, pickerBox] = await Promise.all([
    slot.boundingBox(),
    stage.boundingBox(),
    picker.boundingBox(),
  ]);
  // The feedback slot holds its whole preview, and the picker starts below it (no overlap).
  expect(slotBox!.height).toBeGreaterThanOrEqual(stageBox!.height - 1);
  expect(pickerBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height - 1);
});
