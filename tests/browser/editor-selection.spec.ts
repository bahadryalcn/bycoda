import { expect, test } from "@playwright/test";

test("selected code has a clickable chat action, shortcut and dismiss behavior", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/editor-selection.html", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".cm-content");
  const toolbar = page.getByRole("toolbar", { name: "Selected code actions" });
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(toolbar).toContainText("Ctrl+L");
  // The action and shortcut remain on one row, as in the editor reference.
  await expect(toolbar.getByRole("button")).toHaveCSS("white-space", "nowrap");
  await page.screenshot({ path: info.outputPath("selected-code-chat-action.png") });
  await toolbar.getByRole("button").click();
  await expect(page.getByRole("textbox", { name: "Chat draft" })).toHaveValue(
    "Explain this code\n\n@src/value.ts (lines 1-2)\n\n",
  );
  await expect(toolbar).toHaveCount(0);
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Control+l");
  await expect(page.getByRole("textbox", { name: "Chat draft" })).toHaveValue(
    "Explain this code\n\n@src/value.ts (lines 1-2)\n\n@src/value.ts (line 1)\n\n",
  );
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  expect(errors).toEqual([]);
});
