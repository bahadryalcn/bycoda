import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`worktree management: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/worktrees.html?theme=${theme}`);
      const surface = page.locator('[data-setting-id="project-worktrees"]');
      const list = surface.getByRole("list", { name: "Worktrees", exact: true });
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await expect(
        surface.getByRole("button", { name: "Create worktree", exact: true }),
      ).toBeEnabled();
      await expect(
        surface.getByRole("button", { name: "Reveal fix/missing", exact: true }),
      ).toBeDisabled();
      const locked = list
        .getByRole("listitem")
        .filter({ hasText: "Unlock this worktree in Git first" });
      await expect(locked.getByRole("button", { name: /^Delete / })).toBeDisabled();
      const details = surface.locator("details");
      await expect(details).not.toHaveAttribute("open", "");
      const dialog = page.getByRole("dialog", { name: "Worktrees", exact: true });
      const panel = await dialog.boundingBox();
      const content = await surface.boundingBox();
      expect(content!.x - panel!.x).toBeGreaterThanOrEqual(16);
      expect(panel!.x + panel!.width - content!.x - content!.width).toBeGreaterThanOrEqual(16);
      const overflow = await surface.evaluate((node) => ({
        content: node.scrollWidth,
        available: node.clientWidth,
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(overflow.content).toBeLessThanOrEqual(overflow.available + 1);
      expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);
      mkdirSync("temp/verification/2026-10-18-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-worktrees/${theme}-${width}.png`,
      });
      const search = surface.getByRole("textbox", { name: "Search worktrees", exact: true });
      await search.fill("MC/851");
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await search.fill("no-such-worktree");
      await expect(surface.getByRole("status")).toContainText("No results");
      await surface
        .getByRole("status")
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await details.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(details).toContainText("New worktrees are created in");
      await page.screenshot({
        path: `temp/verification/2026-10-18-worktrees/${theme}-${width}-details.png`,
      });
      expect(errors).toEqual([]);
    });
  }
}
