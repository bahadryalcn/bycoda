import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`notification collection flows with the page and stays searchable: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem(
          "bycoda.notificationProjects.v2",
          JSON.stringify(
            Array.from({ length: 40 }, (_, index) => ({
              id: `repository:github.com/team/project-${index}`,
              name: `team/project-${String(index).padStart(2, "0")}`,
              detail: "github.com",
              kind: "repository",
              paths: [],
            })),
          ),
        );
      });
      await page.goto(`/tests/browser/settings.html?section=notifications&theme=${theme}&lang=en`);
      mkdirSync("temp/verification/2026-10-18-notifications", { recursive: true });
      const sounds = page.locator('[data-setting-id="sounds"]');
      const label = (await sounds.locator(".settings-row-label").boundingBox())!;
      const control = (await sounds.locator(".settings-row-control").boundingBox())!;
      expect(control.x).toBeGreaterThanOrEqual(label.x + label.width);
      expect(control.y).toBeLessThan(label.y + label.height);
      await page.screenshot({
        path: `temp/verification/2026-10-18-notifications/${theme}-${width}-alerts.png`,
      });
      const list = page.locator(".project-notification-list");
      await expect(list.locator("fieldset")).toHaveCount(41);
      // The project list flows with the settings page instead of nesting a second scroller.
      const geometry = await list.evaluate((element) => ({
        height: element.clientHeight,
        content: element.scrollHeight,
        overflow: getComputedStyle(element).overflowY,
      }));
      expect(geometry.overflow).toBe("visible");
      expect(geometry.content).toBeLessThanOrEqual(geometry.height + 1);
      const search = page.getByRole("textbox", { name: "Search projects", exact: true });
      await search.fill("project-39");
      await expect(list.locator("fieldset")).toHaveCount(1);
      const trigger = list.getByRole("button", {
        name: "Notification categories for team/project-39 (github.com)",
      });
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await page.screenshot({
        path: `temp/verification/2026-10-18-notifications/${theme}-${width}-categories.png`,
      });
      const category = list.getByRole("switch", {
        name: "Agent finished for team/project-39 (github.com)",
        exact: true,
      });
      await category.focus();
      await page.keyboard.press("Space");
      await expect(category).not.toBeChecked();
      await search.fill("no-such-project");
      await expect(list).toContainText("No projects found");
      await search.fill("project-39");
      await expect(category).not.toBeChecked();
      await search.clear();
      await expect(list.locator("fieldset")).toHaveCount(41);
      await list.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/2026-10-18-notifications", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-notifications/${theme}-${width}.png`,
      });
    });
  }
}
