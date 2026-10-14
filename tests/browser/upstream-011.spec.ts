import { expect, test } from "@playwright/test";

test("narrow Markdown tables scroll within the panel and keep readable top-aligned columns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); await page.goto("/tests/browser/upstream-011.html", { waitUntil: "domcontentloaded" });
  const cells = page.locator('[data-table-panel] [data-streamdown="table-cell"]'); await expect(cells).toHaveCount(6);
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('[data-table-panel]') as HTMLElement;
    const cell = panel.querySelector('[data-streamdown="table-cell"]') as HTMLElement;
    const nodes = [...panel.querySelectorAll<HTMLElement>("div")];
    const scroller = nodes.find(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === "auto");
    return { panel: panel.getBoundingClientRect().width, cell: cell.getBoundingClientRect().width, align: getComputedStyle(cell).verticalAlign,
      scrolls: !!scroller, pageOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  expect(layout.cell).toBeGreaterThanOrEqual(159); expect(layout.align).toBe("top"); expect(layout.scrolls).toBe(true); expect(layout.pageOverflow).toBeLessThanOrEqual(1);
});

test("large open fences finish without losing line numbers, collapse controls or literal content", async ({ page }) => {
  await page.goto("/tests/browser/upstream-011.html", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Finish code", exact: true }).click();
  const body = page.locator('[data-code-panel] [data-streamdown="code-block-body"]');
  await expect(body).toContainText('const value349 = { text: "line 349", count: 349 };');
  await expect(body.locator("code > span")).toHaveCount(350);
  await expect(page.locator('[data-code-panel] .markdown-code-toggle')).toBeVisible();
});

test("image cursor zoom, pan, double-click reset and keys stay inside the image scope", async ({ page }) => {
  await page.goto("/tests/browser/upstream-011.html", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Open image", exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = "0.8"; });
  const dialog = page.getByRole("dialog"); const image = dialog.locator("img"); await expect(image).toBeVisible();
  const before = (await image.boundingBox())!; const point = { x: before.x + before.width * .7, y: before.y + before.height * .4 };
  const pixelRatio = await page.evaluate(() => devicePixelRatio);
  await page.mouse.move(point.x, point.y); await page.keyboard.down("Control"); await page.mouse.wheel(0, -120); await page.keyboard.up("Control");
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width);
  const after = (await image.boundingBox())!;
  expect(after.x + after.width * .7).toBeCloseTo(point.x, 0); expect(after.y + after.height * .4).toBeCloseTo(point.y, 0);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(pixelRatio);
  await page.mouse.down(); await page.mouse.move(point.x - 70, point.y + 35, { steps: 5 }); await page.mouse.up();
  await expect(dialog).toBeVisible(); const panned = (await image.boundingBox())!; expect(panned.x).toBeLessThan(after.x - 40);
  await image.dblclick(); await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
  await image.click(); await page.keyboard.press("+"); await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width);
  await page.keyboard.press("0"); await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
  await page.getByRole("button", { name: "Close image preview", exact: true }).click(); await expect(dialog).toHaveCount(0);
});
