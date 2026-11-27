import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const dark of [false, true]) {
  for (const width of [1280, 800]) {
    test(`goal popover is inset and preserves the draft, ${width}, ${dark ? "dark" : "light"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/chat-chrome.html?goal=active&tr${dark ? "&dark" : ""}`);
      const row = page.locator("[data-provider-goal]");
      await row.click();
      const panel = page.getByRole("dialog", { name: "Hedef", exact: true });
      await expect(panel).toContainText("12.400 / 50.000 token");
      const padding = await panel.evaluate((el) => {
        const style = getComputedStyle(el);
        return Math.min(
          ...[style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
            parseFloat,
          ),
        );
      });
      expect(padding).toBeGreaterThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await mkdir("temp/verification/codex-goal-popover", { recursive: true });
      await page.screenshot({
        path: `temp/verification/codex-goal-popover/${dark ? "dark" : "light"}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Duraklat", exact: true }).click();
      await expect(row).toHaveAttribute("data-provider-goal", "paused");
      await panel.getByRole("button", { name: "Hedefe devam et", exact: true }).click();
      await expect(row).toHaveAttribute("data-provider-goal", "active");
      await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
        "Taslağım burada kalmalı.",
      );
      await panel.getByRole("button", { name: "Hedefi temizle", exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
        "Taslağım burada kalmalı.",
      );
    });
  }
}

test("goal commands stay locked during work and long objectives remain readable", async ({
  page,
}) => {
  await page.goto("/tests/browser/chat/chat-chrome.html?goal=blocked&busy&long");
  const row = page.locator("[data-provider-goal]");
  await row.click();
  const panel = page.getByRole("dialog", { name: "Goal", exact: true });
  await expect(panel).toContainText("Goal blocked");
  await expect(panel.getByRole("button", { name: "Resume goal", exact: true })).toBeDisabled();
  const clear = panel.getByRole("button", { name: "Clear goal", exact: true });
  await expect(clear).toBeDisabled();
  await clear.scrollIntoViewIfNeeded();
  await expect(clear).toBeInViewport();
  await expect(panel).toContainText("Hesapları ve seçili modeli doğrula");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("every prompt bar lands on its own turn in the real transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat/chat-chrome.html?transcript");
  const rail = page.getByRole("toolbar", { name: "Prompts", exact: true });
  await expect(rail.locator("[data-prompt-bar]")).toHaveCount(90);
  // Newest first: the last bar is a subagent result, as in a delegating session.
  for (const index of [89, 88, 0, 2, 45, 44, 71, 89, 1]) {
    const id = `prompt-${index}`;
    await rail.locator(`[data-prompt-bar="${id}"]`).click();
    await expect
      .poll(
        () =>
          page.evaluate((turnId) => {
            const scroller = document.querySelector<HTMLElement>(".agent-transcript")!;
            const turn = scroller.querySelector(`[data-transcript-turn="${turnId}"]`);
            if (!turn) return `${turnId} not mounted`;
            const view = scroller.getBoundingClientRect();
            const box = turn.getBoundingClientRect();
            const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2;
            const aligned = Math.abs(box.top - view.top - 8) <= 3;
            const clamped = atEnd || scroller.scrollTop === 0;
            return aligned || (clamped && box.top >= view.top && box.top < view.bottom)
              ? "on target"
              : `${turnId} is ${Math.round(box.top - view.top)}px from the top`;
          }, id),
        { message: `bar ${id}` },
      )
      .toBe("on target");
  }
});

for (const dark of [false, true]) {
  test(`prompt preview stays compact without duplicate tooltip, ${dark ? "dark" : "light"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/chat/chat-chrome.html?count=10&preview${dark ? "&dark" : ""}`);
    const rail = page.getByRole("toolbar", { name: "Prompts", exact: true });
    const first = rail.locator("[data-prompt-bar='prompt-0']");
    const card = page.getByLabel("Prompt preview", { exact: true });
    await first.hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText(
      "Failed to authenticate: OAuth session expired and could not be refreshed",
    );
    await expect(card.locator("p")).toHaveCount(2);
    await expect
      .poll(() =>
        card
          .locator("p")
          .first()
          .evaluate((el) => {
            const style = getComputedStyle(el);
            return el.scrollWidth > el.clientWidth && style.textOverflow === "ellipsis";
          }),
      )
      .toBe(true);
    // Shared tooltips wait before opening; keep hovering beyond that delay.
    await page.waitForTimeout(1000);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.screenshot({
      path: `temp/verification/2026-11-05-prompt-outline/${dark ? "dark" : "light"}-1280.png`,
    });
    await page.mouse.move(500, 700);
    await expect(card).toBeHidden();
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(rail.locator("[data-prompt-bar='prompt-1']")).toBeFocused();
    await expect(card).toHaveText("Prompt 1");
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await first.click();
    await expect
      .poll(() => page.locator(".agent-transcript").evaluate((el) => el.scrollTop))
      .toBe(0);
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(rail).toBeHidden();
    await expect(card).toBeHidden();
    await page.screenshot({
      path: `temp/verification/2026-11-05-prompt-outline/${dark ? "dark" : "light"}-800.png`,
    });
  });

  test(`chat ruler fits dense and resized panes, ${dark ? "dark" : "light"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/chat/chat-chrome.html?count=300${dark ? "&dark" : ""}`);
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
  await page.goto("/tests/browser/chat/chat-chrome.html?count=10");
  const toolbar = page.locator("header");
  await expect(toolbar.getByRole("button")).toHaveCount(4);
  await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: "Project actions" }).click();
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

for (const dark of [false, true]) {
  for (const width of [1280, 800]) {
    test(`header actions stay fixed with named tooltips ${dark ? "dark" : "light"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(() => {
        localStorage.setItem("bycoda.language", "en");
        localStorage.setItem(
          "bycoda.projectActions.v1",
          JSON.stringify({
            "c:/project": [{ id: "dev", name: "dev", icon: "play", command: "pnpm dev", url: "" }],
          }),
        );
        Object.assign(window, {
          __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
          __TAURI_INTERNALS__: {
            metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
            transformCallback: () => 1,
            invoke: async (command: string) => (command === "plugin:event|listen" ? 1 : false),
          },
        });
      });
      await page.goto(
        `/tests/browser/chat/chat-chrome.html?count=10&caption${dark ? "&dark" : ""}`,
      );
      const header = page.locator("header");
      await expect(header.getByRole("button", { name: "Run dev", exact: true })).toBeVisible();
      await expect(header.locator("[data-ebg-item]")).toHaveCount(0);
      await expect(
        header.getByRole("button", { name: "Close window", exact: true }),
      ).toHaveAttribute("data-button-tone", "neutral");
      const buttons = header.getByRole("button");
      for (let i = 0; i < (await buttons.count()); i++) {
        const button = buttons.nth(i);
        const before = await button.boundingBox();
        await button.hover();
        const tooltip = page.getByRole("tooltip");
        // An icon-only action named by its label shows no tooltip that would repeat the name;
        // only actions with a shortcut or detail do.
        if (await tooltip.isVisible({ timeout: 1000 }).catch(() => false)) {
          await expect(tooltip).toContainText(
            /dev|More actions|Project actions|Open project in|Find in conversation|Notes|Close pane|Minimize|Maximize|Close/,
          );
        }
        const after = await button.boundingBox();
        expect(after?.width).toBe(before?.width);
        await page.mouse.move(0, 100);
        await expect(tooltip).toBeHidden();
      }
      await header.screenshot({
        path: `temp/verification/2026-11-13-titlebar/header-${dark ? "dark" : "light"}-${width}.png`,
      });
    });
  }
}

for (const dark of [false, true])
  for (const width of [800, 1280])
    test(`transcript find surface ${dark ? "dark" : "light"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/chat/chat-chrome.html?count=10${dark ? "&dark" : ""}`);
      await page.getByRole("button", { name: "Find in conversation", exact: true }).click();
      const search = page.getByRole("search", { name: "Find in conversation" });
      await expect(search).toBeVisible();
      await search.getByRole("textbox", { name: "Find in conversation" }).fill("message");
      const searchBox = (await search.boundingBox())!;
      for (const label of ["Previous match", "Next match", "Close find"]) {
        const bounds = (await search.getByRole("button", { name: label }).boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          Math.min(searchBox.x + searchBox.width, width) + 1,
        );
      }
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/transcript-find-${dark ? "dark" : "light"}-${width}.png`,
      });
    });
