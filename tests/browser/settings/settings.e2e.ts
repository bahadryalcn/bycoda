import { test, expect, type Page } from "@playwright/test";

/** Appearance is tabbed; every tab stays mounted but only the selected one is visible. */
async function openAppearanceTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

/** Background layers are cards whose editors stay hidden until the card is opened. */
async function openBackgroundLayer(page: Page, description: RegExp) {
  await openAppearanceTab(page, "Background");
  const disclosure = page.getByRole("button", { name: description });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
}

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`workspace gradients retain custom designs and synchronize windows: ${theme} ${width}`, async ({
      page,
      context,
      browserName,
    }) => {
      const key = "bycoda.workspaceBackground.v1";
      const url = `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`;
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(url);
      const group = page.locator('[data-setting-id="workspace-background"]');
      // The Color layer's editor stays closed until its row is opened.
      const openColorLayer = async () => {
        await openBackgroundLayer(page, /Gradient or solid color behind the workspace/);
        await expect(group).toBeVisible();
      };
      await openColorLayer();
      const stored = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), key);
      const previousGlass = await page.evaluate(() =>
        ["bycoda.bodyGlass", "bycoda.windowGlass"].map((key) => localStorage.getItem(key)),
      );
      await group.getByRole("button", { name: "Ocean", exact: true }).click();
      await expect.poll(stored).toMatchObject({ enabled: true });
      const type = group.getByRole("radiogroup", { name: "Gradient type", exact: true });
      await type.getByRole("radio", { name: "Linear", exact: true }).click();
      const dial = group.getByRole("slider", { name: "Gradient angle", exact: true });
      const initial = (await stored()).angle;
      await dial.press("ArrowRight");
      // Edits are applied on the next animation frame.
      await expect.poll(async () => (await stored()).angle).not.toBe(initial);
      const angle = (await stored()).angle;
      await type.getByRole("radio", { name: "Radial", exact: true }).click();
      await expect(dial).toHaveAttribute("aria-disabled", "true");
      expect((await stored()).angle).toBe(angle);
      await type.getByRole("radio", { name: "Linear", exact: true }).click();
      await group.getByRole("button", { name: "Color 1", exact: true }).click();
      await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#2244aa");
      await expect.poll(async () => (await stored()).colors[0]).toBe("#2244aa");
      await page.keyboard.press("Escape");
      const design = await stored();
      const toggle = page.getByRole("switch", { name: "Color", exact: true });
      await toggle.click();
      await expect(page.locator("html")).not.toHaveClass(/has-workspace-background/);
      expect((await stored()).colors).toEqual(design.colors);
      await toggle.click();
      await page.reload();
      await expect(page.locator("html")).toHaveClass(/has-workspace-background/);
      expect(await stored()).toEqual(design);
      expect(
        await page.evaluate(() =>
          ["bycoda.bodyGlass", "bycoda.windowGlass"].map((key) => localStorage.getItem(key)),
        ),
      ).toEqual(previousGlass);
      const sibling = await context.newPage();
      try {
        await sibling.goto(url);
        await expect(sibling.locator("html")).toHaveClass(/has-workspace-background/);
        await openColorLayer();
        const before = (await stored()).angle;
        await dial.press("ArrowRight");
        // Edits are applied on the next animation frame.
        await expect.poll(async () => (await stored()).angle).not.toBe(before);
        const changed = await stored();
        await expect
          .poll(() =>
            sibling.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
          )
          .toContain(`${changed.angle}deg`);
        if (browserName === "chromium") {
          const cdp = await context.newCDPSession(page);
          try {
            await cdp.send("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
            });
            await expect
              .poll(() =>
                page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
              )
              .toBe("none");
            await expect(
              group.getByText(
                "Your accessibility settings hide workspace backgrounds. Your design is still saved.",
                { exact: true },
              ),
            ).toBeVisible();
            expect((await stored()).enabled).toBe(true);
          } finally {
            await cdp.send("Emulation.setEmulatedMedia", { features: [] });
            await cdp.detach();
          }
        }
      } finally {
        await sibling.close();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`terminal typography settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=tr`,
      );
      await openAppearanceTab(page, "Tipografi");
      // Terminal text follows the code font until the owner picks a separate terminal font.
      const font = page
        .locator('[data-setting-id="terminal-font"]')
        .getByRole("button", { name: /^Terminal yazı tipi:/ });
      await expect(font).toContainText("Kod fontuyla aynı");
      await font.click();
      await page.getByRole("combobox", { name: /Yazı tiplerinde ara/ }).fill("JetBrains Mono");
      await page.getByRole("option", { name: /^JetBrains Mono/ }).click();
      const size = page.getByRole("spinbutton", { name: "Terminal yazı boyutu", exact: true });
      await size.fill("14");
      await size.blur();
      await expect(size).toHaveValue("14");
      await page
        .locator('[data-setting-id="terminal-font-weight"]')
        .getByRole("radio", { name: "Kalın", exact: true })
        .click();
      await page
        .locator('[data-setting-id="terminal-line-height"]')
        .getByRole("radio", { name: "1.35×", exact: true })
        .click();
      const saved = () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("bycoda.appearancePreferences.v1") ?? "{}"),
        );
      await expect.poll(saved).toMatchObject({
        terminalFont: "JetBrains Mono",
        terminalFontSource: "custom",
        terminalSize: 14,
        terminalWeight: 700,
        terminalLineHeight: 1.35,
        codeSize: 13,
      });
      await page.reload();
      await openAppearanceTab(page, "Tipografi");
      await expect(font).toContainText("JetBrains Mono");
      await expect(size).toHaveValue("14");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  test(`code theme follows appearance and persists: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=tr`,
    );
    const row = page.locator('[data-setting-id="code-theme"]');
    await openAppearanceTab(page, "Tipografi");
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("radio", { name: "Dracula", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    const keyword = page.locator(".code-sample-keyword").first();
    await expect(keyword).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(255, 121, 198)" : "rgb(207, 34, 46)",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    await openAppearanceTab(page, "Tipografi");
    await expect(row.getByRole("radio", { name: "Dracula", exact: true })).toBeChecked();
    await row.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    mkdirSync("temp/verification/2026-10-19-code-themes", { recursive: true });
    await row.screenshot({
      path: `temp/verification/2026-10-19-code-themes/${theme}-theme-control.png`,
    });
  });
}

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`general settings dependencies and language choices: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=general&theme=${theme}&lang=en`,
      );
      const general = page.locator(".general-settings");
      const awake = general.getByRole("switch", {
        name: "Prevent sleep while agents work",
        exact: true,
      });
      const screen = general.getByRole("switch", { name: "Keep the screen on", exact: true });
      const duration = general
        .locator('[data-setting-id="keep-awake-duration"]')
        .getByRole("button", { name: /^Stay awake after an agent ends:/ });
      await expect(screen).toBeDisabled();
      await expect(duration).toBeDisabled();
      await awake.focus();
      await page.keyboard.press("Space");
      await expect(screen).toBeEnabled();
      await screen.click();
      await duration.click();
      await page.getByRole("option", { name: "15 minutes", exact: true }).click();
      await awake.click();
      await expect(screen).toBeDisabled();
      await page.reload();
      await expect(screen).toBeChecked();
      await expect(screen).toBeDisabled();
      await awake.click();
      await expect(duration).toContainText("15 minutes");
      await expect(screen).toBeChecked();
      const language = general.locator(
        '[data-setting-id="git-language"] button[aria-haspopup="listbox"]',
      );
      await language.focus();
      await language.press("Enter");
      await page.getByRole("option", { name: "English", exact: true }).click();
      await expect(language).toContainText("English");
      await expect(general.locator('[data-setting-id="technical-language"]')).toContainText(
        "Follow application language",
      );
      // The header help states automatic saving once; groups no longer repeat it.
      await expect(general.getByText("Changes save automatically", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "About this page", exact: true }).click();
      await expect(page.getByText("Changes save automatically", { exact: true })).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(general.locator(".general-about-value")).toBeVisible();
      const overflows = await general.evaluate((root) =>
        [
          ...root.querySelectorAll(
            ".settings-row, .settings-group-heading, .general-update-actions",
          ),
        ]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.className),
      );
      expect(overflows).toEqual([]);
      mkdirSync("temp/verification/2026-10-18-general-settings", { recursive: true });
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-top.png`,
      });
      await general.locator('[data-setting-id="update"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-bottom.png`,
      });
    });
  }

