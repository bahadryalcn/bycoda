import { expect, test } from "@playwright/test";

for (const width of [800, 1000]) {
  for (const theme of ["light", "dark"] as const) {
    test(`attachment copy failure stays compact at ${width}px in ${theme}`, async ({
      page,
    }, info) => {
      const detail =
        "The request is not allowed by the user agent or the platform in the current context.";
      await page.addInitScript((message) => {
        let shouldFail = true;
        navigator.clipboard.write = async () => {
          if (!shouldFail) return;
          shouldFail = false;
          throw new DOMException(message, "NotAllowedError");
        };
      }, detail);
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.goto("/tests/browser/chat/transcript.html?artifacts");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");

      const actions = page.locator(".user-message-actions");
      const copy = actions.locator('button[aria-label="Copy message"]');
      const originalIcon = await copy.locator("svg").innerHTML();
      await copy.click();
      const alert = actions.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert.locator("svg:not(button svg)")).toHaveCount(1);
      await expect(alert).toContainText("Copy failed. Try again.");
      await expect(alert).not.toContainText(detail);
      expect(await copy.locator("svg").innerHTML()).toBe(originalIcon);
      await page.screenshot({ path: info.outputPath(`copy-failure-${theme}-${width}.png`) });
      await alert.getByRole("button", { name: /^Details/ }).click();
      await expect(page.getByRole("dialog")).toContainText(detail);
      await page.keyboard.press("Escape");
      await copy.click();
      await expect(alert).toHaveCount(0);
      await expect(actions.getByRole("button", { name: "Copied" })).toBeVisible();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`working rows survive repeated follow-up messages in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto("/tests/browser/chat/transcript.html?working-followup");
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("theme-light", value === "light");
    }, theme);
    const dock = page.getByRole("region", { name: "Turn activity", exact: true });
    const toggle = dock.getByRole("button", { name: /Background work, 2 running/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const research = dock.getByRole("button", { name: /Product research/ });
    const server = dock.getByRole("button", { name: /pnpm dev/ });
    await expect(research).toBeVisible();
    await expect(server).toBeVisible();
    for (let index = 0; index < 2; index++) {
      await page.getByRole("button", { name: "Send follow-up", exact: true }).click();
      await expect(toggle).toHaveAccessibleName(/2 running/);
      await expect(research).toBeVisible();
      await expect(server).toBeVisible();
      await expect(dock.getByRole("button", { name: "Stop all", exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`working-followup-${theme}-1280.png`) });
    // Stop all asks for a second press before it stops the work.
    const stopAll = dock.locator("[data-dock-stop-all]");
    await stopAll.click();
    await stopAll.click();
    await expect(dock).toHaveCount(0);
  });
}

for (const width of [390, 1000]) {
  for (const theme of ["light", "dark"]) {
    test(`mixed attachments remain readable and open at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme as "light" | "dark" });
      await page.goto("/tests/browser/chat/transcript.html?chat-layout&mixed-attachments");
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("theme-light", value === "light");
      }, theme);
      const strip = page.getByRole("group", { name: "Attachments", exact: true });
      const file = strip.locator('[data-attachment-chip="file"]');
      const image = strip.locator('[data-attachment-chip="image"]').first();
      await expect(file).toContainText("notes.txt");
      await expect(strip.locator('[data-attachment-chip="image"]')).toHaveCount(7);
      const fileBox = await file.boundingBox();
      const imageBox = await image.boundingBox();
      // File cards are one content-width row at least as wide as an image tile; both share the tile height.
      expect(imageBox!.width).toBe(88);
      expect(fileBox!.width).toBeGreaterThanOrEqual(imageBox!.width);
      expect(fileBox!.height).toBe(64);
      expect(imageBox!.height).toBe(fileBox!.height);
      expect(
        await file
          .getByText("notes.txt", { exact: true })
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(fileBox!.x + fileBox!.width).toBeLessThanOrEqual(imageBox!.x);
      await file.getByText("notes.txt", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("pre")).toHaveText("Attachment file content");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        file.getByRole("button", { name: "Open notes.txt full screen", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog").locator("pre")).toHaveText("Attachment file content");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      // The reference lives in the message and opens the same file viewer.
      const reference = page.getByRole("button", {
        name: "Open [file1] (notes.txt) full screen",
        exact: true,
      });
      await reference.click();
      await expect(dialog.locator("pre")).toHaveText("Attachment file content");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(reference).toBeFocused();
    });
  }
}
