import { expect, test } from "@playwright/test";
const fixture = "/tests/browser/onboarding.html";
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
  await expect(dialog.locator(".onboarding-crew-preview canvas")).toHaveCount(3);
  await expect
    .poll(() =>
      dialog
        .locator(".onboarding-crew-preview canvas")
        .evaluateAll((items) => items.every((item) => (item as HTMLCanvasElement).width > 100)),
    )
    .toBe(true);
  await dialog.locator('input[name="onboarding-crew"][value="star-wars"]').locator("..").click();
  await dialog.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await expect(dialog.locator('input[name="onboarding-crew"][value="none"]')).toBeInViewport();
  await expect(dialog.getByRole("checkbox", { name: "Decorative animations" })).toBeInViewport();
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
  await expect(dialog.locator('input[name="onboarding-crew"][value="star-wars"]')).toBeChecked();
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
    .filter({ has: page.getByRole("checkbox", { name: "Use Claude Code", exact: true }) });
  const codex = page
    .locator(".onboarding-agent")
    .filter({ has: page.getByRole("checkbox", { name: "Use Codex", exact: true }) });
  await expect(claude.getByRole("status")).toHaveText("Signed in");
  await expect(
    claude.getByRole("button", { name: "Sign in to Claude Code", exact: true }),
  ).toHaveCount(0);
  await expect(codex.getByRole("status")).toHaveText("CLI installed · not signed in");
  await expect(codex.getByRole("button", { name: "Sign in to Codex", exact: true })).toBeEnabled();
  await claude.getByRole("button", { name: "Terminal account profiles", exact: true }).click();
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
  await page.keyboard.press("Escape");
  await codex.getByRole("button", { name: "Show Codex CLI details", exact: true }).click();
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
    await dialog.locator('input[name="onboarding-crew"][value="none"]').locator("..").click();
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
    .filter({ has: page.getByRole("checkbox", { name: "Use Cursor", exact: true }) });
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
