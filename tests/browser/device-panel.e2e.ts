import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/host-tools.html";
const captures = "temp/verification/2026-10-26-device-panel";

async function ready(page: Page, detached = true, theme = "dark") {
  await page.goto(`${fixture}?${detached ? "detached=1&" : ""}theme=${theme}`);
  await page.getByRole("button", { name: "Boot", exact: true }).click();
  await expect(page.getByRole("img", { name: "Current device screen", exact: true })).toBeVisible();
}

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const layer = page.locator(".image-annotation-canvas-layer");
  const bounds = (await layer.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * from.x, bounds.y + bounds.height * from.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * to.x, bounds.y + bounds.height * to.y, {
    steps: 6,
  });
  await page.mouse.up();
}

test("device screen occupies the pane and controls stay compact in both themes and narrow widths", async ({
  page,
}) => {
  for (const theme of ["dark", "light"]) {
    for (const width of [360, 480]) {
      await page.setViewportSize({ width, height: 980 });
      await ready(page, true, theme);
      const image = page.getByRole("img", { name: "Current device screen", exact: true });
      const screen = (await image.boundingBox())!;
      const expectedHeight = await image.evaluate((node: HTMLImageElement) => {
        const canvas = node.parentElement!.getBoundingClientRect();
        return (
          node.naturalHeight *
          Math.min((canvas.width - 6) / node.naturalWidth, (canvas.height - 6) / node.naturalHeight)
        );
      });
      expect(screen.height).toBeGreaterThanOrEqual(expectedHeight - 2);
      const ratio = await image.evaluate((node: HTMLImageElement) => {
        const bounds = node.getBoundingClientRect();
        return {
          rendered: bounds.width / bounds.height,
          original: node.naturalWidth / node.naturalHeight,
        };
      });
      expect(ratio.rendered).toBeCloseTo(ratio.original, 2);
      await expect(
        page.getByRole("button", { name: "Mark device screen", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("switch", { name: "Allow device control", exact: true }),
      ).not.toBeChecked();
      await expect(
        page.getByRole("textbox", { name: "App name or bundle ID", exact: true }),
      ).toHaveCount(0);
      expect(
        await page
          .locator(".device-panel")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: `${captures}/integrated-${theme}-${width}.png` });
    }
  }
});

test("frozen-frame drawing supports all tools and history without sending device input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 980 });
  await ready(page);
  await page.getByRole("switch", { name: "Allow device control", exact: true }).click();
  await page.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await expect(page.getByText("Marking · Frozen frame", { exact: true })).toBeVisible();
  const frozenAt = await page.locator(".device-panel-frame-state").getAttribute("title");
  const image = page.getByRole("img", { name: "Current device screen", exact: true });
  const source = await image.getAttribute("src");
  const marks = page.locator(".image-annotation-canvas-marks > *");
  await draw(page, { x: 0.15, y: 0.25 }, { x: 0.6, y: 0.45 });
  await expect(marks).toHaveCount(1);
  await page.getByRole("button", { name: "Draw arrow", exact: true }).click();
  await draw(page, { x: 0.6, y: 0.2 }, { x: 0.5, y: 0.4 });
  await page.getByRole("button", { name: "Draw freehand", exact: true }).click();
  await draw(page, { x: 0.2, y: 0.5 }, { x: 0.6, y: 0.6 });
  await page.getByRole("button", { name: "Add numbered pin", exact: true }).click();
  await draw(page, { x: 0.3, y: 0.65 }, { x: 0.3, y: 0.65 });
  await expect(marks).toHaveCount(4);
  await expect(page.locator(".image-annotation-canvas-pin text")).toHaveText("1");
  await page.getByRole("button", { name: "Undo annotation", exact: true }).click();
  await expect(marks).toHaveCount(3);
  await page.getByRole("button", { name: "Redo annotation", exact: true }).click();
  await expect(marks).toHaveCount(4);
  expect(await page.locator(".device-panel-frame-state").getAttribute("title")).toBe(frozenAt);
  await expect(image).toHaveAttribute("src", source!);
  expect(
    await page.evaluate(() =>
      (window as any).hostToolCalls.filter(
        (call: { method: string }) => call.method === "devices.action",
      ),
    ),
  ).toEqual([]);
  await page.screenshot({ path: `${captures}/integrated-marking.png` });
});

test("adds the marked image and preserved comment to the originating conversation draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 980 });
  await ready(page);
  const source = await page
    .getByRole("img", { name: "Current device screen", exact: true })
    .getAttribute("src");
  await page.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await draw(page, { x: 0.15, y: 0.25 }, { x: 0.6, y: 0.45 });
  await page.getByRole("button", { name: "Annotation note", exact: true }).click();
  const note = page.getByRole("textbox", { name: "Annotation note", exact: true });
  await note.fill("Keep this control readable and compact.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Annotation note", exact: true }).click();
  await expect(note).toHaveValue("Keep this control readable and compact.");
  const dialog = page.getByRole("dialog", { name: "Annotation note", exact: true });
  await dialog.getByRole("button", { name: "Add marked image to draft", exact: true }).click();
  await expect(page.getByText("Image added to draft.", { exact: true })).toBeVisible();
  const result = await page.evaluate(async (original) => {
    const draft = (window as any).hostDeviceImageDraft;
    const pixel = async (src: string) => {
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
      });
      image.src = src;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return [
        ...context.getImageData(
          Math.round(canvas.width * 0.15),
          Math.round(canvas.height * 0.35),
          1,
          1,
        ).data,
      ];
    };
    return {
      name: draft.file.name,
      kind: draft.file.kind,
      size: draft.file.size,
      context: draft.context,
      originalPixel: await pixel(original!),
      exportedPixel: await pixel(`data:${draft.file.mimeType};base64,${draft.file.data}`),
    };
  }, source);
  expect(result).toMatchObject({ name: "device-screen.png", kind: "image" });
  expect(result.size).toBeGreaterThan(0);
  expect(result.context).toContain("Keep this control readable and compact.");
  expect(result.context).toContain("Demo Android emulator");
  expect(result.exportedPixel).not.toEqual(result.originalPixel);
  expect(
    await page.evaluate(() =>
      (window as any).hostToolCalls.filter(
        (call: { method: string }) => call.method === "devices.action",
      ),
    ),
  ).toEqual([]);
});

test("right dock retains a usable screen and annotation tools at 360px", async ({ page }) => {
  // The app preserves a 320px conversation beside a 6px splitter and the 360px dock.
  await page.setViewportSize({ width: 686, height: 900 });
  await ready(page, false);
  // The production workspace is hosted in a height-constrained application shell.
  // This fixture's inline tools view otherwise leaves its percentage height unresolved.
  await page.evaluate(() => {
    document.getElementById("root")!.style.height = "100dvh";
    window.scrollTo(0, 0);
  });
  await page.evaluate(() =>
    (window as any).hostToolsUiApi("ui.tools.open", { tab: "devices", placement: "right" }),
  );
  const dock = page.locator(".tools-workspace-dock");
  await expect(dock).toBeVisible();
  expect((await dock.boundingBox())!.width).toBeCloseTo(360, 0);
  const boot = dock.getByRole("button", { name: "Boot", exact: true });
  if (await boot.isVisible()) await boot.click();
  const image = dock.getByRole("img", { name: "Current device screen", exact: true });
  await expect(image).toBeVisible();
  await dock.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await expect(
    dock.getByRole("toolbar", { name: "Image annotation tools", exact: true }),
  ).toBeInViewport();
  expect(await dock.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `${captures}/integrated-dock-360.png` });
});
