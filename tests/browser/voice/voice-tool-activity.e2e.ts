import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/voice-action-list");

for (const theme of ["light", "dark"])
  for (const width of [1280, 800, 375])
    test(`action history remains readable ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?activity-probe&activity-states&theme=${theme}&lang=en`,
      );
      const trigger = page.getByRole("button", { name: /Taking action/ });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const panel = page.getByRole("dialog", { name: "Voice actions" });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("listitem")).toHaveCount(7);
      for (const status of [
        "Running",
        "Waiting for you",
        "Failed",
        "Result unknown. Check before retrying.",
      ])
        await expect(panel.getByText(status, { exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Stop waiting" })).toHaveCount(2);
      await expect(panel).toContainText("1m 21s");
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      for (const row of await panel.getByRole("listitem").all()) {
        const parts = await row.locator(":scope > div, :scope > span").all();
        const detail = await parts[1].boundingBox();
        const duration = await parts[2].boundingBox();
        expect(detail!.x + detail!.width).toBeLessThanOrEqual(duration!.x);
      }
      await page.screenshot({ path: join(captures, `${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
    });
