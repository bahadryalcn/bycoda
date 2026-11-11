import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const folder = "temp/verification/2026-11-04-skill-marketplace";
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`catalog ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/skills/skill-catalog.html?theme=${theme}`);
      mkdirSync(folder, { recursive: true });
      await expect(page.getByRole("button", { name: "Discover skills" })).toBeVisible();
      await page.screenshot({ path: `${folder}/library-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Discover skills" }).click();
      const catalog = page.getByRole("dialog", { name: "Recommended skills" });
      await expect(catalog).toBeVisible();
      await expect(catalog.getByRole("heading", { name: "impeccable", exact: true })).toBeVisible();
      // "Before you install" is now a disclosure above the list, so scope to the skill's own recipe.
      const firstRecipe = catalog
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "impeccable", exact: true }) })
        .locator("details");
      await firstRecipe.locator("summary").click();
      await expect(firstRecipe.locator("code")).toContainText("skills@1.7.6");
      await expect(firstRecipe.locator("code")).toContainText(
        "https://github.com/pbakaus/impeccable/tree/main/.agents/skills/impeccable",
      );
      await expect(
        firstRecipe.getByRole("button", { name: "Installer reference", exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${folder}/catalog-${theme}-${width}.png` });
      await catalog.getByRole("button", { name: "Install impeccable", exact: true }).click();
      await expect(
        catalog.getByRole("button", { name: "Install impeccable", exact: true }),
      ).toBeDisabled();
      await expect(catalog.getByText("Installed", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: `${folder}/installed-${theme}-${width}.png` });
    });
  }
test("unknown completion checks status without resending", async ({ page }) => {
  await page.goto("/tests/browser/skills/skill-catalog.html?result=unknown");
  await page.getByRole("button", { name: "Discover skills" }).click();
  await page.getByRole("button", { name: "Install impeccable", exact: true }).click();
  await page.screenshot({ path: `${folder}/unknown-dark-1280.png` });
  await page.getByRole("button", { name: "Check installation of impeccable" }).click();
  await expect(
    page.getByRole("button", { name: "Install impeccable", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { skillCatalogFixtureCalls: { command: string }[] }
        ).skillCatalogFixtureCalls.filter((call) => call.command === "skill_catalog_install")
          .length,
    ),
  ).toBe(1);
});

test("selected scope and provider reach installation boundary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tests/browser/skills/skill-catalog.html");
  await page.getByRole("button", { name: "Discover skills" }).click();
  await page.getByRole("button", { name: /^Installation scope:/ }).click();
  await page.getByRole("option", { name: "This project", exact: true }).click();
  await page.getByRole("button", { name: /^Provider:/ }).click();
  await page.getByRole("option", { name: "Codex", exact: true }).click();
  await page.screenshot({ path: `${folder}/target-dark-1280.png` });
  await page.getByRole("button", { name: "Install impeccable", exact: true }).click();
  const calls = await page.evaluate(
    () => (window as unknown as { skillCatalogFixtureCalls: unknown[] }).skillCatalogFixtureCalls,
  );
  expect(calls).toContainEqual(
    expect.objectContaining({
      command: "skill_catalog_install",
      args: expect.objectContaining({ scope: "project", provider: "codex", cwd: "/fixture" }),
    }),
  );
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`download failure ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/skills/skill-catalog.html?result=failed&theme=${theme}`);
      await page.getByRole("button", { name: "Discover skills" }).click();
      await page.getByRole("button", { name: "Install impeccable", exact: true }).click();
      await expect(
        page.getByText("Could not download skill source (HTTP 503).", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${folder}/failed-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Install impeccable", exact: true }),
      ).toBeEnabled();
    });
  }

test("Turkish catalog searches translated purposes", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/tests/browser/skills/skill-catalog.html?lang=tr&theme=light");
  await page.getByRole("button", { name: "Skill keşfet", exact: true }).click();
  await page.getByRole("searchbox", { name: "Önerilen skill’lerde ara" }).fill("tasarım");
  await expect(page.getByRole("heading", { name: "impeccable", exact: true })).toBeVisible();
  await page.screenshot({ path: `${folder}/turkish-light-800.png` });
});
