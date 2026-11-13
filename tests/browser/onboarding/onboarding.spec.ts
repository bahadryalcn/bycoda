import { expect, test } from "@playwright/test";
const fixture = "/tests/browser/onboarding/onboarding.html";
const captures = "temp/verification/2026-10-22-provider-add-ux/browser";

test("saves workspace and appearance choices, finishes directly and can reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "A workspace that fits you" })).toBeVisible();
  await dialog
    .locator(".onboarding-feature")
    .filter({ hasText: "Social Media" })
    .getByRole("checkbox")
    .uncheck();
  await expect(dialog.getByRole("heading", { name: "A workspace that fits you" })).toBeInViewport();
  await page.screenshot({ path: `${captures}/workspace-dark.png` });
  await dialog.getByRole("button", { name: /2\s*Appearance/ }).click();
  await expect(dialog.locator(".onboarding-crew-preview canvas")).toHaveCount(4);
  await expect
    .poll(() =>
      dialog
        .locator(".onboarding-crew-preview canvas")
        .evaluateAll((items) => items.every((item) => (item as HTMLCanvasElement).width > 100)),
    )
    .toBe(true);
  await dialog.locator("#onboarding-crew-star-wars").click();
  await dialog.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await expect(dialog.locator("#onboarding-crew-none")).toBeInViewport();
  await expect(dialog.getByRole("switch", { name: "Decorative animations" })).toBeInViewport();
  await page.screenshot({ path: `${captures}/appearance-light.png` });
  await dialog.getByRole("button", { name: /3\s*Agents/ }).click();
  await expect(dialog.getByRole("heading", { name: "Connect your agents" })).toBeVisible();
  await expect(dialog.locator(".onboarding-agent")).toHaveCount(0);
  await expect(dialog.getByText("No providers found", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add provider", exact: true })).toBeVisible();
  await page.screenshot({ path: `${captures}/providers-light.png` });
  await dialog.getByRole("button", { name: /4\s*Connections/ }).click();
  await expect(dialog.getByRole("button", { name: /Manage connections/ })).toBeVisible();
  await dialog.getByRole("button", { name: /5\s*Projects/ }).click();
  await dialog.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Workspace ready")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Fixture tools" })
      .getByRole("button", { name: "Social Media" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen setup" }).click();
  await expect(
    dialog.locator(".onboarding-feature").filter({ hasText: "Social Media" }).getByRole("checkbox"),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: /2\s*Appearance/ }).click();
  await expect(dialog.locator("#onboarding-crew-star-wars")).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: /3\s*Agents/ }).click();
  await expect(dialog.locator(".onboarding-agent")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("finds existing accounts, links another profile and lets the user choose a CLI executable", async ({
  page,
}) => {
  await page.goto(`${fixture}?providers`);
  await page.getByRole("button", { name: /3\s*Agents/ }).click();
  const claude = page
    .locator(".onboarding-agent")
    .filter({ has: page.getByRole("switch", { name: "Use Claude Code", exact: true }) });
  const codex = page
    .locator(".onboarding-agent")
    .filter({ has: page.getByRole("switch", { name: "Use Codex", exact: true }) });
  await expect(claude.getByRole("status")).toHaveText("Signed in");
  await expect(
    claude.getByRole("button", { name: "Sign in to Claude Code", exact: true }),
  ).toHaveCount(0);
  await expect(codex.getByRole("status")).toHaveText("Not signed in");
  await expect(codex.getByRole("button", { name: "Sign in to Codex", exact: true })).toBeEnabled();
  await claude.getByRole("button", { name: "More options for Claude Code", exact: true }).click();
  await page.getByRole("button", { name: "Terminal account profiles", exact: true }).click();
  await expect(page.getByText("D:/profiles/claude", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use account", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bycoda.providerAccounts.v2") ?? "{}").claude?.find(
            (account: { isDefault?: boolean }) => account.isDefault,
          )?.id,
      ),
    )
    .toBe("terminal-work");
  // Escape closes one layer at a time: the profiles popover, then the provider's options.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Terminal account profiles", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "More options for Claude Code", exact: true }),
  ).toHaveCount(0);
  await codex.getByRole("button", { name: "More options for Codex", exact: true }).click();
  await page.getByRole("button", { name: "Show Codex CLI details", exact: true }).click();
  await page.getByRole("button", { name: "Edit Codex CLI path", exact: true }).click();
  await page.getByRole("button", { name: "Choose executable", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "CLI path", exact: true })).toHaveValue(
    "D:/custom/codex.exe",
  );
  await page.getByRole("button", { name: "Save path", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("bycoda.providerBinaryPaths.v1") ?? "{}").codex,
      ),
    )
    .toBe("D:/custom/codex.exe");
});

