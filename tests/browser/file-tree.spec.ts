import { expect, test } from "@playwright/test";

test("file tree preserves selection, inline rename, windowing and native external drop at both densities and themes", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/file-tree.html");
  const row = (path: string) => page.locator(`[role="treeitem"][title="/fixture/${path}"]`);
  await expect(row("a.ts")).toBeVisible();
  await row("a.ts").click();
  await row("b.ts").click({ modifiers: ["Control"] });
  await expect(row("a.ts")).toHaveAttribute("aria-selected", "true");
  await expect(row("b.ts")).toHaveAttribute("aria-selected", "true");
  await row("a.ts").click();
  await row("a.ts").press("F2");
  const rename = page.getByRole("textbox", {
    name: "Type file name. Press Enter to confirm or Escape to cancel.",
  });
  await expect(rename).toBeFocused();
  expect(
    await rename.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([0, 1]);
  await rename.fill("renamed.ts");
  await rename.press("Enter");
  await expect(row("renamed.ts")).toBeVisible();
  await row("renamed.ts").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await expect(rename).toBeFocused();
  await rename.press("Escape");
  await row("src").click();
  await expect(row("src/deep.ts")).toBeVisible();
  await row("src").press("ArrowRight");
  await expect(row("src/deep.ts")).toHaveAttribute("aria-selected", "true");
  await row("bulk").click();
  await expect(row("bulk/item199.ts")).toBeAttached();
  await expect(row("bulk/item249.ts")).toHaveCount(0);
  await page.getByRole("button", { name: "Show 150 more…", exact: true }).click();
  await expect(row("bulk/item249.ts")).toBeAttached();
  await row("bulk").click();
  await row("dest").scrollIntoViewIfNeeded();
  const target = await row("dest").boundingBox();
  const point = { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 };
  await page.evaluate(
    (point) =>
      (
        window as unknown as { treeNativeEmit: (name: string, payload: unknown) => void }
      ).treeNativeEmit("tauri://drag-over", { position: point }),
    point,
  );
  await expect(row("dest")).toHaveAttribute("data-tree-drop-target", "true");
  await page.evaluate(
    (point) =>
      (
        window as unknown as { treeNativeEmit: (name: string, payload: unknown) => void }
      ).treeNativeEmit("tauri://drag-drop", { position: point, paths: ["/external/dropped.txt"] }),
    point,
  );
  await expect(row("dest")).toHaveAttribute("aria-expanded", "true");
  await expect(row("dest/dropped.txt")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { treeOperations: { command: string }[] }).treeOperations.map(
        (x) => x.command,
      ),
    ),
  ).toEqual(["rename_path", "copy_path"]);
  for (const density of ["compact", "comfortable", "touch"])
    for (const light of [false, true])
      for (const width of [390, 1024]) {
        await page.evaluate(
          (density) => (document.documentElement.dataset.controlDensity = density),
          density,
        );
        await page.setViewportSize({ width, height: 700 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          light,
        );
        await expect(row("renamed.ts")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: info.outputPath("file-tree-narrow-light.png") });
});

test("preview find paints match/current highlights with shared theme roles and keeps keyboard navigation", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/file-tree.html?preview");
  await page.getByLabel("Markdown preview", { exact: true }).focus();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("needle");
  await expect(page.getByLabel("Find in preview", { exact: true })).toContainText("1 of 2");
  await find.press("Enter");
  await expect(page.getByLabel("Find in preview", { exact: true })).toContainText("2 of 2");
  for (const light of [false, true]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    const colors = await page
      .locator("p")
      .first()
      .evaluate((node) => [
        getComputedStyle(node, "::highlight(bycoda-file-preview-search-match)").backgroundColor,
        getComputedStyle(node, "::highlight(bycoda-file-preview-search-current)").backgroundColor,
      ]);
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[0]).not.toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: info.outputPath(`preview-highlights-${light ? "light" : "dark"}.png`),
    });
  }
  await find.press("Escape");
  await expect(find).toHaveCount(0);
});
