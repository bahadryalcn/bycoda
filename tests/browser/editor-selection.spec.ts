import { expect, test } from "@playwright/test";

for (const mode of ["file", "inline", "split"]) {
  test(`find stays readable and visible while scrolling ${mode}`, async ({ page }, info) => {
    await page.goto(`/tests/browser/editor-selection.html?search=${mode}`);
    const editor = page.locator(".cm-editor").last();
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+f");
    const find = editor.getByRole("textbox", { name: "Find", exact: true });
    await find.fill("value");
    await expect(editor.locator(".cm-find-count")).toContainText("300");

    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      for (const light of [false, true]) {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          light,
        );
        const minimumWidth = mode === "split" && width === 390 ? 60 : 100;
        await expect
          .poll(async () => (await find.boundingBox())?.width ?? 0)
          .toBeGreaterThan(minimumWidth);
        const panel = editor.locator(".cm-find");
        const bounds = await panel.boundingBox();
        for (const control of await panel.locator("input, button, .cm-find-count").all()) {
          if (!(await control.isVisible())) continue;
          const box = (await control.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
          expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        }
      }
    }

    await page.setViewportSize({ width: mode === "split" ? 768 : 390, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scroller =
      mode === "split" ? page.locator(".cm-mergeView") : editor.locator(".cm-scroller");
    await scroller.evaluate((node) => {
      node.scrollTop = 1500;
    });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    await expect
      .poll(async () => {
        const panel = (await editor.locator(".cm-find").boundingBox())!;
        const area = (await (mode === "split" ? scroller : editor).boundingBox())!;
        return panel.y >= area.y - 1 && panel.y + panel.height <= area.y + area.height;
      })
      .toBe(true);
    await expect(find).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`find-${mode}.png`) });
    await find.press("Enter");
    await expect(editor.locator(".cm-find-count")).toContainText("2 of 300");
    await editor.getByRole("button", { name: "Toggle Replace" }).click();
    await expect(editor.getByRole("textbox", { name: "Replace", exact: true })).toBeVisible();
    await find.press("Escape");
    await expect(find).toHaveCount(0);
  });
}

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
