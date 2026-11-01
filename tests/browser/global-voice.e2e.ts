import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/2026-11-01-global-voice");
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`global voice, unsent context and scope: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/voice-visual-styles.html?global=1&no-active=1&theme=${theme}`,
      );
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      const scope = panel.getByRole("radiogroup", { name: "Voice scope" });
      await expect(scope.getByRole("radio", { name: "Global", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(panel.getByRole("button", { name: "Start voice", exact: true })).toBeEnabled();
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-global-ready.png`),
        animations: "disabled",
      });
      await scope.getByRole("radio", { name: "Global", exact: true }).press("ArrowRight");
      await expect(scope.getByRole("radio", { name: "Session", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await scope.getByRole("radio", { name: "Session", exact: true }).press("ArrowLeft");
      await expect(scope.getByRole("radio", { name: "Global", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await page.evaluate(() => (window as any).fixtureVoice.speech("read draft"));
      await expect(panel).toContainText(
        "Unsent draft: Please review this unsent request before I send it.",
      );
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-unsent-draft.png`),
        animations: "disabled",
      });
      await page.evaluate(() => (window as any).fixtureVoice.speech("read file"));
      await expect(panel).toContainText("Attached text: Unsent attachment contents");
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-unsent-file.png`),
        animations: "disabled",
      });
      await page.evaluate(() => (window as any).fixtureVoice.speech("list projects"));
      await expect(panel).toContainText("The fixture project is available.");
      expect(await page.evaluate(() => (window as any).fixtureVoice.actions)).toEqual([
        "workspace.projects.list",
      ]);
      expect(
        await page.evaluate(() => [
          (window as any).fixtureVoice.submits,
          (window as any).fixtureVoice.stops,
        ]),
      ).toEqual([0, 0]);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      await expect(panel).toHaveAttribute("data-compact", "true");
      await expect(panel).toContainText("Global");
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-global-compact.png`),
        animations: "disabled",
      });
      await panel.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await page.evaluate(() =>
        (window as any).fixtureVoice.callbacks.error("Fixture connection unavailable.", true),
      );
      await expect(panel).toContainText("Fixture connection unavailable.");
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-global-error.png`),
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
