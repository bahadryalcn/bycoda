import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`working rows survive repeated follow-up messages in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto("/tests/browser/transcript.html?working-followup");
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
      await expect(toggle).toContainText("2 running");
      await expect(research).toBeVisible();
      await expect(server).toBeVisible();
      await expect(dock.getByRole("button", { name: "Stop all", exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`working-followup-${theme}-1280.png`) });
    await dock.getByRole("button", { name: "Stop all", exact: true }).click();
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
      await page.goto("/tests/browser/transcript.html?chat-layout&mixed-attachments");
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
      expect(fileBox!.width).toBeGreaterThan(imageBox!.width);
      expect(
        await file
          .getByText("notes.txt", { exact: true })
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(fileBox!.x + fileBox!.width).toBeLessThanOrEqual(imageBox!.x);
      // Clicking the reference label opens the same viewer as the filename.
      await file.getByText("file1", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("pre")).toHaveText("Attachment file content");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(file.getByRole("button")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog").locator("pre")).toHaveText("Attachment file content");
    });
  }
}
