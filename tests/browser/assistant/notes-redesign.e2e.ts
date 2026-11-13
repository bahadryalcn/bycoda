import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const out = "temp/verification/assistant-redesign-20261113/notes-editor";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`inline document editing ${theme} ${width}`, async ({ page }) => {
      await mkdir(out, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/notes-redesign.html?theme=${theme}`);
      const editor = page.getByRole("region", { name: "Edit note" });
      await expect(editor).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Document", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByRole("heading", { name: "Release review" })).toBeVisible();
      await page.screenshot({
        path: `${out}/${theme}-${width}-document.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Edit note block", exact: true }).first().click();
      await expect(editor.locator("[data-note-preview] .cm-content")).toBeVisible();
      await page.screenshot({
        path: `${out}/${theme}-${width}-block-edit.png`,
        animations: "disabled",
      });
      await page.getByRole("tab", { name: "Source", exact: true }).click();
      const content = editor.locator(".cm-content:visible");
      await expect(content).toContainText("# Release review");
      await page.screenshot({
        path: `${out}/${theme}-${width}-source.png`,
        animations: "disabled",
      });
      if (width === 1280) {
        await page.getByRole("tab", { name: "Split", exact: true }).click();
        await page.screenshot({
          path: `${out}/${theme}-${width}-split.png`,
          animations: "disabled",
        });
        await page.getByRole("tab", { name: "Source", exact: true }).click();
      } else await expect(page.getByRole("tab", { name: "Split", exact: true })).toHaveCount(0);
      await content.fill("# Exact draft\n\nUnsupported {{token}} and **Markdown**.");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Reopen note" }).click();
      await expect(editor.locator(".cm-content:visible")).toContainText("Unsupported {{token}}");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("button", { name: "Reopen note" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      expect(errors).toEqual([]);
    });
  }
test("uncertain save keeps exact read-only source", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/tests/browser/assistant/notes-redesign.html?theme=dark&fail");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Note save is pending. Retry to verify the original note."),
  ).toBeVisible();
  await expect(page.locator(".cm-content:visible")).toHaveAttribute("contenteditable", "false");
  await page.screenshot({ path: `${out}/dark-800-uncertain-save.png`, animations: "disabled" });
});
