import { expect, test } from "@playwright/test";

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