test("appearance topics stay visible and support search into nested controls", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en");
  const topics = page.getByRole("tablist", { name: "Appearance", exact: true }).getByRole("tab");
  await expect(topics).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-dark.png") });
  await page.getByRole("button", { name: "About this page", exact: true }).click();
  await expect(page.getByText("Changes save automatically", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await openAppearanceTab(page, "Typography");
  await expect(page.locator('[data-setting-id="code-font-size"]')).toBeVisible();
  await expect(
    page.locator(".appearance-settings details, .appearance-settings summary"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("Dark-mode lightness");
  await page.getByRole("option").filter({ hasText: "Dark-mode lightness" }).click();
  await expect(page.locator('[data-setting-id="dark-lightness"]')).toBeVisible();

  // Expanded content must stay contained at intermediate and narrow widths too.
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // Open rows outset their hover surface into the form padding, so the padded form and the
    // scroller are the boundaries that must stay free of horizontal overflow.
    expect(
      await page
        .locator(".bycoda-settings-form")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      await page
        .locator("[data-settings-scroller]")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("appearance-expanded.png") });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=tr");
  await expect(
    page.getByRole("tablist", { name: "Görünüm", exact: true }).getByRole("tab"),
  ).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-light-tr.png") });
});

test("control density persists shared control targets and resets without changing fonts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("bycoda.appearancePreferences.v1"))
      localStorage.setItem(
        "bycoda.appearancePreferences.v1",
        JSON.stringify({ interfaceFont: "Verdana", codeSize: 15 }),
      );
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await openAppearanceTab(page, "Interface");
  const row = page.locator('[data-setting-id="control-density"]');
  const density = row.getByRole("radiogroup", { name: "Control density", exact: true });
  const radio = (name: string) => density.getByRole("radio", { name, exact: true });
  await expect(radio("Compact")).toBeChecked();
  await radio("Touch").click();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  expect((await radio("Touch").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.reload();
  await openAppearanceTab(page, "Interface");
  await expect(radio("Touch")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  await row.getByRole("button", { name: "Restore default", exact: true }).click();
  await expect(radio("Compact")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "compact");
  expect((await radio("Compact").boundingBox())!.height).toBeLessThan(44);
  expect(
    await page
      .locator("html")
      .evaluate((node) => (node as HTMLElement).style.getPropertyValue("--font-sans")),
  ).toBe('"Verdana", sans-serif');
});

test("elastic appearance adjustments retain bounds, persistence and light-mode gates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Blur is adjustable on macOS only; present a Mac platform so the slider's bounds are exercised.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en");
  await page.getByRole("radio", { name: /^Olive/ }).click();
  await openBackgroundLayer(page, /Transparency of the sidebar and main pane/);
  // Glass is off by default off Linux; the sliders only act while it is on.
  const glass = page.getByRole("switch", { name: "Glass", exact: true });
  if (!(await glass.isChecked())) await glass.click();
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  const opacity = page
    .locator('[data-setting-id="sidebar-opacity"]')
    .getByRole("slider", { name: "Sidebar opacity", exact: true });
  await opacity.press("Home");
  await opacity.press("End");
  await expect(opacity).toHaveAttribute("aria-valuenow", "100");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bycoda.sidebarOpacity")))
    .toBe("1");
  await opacity.press("ArrowLeft");
  await expect(opacity).toHaveAttribute("aria-valuetext", "99%");
  await page.screenshot({
    path: "temp/verification/2026-10-16-ui-system/W5a-SETTINGS-elastic-custom-dark.png",
  });
  await page.reload();
  await openBackgroundLayer(page, /Transparency of the sidebar and main pane/);
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  await expect(opacity).toHaveAttribute("aria-valuenow", "99");
  const blur = page
    .locator('[data-setting-id="blur"]')
    .getByRole("slider", { name: "Blur radius", exact: true });
  await blur.press("Home");
  await expect(blur).toHaveAttribute(
    "aria-valuenow",
    (await blur.getAttribute("aria-valuemin")) ?? "",
  );
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await openBackgroundLayer(page, /Transparency of the sidebar and main pane/);
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  await expect(opacity).toHaveAttribute("aria-disabled", "true");
  await expect(blur).toHaveAttribute("aria-disabled", "true");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const sections = [
  "general",
  "appearance",
  "notifications",
  "keybindings",
  "workspace",
  "terminal",
  "chat",
  "providers",
  "usage",
  "mcp",
  "skills",
  "inbox",
  "worktrees",
  "groupLock",
  "archive",
  "connections",
  "policies",
];

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 800, 1024, 1280, 1440]) {
    test(`keybindings recording and filters: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=keybindings&theme=${theme}&lang=en`,
      );
      const search = page.getByRole("searchbox", { name: "Filter keybindings", exact: true });
      const geometry = await page
        .locator('[data-settings-section="keybindings"]')
        .evaluate((form) => {
          const style = getComputedStyle(form);
          return {
            available:
              form.clientWidth -
              parseFloat(style.paddingInlineStart) -
              parseFloat(style.paddingInlineEnd),
            content: form.querySelector(".settings-group")!.getBoundingClientRect().width,
          };
        });
      expect(geometry.content).toBeGreaterThan(geometry.available * 0.98);
      await search.fill("Open Inbox");
      const recorder = page.getByRole("button", {
        name: "Change App: Open Inbox shortcut",
        exact: true,
      });
      await expect(recorder).toBeVisible();
      await recorder.click();
      await page.keyboard.press("Control+Alt+q");
      await expect(recorder).toContainText("Q");
      await expect(page.getByText("Modified", { exact: true })).toBeVisible();
      await expect(page.getByText(/^Default:/)).toBeVisible();
      const feedback = page
        .locator(".settings-row")
        .filter({ has: recorder })
        .getByRole("status")
        .filter({ has: page.getByRole("button", { name: "Saved", exact: true }) });
      await expect(feedback).toContainText("Saved");
      const savedDetails = feedback.getByRole("button", { name: "Saved", exact: true });
      await expect(savedDetails).toBeVisible();
      await savedDetails.click();
      await expect(page.getByRole("dialog", { name: "Saved", exact: true })).toContainText("Saved");
      await page.keyboard.press("Escape");
      await expect(savedDetails).toBeFocused();
      await page.reload();
      await search.fill("Open Inbox");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Escape");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("alert")).toContainText("Already used");
      await expect(recorder).toContainText("Q");
      const recorderBounds = (await recorder.boundingBox())!;
      const resetBounds = (await page
        .getByRole("button", {
          name: "Reset App: Open Inbox shortcut",
          exact: true,
        })
        .boundingBox())!;
      // Conflict feedback must not collapse the recorder beneath its reset
      // action and leave pointer activation waiting behind another control.
      expect(recorderBounds.width).toBeGreaterThan(40);
      expect(recorderBounds.x + recorderBounds.width).toBeLessThanOrEqual(resetBounds.x + 1);
      if ([390, 800, 1280].includes(width)) {
        const conflictCaptures =
          "temp/verification/2026-11-01-release-performance/keybindings-conflict";
        mkdirSync(conflictCaptures, { recursive: true });
        await page.screenshot({ path: `${conflictCaptures}/${theme}-${width}.png` });
      }
      await recorder.click();
      await page.keyboard.press("Delete");
      await expect(recorder).toContainText("Disabled");
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const filters = page.getByRole("dialog", { name: "Filters", exact: true });
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Disabled", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(recorder).toBeVisible();
      await page
        .getByRole("button", { name: "Reset App: Open Inbox shortcut", exact: true })
        .click();
      await expect(page.getByText("No matching bindings", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Reset filters", exact: true }).click();
      await expect(recorder).toBeVisible();
      await expect(recorder).toContainText("I");
      // Filters reset independently of the search text, so clear it before searching by category.
      await search.clear();
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Category: All categories", exact: true }).click();
      await page.getByRole("option", { name: "Pane", exact: true }).click();
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Unassigned", exact: true }).click();
      await page.keyboard.press("Escape");
      const layoutRecorder = page.getByRole("button", {
        name: "Change Pane: Arrange Grid shortcut",
        exact: true,
      });
      await expect(layoutRecorder).toContainText("Unassigned");
      const firstRow = page.locator(".settings-row").first();
      expect((await firstRow.boundingBox())!.height).toBeLessThan(120);
      await expect(firstRow).not.toContainText("When: Always");
      await page
        .getByRole("heading", { name: "Keybindings", exact: true })
        .scrollIntoViewIfNeeded();
      await layoutRecorder.click();
      await page.keyboard.press("Control+Alt+g");
      await expect(layoutRecorder).toHaveCount(0);
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(layoutRecorder).toContainText("G");
      await page
        .getByRole("button", { name: "Reset Pane: Arrange Grid shortcut", exact: true })
        .click();
      await expect(layoutRecorder).toContainText("Unassigned");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-15-keybindings/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Shortcut help", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Shortcut help" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Shortcut help", exact: true })).toBeFocused();
    });
  }
const languages = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"];
const captures = "temp/verification/settings-integrated/screens";

test("shared appearance controls preserve palette persistence and provide color recovery", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      const studio = page.getByRole("region", { name: "Theme and colors", exact: true });
      // The 9 workspace-preview galleries were replaced by named palette chips and a segmented scheme.
      await expect(studio.locator(".appearance-workspace-preview")).toHaveCount(0);
      await expect(
        studio.getByRole("radiogroup", { name: "Color scheme", exact: true }).getByRole("radio"),
      ).toHaveCount(3);
      await expect(studio.locator("details, summary")).toHaveCount(0);
      const olive = studio.getByRole("radio", { name: /^Olive/ });
      const palettes = studio.getByRole("radiogroup", { name: "Theme palettes", exact: true });
      await expect(palettes.getByRole("radio")).toHaveCount(6);
      for (const name of ["bycoda", "Olive", "Tide", "Kiln", "Dusk", "Ink"]) {
        const palette = palettes.getByRole("radio", { name: new RegExp(`^${name}`) });
        await palette.scrollIntoViewIfNeeded();
        await expect(palette).toBeInViewport();
      }
      await olive.click();
      await expect(olive).toBeChecked();
      await page.reload();
      await expect(olive).toBeChecked();
      await studio.getByRole("button", { name: "Reset colors", exact: true }).click();
      await expect(studio.getByRole("radio", { name: /^bycoda/ })).toBeChecked();
      await studio
        .getByRole("radiogroup", { name: "Color scheme", exact: true })
        .getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true })
        .click();
      await expect(page.locator("html")).toHaveClass(
        theme === "light" ? /theme-light/ : /^(?!.*theme-light)/,
      );
      await studio
        .getByRole("radiogroup", { name: "Color scheme", exact: true })
        .evaluate((node) => {
          const scroller = node.closest<HTMLElement>("[data-settings-scroller]")!;
          scroller.scrollTop +=
            node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          window.scrollTo(0, 0);
        });
      await page.screenshot({
        path: testInfo.outputPath(`appearance-${width}-${theme}.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
});

test("category keyboard navigation retains focus and search opens an advanced control", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html");
  const tabs = page
    .getByRole("tablist", { name: "Settings categories", exact: true })
    .getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await tabs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Search settings", exact: true }).fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await page.getByRole("combobox", { name: "Search settings", exact: true }).press("Enter");
  const target = page.locator('[data-setting-id="saturation"]');
  await expect(target).toBeVisible();
  await expect(target.getByRole("slider")).toBeFocused();
  await expect(target.locator("xpath=ancestor::details")).toHaveCount(0);
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Codex · Terminal account profiles");
  await expect(page.getByRole("option").first()).toContainText("Codex");
  await search.press("Enter");
  const terminalProfiles = page.getByRole("dialog", {
    name: "Terminal account profiles",
    exact: true,
  });
  await expect(terminalProfiles).toBeVisible();
  await expect(
    page.locator('[data-setting-id="terminal-account-profiles-codex"] button').first(),
  ).toBeFocused();
  await expect(page.locator(".provider-cli-option[aria-current=true]")).toContainText("Codex");
  await page.keyboard.press("Escape");
  await expect(terminalProfiles).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Terminal account profiles", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Search settings", exact: true })).toBeVisible();
});

test("automatic settings preserve values and dependent controls after reopening and reload", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html");
  const toggle = page.locator('[data-setting-id="keep-awake"] [role="switch"]');
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  const summary = page.getByRole("switch", { name: "Daily summary", exact: true });
  await expect(summary).toBeDisabled();
  await page.getByRole("switch", { name: "Desktop notifications", exact: true }).click();
  await expect(summary).toBeEnabled();
});

test("explicit template validation, save status and persistence preserve the last saved value", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html?section=chat");
  await page.getByRole("button", { name: "Add template", exact: true }).click();
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "Template name", exact: true }).fill("Review code");
  await page
    .getByRole("textbox", { name: "Template text", exact: true })
    .fill("Find bugs and explain their impact.");
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Template text", exact: true }).fill("Unsaved revision");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  // The unsaved draft survives closing and reopening Settings and stays visibly unsaved;
  // discarding it restores the last saved value.
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue(
    "Unsaved revision",
  );
  await expect(page.getByRole("button", { name: "Save templates", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Discard changes and reload", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue(
    "Find bugs and explain their impact.",
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue(
    "Review code",
  );
});

// Every locale/theme/size uses the same real 17-category screen. Screenshots
// support manual review; geometry assertions catch disappearing/overflowing fields.
for (const lang of languages)
  for (const theme of ["light", "dark"])
    for (const width of [390, 1440]) {
      test(`all categories and advanced fields: ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(180_000);
        mkdirSync(captures, { recursive: true });
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const section of sections) {
          await page.goto(
            `/tests/browser/settings/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          const categoryPicker = page.locator(".bycoda-settings-category-picker");
          await expect(
            (await categoryPicker.isVisible())
              ? categoryPicker.getByRole("button")
              : page.locator(".bycoda-settings-categories").getByRole("tab", { selected: true }),
          ).toBeVisible();
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          await expect(page.locator("details.settings-advanced")).toHaveCount(0);
          await page.waitForTimeout(100);
          const overflow = await page.locator(".bycoda-settings-panel").evaluate((panel) => {
            const bounds = panel.getBoundingClientRect();
            return [
              ...panel.querySelectorAll<HTMLElement>(
                "input,textarea,[role=switch],[role=slider],[aria-haspopup=listbox]",
              ),
            ]
              .filter((node) => node.getClientRects().length > 0)
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width < 1 || rect.left < bounds.left - 2 || rect.right > bounds.right + 2
                );
              })
              .map((node) => node.getAttribute("aria-label") ?? node.tagName);
          });
          expect(overflow, `${section} controls remain inside the panel`).toEqual([]);
          const squeezedDescriptions = await page
            .locator(".bycoda-settings-panel")
            .evaluate((panel) =>
              [
                ...panel.querySelectorAll<HTMLElement>(
                  ".settings-group-title .settings-description",
                ),
              ]
                .filter(
                  (node) =>
                    !node.closest(".sr-only") &&
                    node.getClientRects().length > 0 &&
                    node.getBoundingClientRect().width < 150,
                )
                .map((node) => node.textContent),
            );
          expect(
            squeezedDescriptions,
            `${section} group descriptions retain readable width`,
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const scroller = page.locator("[data-settings-scroller]");
          if (await scroller.count()) {
            const dimensions = await scroller.evaluate((node) => ({
              height: node.clientHeight,
              total: node.scrollHeight,
            }));
            for (
              let top = 0, frame = 0;
              top < dimensions.total;
              top += Math.max(1, dimensions.height - 80), frame++
            ) {
              await scroller.evaluate((node, top) => {
                node.scrollTop = top;
              }, top);
              await page.screenshot({
                path: `${captures}/${lang}-${theme}-${width}-${section}-${frame}.png`,
              });
            }
          } else
            await page.screenshot({
              path: `${captures}/${lang}-${theme}-${width}-${section}-0.png`,
            });
        }
        // Direct sub-screens are opened and cancelled, never saved to native state.
        for (const section of ["mcp", "worktrees", "groupLock"] as const) {
          await page.goto(
            `/tests/browser/settings/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          const main = page.locator("main");
          await expect(main).toHaveAttribute("data-fixture-labels", /mcp/);
          const labels = JSON.parse((await main.getAttribute("data-fixture-labels"))!) as Record<
            string,
            string
          >;
          const trigger = page.getByRole("button", {
            name: labels[section === "groupLock" ? "password" : section],
            exact: true,
          });
          await trigger.click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(
            true,
          );
          await page.screenshot({
            path: `${captures}/${lang}-${theme}-${width}-${section}-dialog.png`,
          });
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        expect(errors).toEqual([]);
      });
    }
