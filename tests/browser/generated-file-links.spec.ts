import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`generated HTML, PDF and Word links retain message folder at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme as "light" | "dark" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/tests/browser/generated-file-links.html?theme=${theme}`);
      for (const [index, extension] of ["html", "pdf", "docx"].entries()) {
        const filename = `Firisbe-Observer-Yatirimci-Sunumu.${extension}`;
        const link = page.getByRole("link", { name: filename, exact: true });
        await expect(link).toBeVisible();
        await link.click();
        await expect(page.getByTestId("open-count")).toHaveText(String(index * 2 + 1));
        await expect(page.getByTestId("opened-path")).toHaveText(
          `G:/Projects/Firisbe/UI DEVELOPMENTS/ui-tests/investor-deck/${filename}`,
        );
        await expect(page.getByTestId("viewer-kind")).toHaveText(`Viewer: ${extension}`);
        await link.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("open-count")).toHaveText(String(index * 2 + 2));
        await expect(link).toBeFocused();
      }
      expect(errors).toEqual([]);
      const directory = resolve("temp/verification/2026-11-03-chat-file-links");
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(directory, `generated-file-links-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