test("keeps navigation and footer accessible at narrow and short viewports", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 760 },
    { width: 820, height: 540 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixture}?lang=tr`);
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Sana uygun bir çalışma alanı" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toBeInViewport();
    await dialog.getByRole("button", { name: /3\s*Ajanlar/ }).click();
    await expect(dialog.locator(".onboarding-agent")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toBeInViewport();
    expect(
      await dialog
        .locator(".onboarding-agent-list")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `${captures}/providers-tr-${viewport.width}.png` });
    await expect(dialog.getByRole("button", { name: /5\s*Projeler/ })).toBeInViewport();
    await dialog.getByRole("button", { name: /2\s*Görünüm/ }).click();
    await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toBeInViewport();
    await dialog.locator("#onboarding-crew-none").click();
    await expect(dialog.getByRole("button", { name: "Devam et", exact: true })).toBeInViewport();
    await page.screenshot({ path: `${captures}/appearance-tr-${viewport.width}.png` });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("adds only the chosen missing provider after validation and keeps it on rescan", async ({
  page,
}) => {
  await page.goto(`${fixture}?providers&agents`);
  await expect(page.locator(".onboarding-agent")).toHaveCount(2);
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add provider", exact: true });
  await add.getByRole("button", { name: /^Provider:/ }).click();
  await expect(page.getByRole("option", { name: "Codex", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Search providers…", exact: true }).fill("cursor");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(add.getByRole("textbox", { name: "CLI path", exact: true })).toBeVisible();
  await expect(add.getByRole("button", { name: "Add provider", exact: true })).toBeDisabled();
  await add.getByRole("textbox", { name: "CLI path", exact: true }).fill("D:/invalid.exe");
  await add.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(add.getByRole("alert")).toContainText("Selected file is not a provider CLI");
  await expect(page.locator(".onboarding-agent")).toHaveCount(2);
  await add.getByRole("button", { name: "Choose executable", exact: true }).click();
  await expect(add.getByRole("textbox", { name: "CLI path", exact: true })).toHaveValue(
    "D:/custom/cursor-agent.exe",
  );
  await expect(add.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: `${captures}/add-provider-path.png` });
  await add.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(add).toHaveCount(0);
  const cursor = page
    .locator(".onboarding-agent")
    .filter({ has: page.getByRole("switch", { name: "Use Cursor", exact: true }) });
  await expect(cursor.getByRole("status")).toHaveText("CLI path saved · restart required");
  await expect(cursor.getByRole("button", { name: "Sign in to Cursor", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Refresh agent status", exact: true }).click();
  await expect(page.locator(".onboarding-agent")).toHaveCount(3);
  await page.screenshot({ path: `${captures}/providers-found-and-added.png` });
});

test("keeps the add form and long discovered lists reachable on small and landscape screens", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixture}?providers=none&agents`);
    await page.getByRole("button", { name: "Add provider", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add provider", exact: true });
    await add.getByRole("button", { name: /^Provider:/ }).click();
    await page.getByRole("combobox", { name: "Search providers…", exact: true }).fill("cursor");
    await page.keyboard.press("Enter");
    await add.getByRole("button", { name: "Choose executable", exact: true }).click();
    await add.getByRole("button", { name: "Add provider", exact: true }).scrollIntoViewIfNeeded();
    await expect(add.getByRole("button", { name: "Add provider", exact: true })).toBeInViewport();
    await page.screenshot({ path: `${captures}/add-provider-${viewport.width}.png` });
    await add.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".onboarding-agent")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("bycoda.providerBinaryPaths.v1")),
    ).toBeNull();
    await page.goto(`${fixture}?providers=all&agents`);
    await expect(page.locator(".onboarding-agent")).toHaveCount(11);
    await page.locator(".onboarding-agent").last().scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`provider list separators ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?providers=all&agents&theme=${theme}`);
      const rows = page.locator(".onboarding-agent");
      await expect(rows).toHaveCount(11);
      const heights = await rows.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
      expect(heights.every((height) => height >= 40)).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/onboarding-agents-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`project selection rows ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?projects&theme=${theme}`);
      const rows = page.locator(".onboarding-projects .onboarding-project");
      await expect(rows).toHaveCount(2);
      await expect(rows.first().getByRole("checkbox")).toBeChecked();
      await rows.first().getByRole("checkbox").uncheck();
      await expect(rows.first().getByRole("checkbox")).not.toBeChecked();
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/onboarding-projects-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`full usage guide chrome ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?guide&theme=${theme}`);
      const panel = page.locator(".usage-guide-panel");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".usage-guide-toolbar")).toBeVisible();
      await expect(panel.locator(".usage-guide-footer")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/onboarding-guide-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`compact tour chrome ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?compactTour&theme=${theme}`);
      const card = page.locator(".usage-guide-panel--compact");
      await expect(card).toContainText("Fixture tour");
      await expect(card.locator(".usage-guide-toolbar")).toHaveCSS("border-bottom-width", "0px");
      await expect(card.locator(".usage-guide-footer")).toHaveCSS("border-top-width", "0px");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/onboarding-compact-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [480, 800, 1280])
    test(`guide hub navigation border ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?guideHub&theme=${theme}`);
      const nav = page.getByRole("navigation", { name: "Guide topics" });
      await expect(nav).toBeVisible();
      const border = await nav.evaluate((node) => {
        const style = getComputedStyle(node);
        return { end: style.borderInlineEndWidth, bottom: style.borderBlockEndWidth };
      });
      expect(border).toEqual(
        width === 480 ? { end: "0px", bottom: "1px" } : { end: "1px", bottom: "0px" },
      );
      const ring = page.locator(".guide-hub-ring").first();
      await expect(ring).toHaveCSS("border-top-width", "1px");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/guide-hub-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`shared onboarding choice cards ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fixture}?theme=${theme}`);
      const dialog = page.getByRole("dialog");
      const feature = dialog
        .locator("label.onboarding-feature")
        .filter({ hasText: "Social Media" });
      const checkbox = feature.getByRole("checkbox");
      await expect(feature).toHaveAttribute("data-choice-appearance", "card");
      const box = (await feature.boundingBox())!;
      await checkbox.uncheck();
      await feature.click();
      await expect(checkbox).toBeChecked();
      await page.keyboard.press("Tab");
      await checkbox.focus();
      await expect(feature).toHaveCSS("outline-style", "solid");
      expect((await feature.boundingBox())!.height).toBe(box.height);
      await page.screenshot({
        path: `temp/verification/onboarding-controls/workspace-${theme}-${width}.png`,
      });
      const awake = dialog.getByRole("switch", {
        name: "Prevent sleep while agents work",
        exact: true,
      });
      await expect(awake).toHaveAttribute("data-choice-appearance", "card");
      await expect(awake).toHaveCSS("border-top-width", "1px");
      const checked = await awake.getAttribute("aria-checked");
      await awake.click();
      await expect(awake).toHaveAttribute("aria-checked", checked === "true" ? "false" : "true");
      await dialog.getByRole("button", { name: /2\s*Appearance/ }).click();
      const choice = dialog.getByRole("radio", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      });
      await choice.click();
      await expect(choice).toBeChecked();
      await expect(choice).toHaveAttribute("data-selection-indicator", "accent-inset");
      await expect(choice).toHaveCSS("border-top-width", "1px");
      expect(await choice.evaluate((node) => getComputedStyle(node).boxShadow)).toContain("inset");
      const other = dialog.getByRole("radio", {
        name: theme === "light" ? "Dark" : "Light",
        exact: true,
      });
      await expect(other).toHaveCSS("border-top-width", "1px");
      const cardBorder = await other.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.border = "1px solid var(--ui-card-border)";
        node.append(probe);
        const color = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return color;
      });
      await expect(other).toHaveCSS("border-top-color", cardBorder);
      await choice.focus();
      await page.keyboard.press("ArrowRight");
      expect(
        await dialog.locator('.onboarding-mode-grid [role="radio"][aria-checked="true"]').count(),
      ).toBe(1);
      await choice.click();
      await page.screenshot({
        path: `temp/verification/onboarding-controls/appearance-${theme}-${width}.png`,
      });
    });
    test(`shared feature attention mark ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${fixture}?highlight&theme=${theme}`);
      const marker = page.locator('[data-feature-highlight="fixture-highlight"]');
      await expect(marker).toBeVisible();
      await expect(marker).toHaveCSS("width", "8px");
      await expect(marker).toHaveCSS("height", "8px");
      await expect(marker).toHaveCSS("position", "fixed");
      const markerBounds = (await marker.boundingBox())!;
      const targetBounds = (await page
        .getByRole("button", { name: "Fixture project", exact: true })
        .boundingBox())!;
      expect(markerBounds.x).toBeCloseTo(Math.round(targetBounds.x + targetBounds.width) - 10, 0);
      expect(markerBounds.y).toBeCloseTo(Math.round(targetBounds.y) - 2, 0);
      const pseudo = () =>
        marker.evaluate((node) => ({
          animation: getComputedStyle(node, "::after").animationName,
          duration: getComputedStyle(node, "::after").animationDuration,
        }));
      expect((await pseudo()).animation).not.toBe("none");
      expect((await pseudo()).duration).toBe("2.4s");
      await page.screenshot({
        path: `temp/verification/onboarding-controls/attention-motion-${theme}-${width}.png`,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect((await pseudo()).animation).toBe("none");
      await page.emulateMedia({ forcedColors: "active" });
      const highContrast = await marker.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.background = "CanvasText";
        node.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { expected, actual: getComputedStyle(node).backgroundColor };
      });
      expect(highContrast.actual).toBe(highContrast.expected);
      await page.emulateMedia({ forcedColors: "none" });
      await page.screenshot({
        path: `temp/verification/onboarding-controls/attention-reduced-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Fixture project", exact: true }).focus();
      await expect(marker).toHaveCount(0);
    });
  }

test.describe("coarse onboarding controls", () => {
  test.use({ hasTouch: true });
  test("coarse onboarding choice cards retain native toggle and selection", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fixture}?theme=dark`);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const dialog = page.getByRole("dialog");
    const row = dialog.locator("label.onboarding-feature").filter({ hasText: "Social Media" });
    const check = row.getByRole("checkbox");
    await expect(check).toBeChecked();
    await row.tap();
    await expect(check).not.toBeChecked();
    const awake = dialog.getByRole("switch", {
      name: "Prevent sleep while agents work",
      exact: true,
    });
    const before = await awake.getAttribute("aria-checked");
    await awake.tap();
    await expect(awake).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    await dialog.getByRole("button", { name: /2\s*Appearance/ }).tap();
    const choice = dialog.getByRole("radio", { name: "Dark", exact: true });
    await choice.tap();
    await expect(choice).toBeChecked();
    expect(await choice.evaluate((node) => getComputedStyle(node).boxShadow)).toContain("inset");
    await page.screenshot({
      path: "temp/verification/onboarding-controls/coarse-appearance-dark-800.png",
    });
  });
});
