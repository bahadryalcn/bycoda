import { expect, test } from "@playwright/test";

test("uzun metin önizlemesi ve penceresinde metin fareyle seçilip kopyalanır", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  await page.goto("/tests/browser/transcript.html?longText");
  const trigger = page.getByRole("button", { name: "Show full long text" });
  await trigger.hover();
  const preview = page
    .locator("[id]")
    .filter({ has: page.getByText("Long text preview", { exact: true }) })
    .last();
  await expect(preview.getByRole("button", { name: "Copy message" })).toBeVisible();
  const selectExcerpt = async (selector: string) => {
    const pre = page.locator(selector);
    await expect(pre).toHaveCSS("user-select", "text");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Visibility alone can catch the preview/modal during its scale animation.
    // Hover waits for stable geometry before we measure real mouse coordinates.
    await pre.hover();
    const points = await pre.evaluate((element) => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, "Selectable excerpt".length);
      const rect = range.getBoundingClientRect();
      return {
        x: rect.x + 1,
        y: rect.y + rect.height / 2,
        // The excerpt is the entire first line. Land beyond its final glyph so
        // fractional coordinate rounding cannot omit the last character.
        end: rect.right + 2,
      };
    });
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.end, points.y, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("Selectable excerpt");
    if (browserName === "chromium") {
      await page.keyboard.press("Control+c");
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("Selectable excerpt");
    }
  };
  await selectExcerpt("[id] > pre.select-text");
  await page.getByRole("button", { name: "Show full content", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Copy message" })).toBeVisible();
  await selectExcerpt('[role="dialog"] pre');
  if (browserName === "chromium") {
    await dialog.getByRole("button", { name: "Copy message" }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n")),
      )
      .toBe("Selectable excerpt\n" + "Long content ".repeat(200).trimEnd());
  }
});
