import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`history search and clear confirmation ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/2026-11-04-room-history";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&redesign`);
      await page.getByRole("tab", { name: "History", exact: true }).click();
      const history = page.getByRole("region", { name: "History", exact: true });
      await expect(history.getByRole("heading", { name: "History", exact: true })).toBeVisible();
      const events = history.getByRole("listitem");
      await expect(events).toHaveCount(2);
      await expect(events.first()).toContainText("Started checking session recovery");
      await expect(events.first().locator("time")).toHaveAttribute("datetime", /T/);
      await expect(
        events.first().getByRole("button", { name: "Open session", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-history.png`),
      });
      const search = history.getByRole("searchbox", { name: "Search this section", exact: true });
      await search.fill("no-such-activity");
      await expect(history.getByRole("status")).toHaveText("No results");
      await search.fill("release");
      await expect(events).toHaveCount(1);
      await expect(events.first()).toContainText("Release note draft is waiting for your review");
      await search.fill("");
      await history.getByRole("button", { name: "Clear history", exact: true }).click();
      const confirm = page.getByRole("dialog");
      await expect(confirm).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-history-clear.png`),
      });
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(events).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
