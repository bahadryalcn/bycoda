import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve("temp/verification/2026-11-14-working-redesign");
for (const light of [false, true])
  for (const width of [1280, 800]) {
    test(`current project summary and navigation ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/workspace/working-project-summary.html${light ? "?light" : ""}`,
      );
      const rail = page.locator('[data-fixture="rail"]');
      const sidebar = page.locator('[data-fixture="sidebar"]');
      for (const surface of [rail, sidebar]) {
        await expect(surface.locator("[data-live-agents-preview]")).toHaveCSS(
          "border-top-width",
          "0px",
        );
        await expect(surface.locator("[data-live-agents-project-summary]")).toHaveAttribute(
          "aria-label",
          "3 working in this project",
        );
        await expect(surface.locator("[data-live-agent-card]")).toHaveCount(2);
        await expect(surface.locator('[data-live-agent-card="x-1"]')).toHaveCount(0);
        await expect(surface.getByRole("button", { name: /more/ })).toHaveCount(0);
      }
      const section = rail.locator("[data-live-agents-preview]");
      const header = section.getByRole("button", { name: /Activity/, exact: false }).first();
      await expect(header).toContainText("5");
      await header.focus();
      await page.keyboard.press("Enter");
      await expect(rail.locator("[data-live-agents-project-summary]")).not.toBeVisible();
      await page.keyboard.press("Enter");
      await expect(rail.locator("[data-live-agents-project-summary]")).toBeVisible();
      await expect(section).toHaveCSS("border-top-width", "0px");
      await expect(rail).toHaveCSS("border-top-width", "1px");
      await rail.locator('[data-live-agent-card="y-1"]').click();
      await expect(page.locator("[data-selected]")).toHaveText("y-1");
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-mixed.png`),
      });
      await page.getByRole("button", { name: "Project Y", exact: true }).click();
      for (const surface of [rail, sidebar]) {
        await expect(surface.locator("[data-live-agents-project-summary]")).toHaveAttribute(
          "aria-label",
          "2 working in this project",
        );
        await expect(surface.locator('[data-live-agent-card="y-1"]')).toHaveCount(0);
      }
      await expect(rail.locator("[data-live-agent-card]")).toHaveCount(2);
      await rail.getByRole("button", { name: "1 more", exact: true }).click();
      await expect(rail.locator("[data-live-agent-card]")).toHaveCount(3);
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-switched.png`),
      });
      await page.goto(
        `/tests/browser/workspace/working-project-summary.html?currentOnly${light ? "&light" : ""}`,
      );
      await expect(rail.locator("[data-live-agents-project-summary]")).toHaveAttribute(
        "aria-label",
        "3 working in this project",
      );
      await expect(rail.locator("[data-live-agent-card]")).toHaveCount(0);
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-current-only.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`noncollapsible agent card ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/workspace/working-project-summary.html?noncollapsible${light ? "&light" : ""}`,
      );
      const card = page.locator('[data-fixture="rail"] [data-live-agents-preview]');
      await expect(card.getByRole("button", { name: "3 working in this project" })).toBeVisible();
      await expect(card.locator("[data-live-agent-card]")).toHaveCount(2);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/agents-card-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const light of [false, true])
  for (const width of [1280, 800]) {
    test(`attention groups and recovery navigation ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/workspace/working-project-summary.html?issues${light ? "&light" : ""}`,
      );
      const rail = page.locator('[data-fixture="rail"]');
      const attention = rail.locator('[data-live-agents-group="attention"]');
      await expect(attention.locator("[data-live-agent-card]")).toHaveCount(4);
      await expect(rail.locator('[data-live-agents-group="working"]')).toContainText(
        "This project1",
      );
      await expect(rail.locator('[data-live-agents-group="waiting"]')).toContainText(
        "Wait for build",
      );
      await expect(rail.locator('[data-live-agents-group="finished"]')).toContainText(
        "Update documentation",
      );
      for (const id of ["failed", "approval", "question", "retry"]) {
        await attention.locator(`[data-live-agent-card="${id}"]`).click();
        await expect(page.locator("[data-selected]")).toHaveText(id);
      }
      await rail.locator("[data-live-agents-project-summary]").click();
      await rail.locator('[data-live-agent-card="x-1"]').click();
      await expect(page.locator("[data-selected]")).toHaveText("x-1");
      const header = rail.getByRole("button", { name: /Activity/ }).first();
      await header.focus();
      await page.keyboard.press("Enter");
      await expect(header).toHaveAttribute("aria-expanded", "false");
      await expect(header.locator('[aria-label="4 need attention"]')).toBeVisible();
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-collapsed.png`),
      });
      await page.keyboard.press("Enter");
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-issues.png`),
      });
      await rail.locator('[data-live-agent-card="done"]').scrollIntoViewIfNeeded();
      await expect(rail.locator('[data-live-agent-card="waiting"]')).toBeVisible();
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-waiting-finished.png`),
      });
      await attention.locator('[data-live-agent-card="failed"]').scrollIntoViewIfNeeded();
      await rail.evaluate((element) => {
        element.style.width = "200px";
      });
      await expect(attention.locator('[data-live-agent-card="failed"]')).toBeVisible();
      expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    });
  }
