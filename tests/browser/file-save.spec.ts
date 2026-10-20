import { expect, test } from "@playwright/test";

test("save works from editor, Explorer and preview without taking over chat", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/file-save.html");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const source = page.getByRole("tab", { name: "Source", exact: true });
  const preview = page.getByRole("tab", { name: "Preview", exact: true });
  await source.click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("First edit");
  await expect(page.getByRole("tab", { name: "notes.md", exact: true })).toHaveAttribute("title", /Unsaved changes/);
  await expect(page.locator('button[aria-label="Close notes.md"] [aria-label="Unsaved changes"]')).toBeVisible();
  await expect(page.locator("footer [role=status]")).toContainText("Unsaved changes");
  await page.keyboard.press("Control+s");
  const writes = page.getByLabel("Disk writes");
  await expect(writes).toContainText("1: ");
  await expect(writes).toContainText("First edit");
  await expect(page.getByRole("tab", { name: "notes.md", exact: true })).not.toHaveAttribute("title", /Unsaved changes/);
  await page.keyboard.type(" second");
  await page.locator("button[data-explorer-root]").click();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("2: ");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" third");
  await preview.click();
  await expect(page.locator("[data-markdown-view-active]")).toContainText(
    "First edit second third",
  );
  await page.getByRole("textbox", { name: "Chat draft" }).focus();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("2: ");
  await save.click();
  await expect(writes).toContainText("3: ");
  await expect(page.locator("footer [role=status]")).toContainText("Saved");
  await preview.focus();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("4: ");

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    for (const light of [false, true]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        light,
      );
      await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: info.outputPath("save-mobile.png") });
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  await page.getByRole("switch", { name: "Autosave", exact: true }).click();
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  await source.click();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" autosaved");
  await expect(writes).toContainText("5: ");
  await expect(writes).toContainText("autosaved");
  await expect(page.getByRole("tab", { name: "notes.md", exact: true })).not.toHaveAttribute("title", /Unsaved changes/);
  expect(errors).toEqual([]);
});
