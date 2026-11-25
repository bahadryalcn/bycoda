import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/host-tools/host-tools.html";
const captures = "temp/verification/2026-10-26-device-panel";
const recoveryCaptures = "temp/verification/device-failure-grace";

test("opening discovery silently recovers from one failed read", async ({ page }) => {
  await page.goto(`${fixture}?detached=1&devicesReady=1&deviceListFailures=1`);
  const panel = page.getByRole("region", { name: "Devices", exact: true });
  await expect(panel.getByText("Loading devices…", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Current device screen" })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(
    panel.getByText("The device connection is unavailable", { exact: false }),
  ).toHaveCount(0);
});

for (const detached of [0, 1])
  for (const theme of ["light", "dark"]) {
    test(`discovery interruption grace ${detached ? "detached" : "docked"} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${fixture}?detached=${detached}&theme=${theme}&deviceListFailures=2`);
      const panel = page.getByRole("region", { name: "Devices", exact: true });
      const error = panel.getByRole("alert");
      const path = `${recoveryCaptures}/${detached ? "detached" : "docked"}-${theme}`;
      await expect(panel.getByText("Loading devices…", { exact: true })).toBeVisible();
      await expect(error).toHaveCount(0);
      await page.screenshot({ path: `${path}-retrying.png` });
      await expect(error).toContainText("Could not load devices");
      await expect(panel.getByText("Unknown", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${path}-persistent.png` });
      await panel.getByRole("button", { name: "Refresh devices", exact: true }).click();
      await expect(error).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "Start emulator", exact: true }),
      ).toBeVisible();
    });
  }

test("selects a remote Mac from device setup without starting it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 980 });
  await page.goto(`${fixture}?detached=1&theme=dark`);
  const openSetup = () =>
    page.getByRole("button", { name: "Setup and access", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Setup and access", exact: true });
  await openSetup();
  await expect(setup.getByText("Xcode requires macOS")).toBeVisible();
  await setup.getByRole("button", { name: "Tool machine: This computer" }).click();
  await page.getByRole("option", { name: "Fixture MacBook", exact: true }).click();
  await expect(setup).toBeHidden();
  await openSetup();
  await expect(setup.getByRole("button", { name: "Tool machine: Fixture MacBook" })).toBeVisible();
  await expect(setup.getByText("Xcode requires macOS")).toBeHidden();
  await expect(setup.getByText("SDK detected")).toBeVisible();
  await expect(setup.getByText("Device host stopped")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mac-setup.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Connect devices", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start simulator", exact: true })).toBeVisible();
});

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`Duo fold controls ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 980 });
      await page.goto(`${fixture}?detached=1&devicesReady=1&duo=1&theme=${theme}`);
      await page.getByRole("button", { name: "Connect devices", exact: true }).click();
      await expect(page.getByRole("img", { name: "Current device screen" })).toBeVisible();
      await page.getByRole("button", { name: "Device options", exact: true }).click();
      const fold = page.getByRole("button", { name: "Fold device", exact: true });
      await expect(fold).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Half-open device", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Unfold device", exact: true })).toBeVisible();
      await mkdir("temp/verification/iphone-duo", { recursive: true });
      await page.screenshot({ path: `temp/verification/iphone-duo/${theme}-${width}.png` });
      for (const label of ["Fold device", "Half-open device", "Unfold device"])
        await page.getByRole("button", { name: label, exact: true }).click();
      expect(
        await page.locator(".device-panel").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    });
  }

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`device shared frames ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 980 });
      await page.goto(`${fixture}?detached=1&theme=${theme}`);
      await page.getByRole("button", { name: "Setup and access", exact: true }).click();
      const platforms = page.locator(".device-panel-setup-platforms > li");
      await expect(platforms).toHaveCount(2);
      expect(await platforms.nth(1).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe(
        "1px",
      );
      await page.screenshot({ path: testInfo.outputPath("setup.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Connect devices", exact: true }).click();
      const boot = page.getByRole("button", { name: /^Start (emulator|simulator)$/ });
      await expect(boot).toBeVisible();
      const row = page.locator(".device-panel-waiting > .device-panel-device-row");
      expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
      await page.screenshot({ path: testInfo.outputPath("waiting.png"), animations: "disabled" });
      await boot.click();
      await expect(
        page.getByRole("img", { name: "Current device screen", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".device-panel-stage[data-rail] .device-panel-canvas")).toHaveCSS(
        "padding-inline-end",
        "64px",
      );
      const groups = page.locator(".device-panel-rail > .device-panel-group");
      await expect(groups).toHaveCount(3);
      expect(await groups.nth(1).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
      await page.screenshot({ path: testInfo.outputPath("rail.png"), animations: "disabled" });
      await page.evaluate(() => {
        (
          window as unknown as { hostToolFixture: { deviceCaptureFailure: boolean } }
        ).hostToolFixture.deviceCaptureFailure = true;
      });
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      const error = page.locator(".device-panel-error");
      await expect(error).toBeVisible();
      expect(await error.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");
      await page.screenshot({ path: testInfo.outputPath("error.png"), animations: "disabled" });
      expect(
        await page.locator(".device-panel").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    });
  }

async function ready(page: Page, detached = true, theme = "dark") {
  await page.goto(`${fixture}?${detached ? "detached=1&" : ""}theme=${theme}`);
  // Opening the panel only observes the device host; connecting is explicit.
  await page.getByRole("button", { name: "Connect devices", exact: true }).click();
  await page.getByRole("button", { name: /^Start (emulator|simulator)$/ }).click();
  await expect(page.getByRole("img", { name: "Current device screen", exact: true })).toBeVisible();
}

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`device preview keeps its press target on the screen ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 980 });
      await ready(page, true, theme);
      const preview = page.getByRole("button", { name: /^Device screen\./ });
      await expect(preview).toBeEnabled();
      const image = page.getByRole("img", { name: "Current device screen" });
      const screen = (await image.boundingBox())!;
      const background = () => preview.evaluate((node) => getComputedStyle(node).backgroundColor);
      const idleBackground = await background();
      await mkdir("temp/verification/devices-response", { recursive: true });
      const capture = (state: string) =>
        page.screenshot({
          path: `temp/verification/devices-response/${theme}-${width}-${state}.png`,
        });
      await capture("idle");
      await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2);
      await page.mouse.down();
      await capture("pressed");
      expect(await background()).toBe(idleBackground);
      await page.mouse.up();
      const target = (await preview.boundingBox())!;
      expect(target.width).toBeCloseTo(screen.width, 0);
      expect(target.height).toBeCloseTo(screen.height, 0);
    });
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
        // The preview control fills the canvas content box beside the control rail.
        const canvas = node.parentElement!.getBoundingClientRect();
        return (
          node.naturalHeight *
          Math.min(canvas.width / node.naturalWidth, canvas.height / node.naturalHeight)
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
      ).toHaveCount(0);
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
  await page.getByRole("button", { name: "Mark device screen", exact: true }).click();
  await expect(page.getByText(/^Marking · Frozen frame( · .+)?$/)).toBeVisible();
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
  const dock = page.getByRole("complementary", { name: "Tool panels", exact: true });
  await expect(dock).toBeVisible();
  expect((await dock.boundingBox())!.width).toBeCloseTo(360, 0);
  const boot = dock.getByRole("button", { name: /^Start (emulator|simulator)$/ });
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

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`device panel visual caller states ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fixture}?detached=1&theme=${theme}`);
      await mkdir("temp/verification/automations-devices-visual", { recursive: true });
      await expect(
        page.getByRole("button", { name: "Connect devices", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-device-connect.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Connect devices", exact: true }).click();
      await expect(
        page.getByRole("button", { name: /^Start (emulator|simulator)$/ }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-device-waiting.png`,
        animations: "disabled",
      });
    });
  }

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`device support checking visual ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fixture}?detached=1&slowDeviceStatus&theme=${theme}`);
      await expect(page.getByText("Checking device support…", { exact: true })).toBeVisible();
      const status = page.getByRole("status").filter({ hasText: "Checking device support…" });
      const icon = await status.locator('span[aria-hidden="true"]').boundingBox();
      const label = await status.locator("span").last().boundingBox();
      expect(icon).not.toBeNull();
      expect(label).not.toBeNull();
      expect(Math.abs(icon!.y + icon!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(3);
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-device-support-loading.png`,
        animations: "disabled",
      });
      await expect(
        page.getByRole("button", { name: "Connect devices", exact: true }),
      ).toBeVisible();
    });
  }
