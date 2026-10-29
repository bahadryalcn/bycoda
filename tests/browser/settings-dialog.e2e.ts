import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Settings opens as a dialog over a workspace that stays mounted (the App wiring), not as a page.
const evidence = "temp/verification/2026-10-28-ui-redesign/n1";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`settings dialog over workspace: ${theme} ${width}`, async ({
      page,
    }) => {
      mkdirSync(evidence, { recursive: true });
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings.html?dialog=1&theme=${theme}&lang=en`,
      );
      const workspace = page.locator("[data-workspace-chrome]");
      const draft = page.getByLabel("Workspace draft");
      await draft.fill("unsent draft");
      const opener = page.getByTestId("open-settings");
      await opener.focus();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Loading Settings…")).toHaveCount(0);
      await expect(dialog.locator("[data-settings-embedded]")).toBeVisible();
      // The work context stays mounted and visible behind the dialog, inert rather than hidden.
      await expect(workspace).toBeVisible();
      expect(
        await workspace.evaluate(
          (el) => !!el.closest("[inert]") || el.hasAttribute("inert"),
        ),
      ).toBe(true);
      expect(await workspace.getAttribute("aria-hidden")).toBeNull();
      // One chrome: the embedded page draws no second titlebar or window controls.
      await expect(dialog.locator("[data-window-controls]")).toHaveCount(0);
      // The shared Modal close control stays visible and reachable above the embedded page.
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeVisible();
      const hit = await close.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return top === el || el.contains(top)
          ? true
          : `${top?.tagName}.${top?.className}`;
      });
      expect(hit).toBe(true);
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width - 24);
      expect(box.height).toBeLessThanOrEqual(800 - 24);
      await page.screenshot({
        path: `${evidence}/settings-dialog-${theme}-${width}.png`,
      });

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(draft).toHaveValue("unsent draft");
    });
  }
}

test("settings dialog Archive reports unavailable history and retries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(
    "/tests/browser/settings.html?dialog=1&section=archive&history=failed&lang=en",
  );
  await page.getByTestId("open-settings").click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByRole("button", { name: /retry/i })).toBeVisible();
  await dialog.getByRole("button", { name: /retry/i }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-fixture-retries",
    "1",
  );
});
