import { test, expect, type Page } from "@playwright/test";

// Deterministic UI fixture evidence only. No device, native bridge or live Host.
const fixture = "/tests/browser/host-tools.html?detached=1&devicesReady=1";
const captures = "temp/verification/2026-11-04-devices-upgrade/fixture";
const control = (page: Page) =>
  page.getByRole("switch", { name: "Allow device control", exact: true });
const image = (page: Page) => page.getByRole("img", { name: "Current device screen", exact: true });
const preview = (page: Page) =>
  page.getByRole("button", {
    name: "Device screen. Use arrow keys to swipe; use coordinate controls to press.",
    exact: true,
  });
const actions = (page: Page) =>
  page.evaluate(() =>
    (window as any).hostToolCalls.filter((call: any) => call.method === "devices.action"),
  );
async function ready(page: Page, extra = "") {
  await page.goto(`${fixture}${extra}`);
  // Opening the panel only observes the device host; connecting is explicit.
  await page.getByRole("button", { name: "Connect devices", exact: true }).click();
  await expect(image(page)).toBeVisible();
  await expect
    .poll(() => image(page).evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(360);
}
async function capture(page: Page, name: string) {
  await page.screenshot({ path: `${captures}/${name}.png`, animations: "disabled" });
}
async function expectReadableTextError(page: Page) {
  const message =
    "This device input supports printable ASCII only and cannot send %s. Enter this text on the device; your draft is kept.";
  const error = page
    .getByRole("dialog", { name: "Text to type on device", exact: true })
    .getByRole("alert")
    .filter({ hasText: message });
  await expect(error).toBeVisible();
  await expect(error).toContainText(message);
  // Shared field messages animate their row and individual words. A disabled
  // submit button precedes readable copy; wait for painted words, unclipped row
  // geometry and stable placement rather than capturing the first mounted frame.
  await expect
    .poll(() =>
      error.evaluate(async (node) => {
        const text = node.querySelector<HTMLElement>('[aria-hidden="true"]');
        if (!text || !text.textContent?.trim()) return false;
        const bounds = text.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return false;
        for (const word of text.querySelectorAll("span")) {
          if (Number(getComputedStyle(word).opacity) < 0.999) return false;
        }
        for (let ancestor: HTMLElement | null = text; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (Number(style.opacity) < 0.999) return false;
          if (style.overflowY === "hidden" || style.overflowY === "clip") {
            const clip = ancestor.getBoundingClientRect();
            if (bounds.top < clip.top - 0.5 || bounds.bottom > clip.bottom + 0.5) return false;
          }
        }
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
        const settled = text.getBoundingClientRect();
        return (["x", "y", "width", "height"] as const).every(
          (key) => Math.abs(bounds[key] - settled[key]) < 0.1,
        );
      }),
    )
    .toBe(true);
  await expect(error.locator('[aria-hidden="true"]')).toBeInViewport();
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`${theme} ${width}: view, control, inspector, retained frame and draft`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await ready(page, `&theme=${theme}`);
      await expect(control(page)).not.toBeChecked();
      expect(await actions(page)).toHaveLength(0);
      await capture(page, `${theme}-${width}-view-only`);
      await control(page).click();
      await expect(control(page)).toBeChecked();
      await capture(page, `${theme}-${width}-claimed`);
      await page.getByRole("button", { name: "Inspect device screen", exact: true }).click();
      const inspector = page.getByRole("dialog", {
        name: "Device accessibility inspector",
        exact: true,
      });
      await expect(inspector).toBeVisible();
      const bounds = (await image(page).boundingBox())!;
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * (220 / 640) };
      await page.mouse.move(point.x, point.y);
      await expect(page.locator(".device-panel-node-caption")).toContainText("Open workspace");
      await capture(page, `${theme}-${width}-inspector-hover`);
      expect(await actions(page)).toHaveLength(0);
      await page.mouse.click(point.x, point.y);
      await expect(inspector).toBeVisible();
      await expect(page.locator('.device-panel-nodes button[aria-pressed="true"]')).toContainText(
        "fixture-open",
      );
      await expect(
        page.locator('.device-panel-nodes button[aria-pressed="true"]'),
      ).not.toContainText("fixture-open-label");
      expect(await actions(page)).toHaveLength(0);
      await capture(page, `${theme}-${width}-inspector`);
      await page.getByRole("button", { name: "Press selected node", exact: true }).click();
      await expect.poll(async () => (await actions(page)).length).toBe(1);
      expect((await actions(page))[0].params.action.type).toBe("pressNode");
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        (window as any).hostToolFixture.deviceCaptureFailure = true;
      });
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await expect(page.getByText(/Last frame · Not live/)).toBeVisible();
      await expect(image(page)).toBeVisible();
      await capture(page, `${theme}-${width}-capture-recovery`);
      await page.evaluate(() => {
        (window as any).hostToolFixture.deviceCaptureFailure = false;
      });
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await page.getByRole("button", { name: "Mark device screen", exact: true }).click();
      await capture(page, `${theme}-${width}-annotation`);
      await page.getByRole("button", { name: "Annotation note", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Annotation note", exact: true })
        .fill("Keep this exact fixture frame and note");
      await page.evaluate(() => (window as any).hostDeviceFixtureRestoreUnknown());
      await expect(
        page.getByRole("button", { name: "Check attachment", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Check attachment", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Annotation note", exact: true })).toHaveValue(
        "Keep this exact fixture frame and note",
      );
      expect(await page.evaluate(() => (window as any).hostDeviceImageDraft)).toBeUndefined();
      await capture(page, `${theme}-${width}-uncertain-attachment-receipt`);
      await ready(page, `&theme=${theme}`);
      await control(page).click();
      await expect(control(page)).toBeChecked();
      await page.getByRole("button", { name: "Device text input", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Text to type on device", exact: true })
        .fill("Türkçe 日本語 %s");
      await expect(page.getByRole("button", { name: "Type text", exact: true })).toBeDisabled();
      await expectReadableTextError(page);
      await capture(page, `${theme}-${width}-text-validation`);
      await ready(page, `&theme=${theme}&deviceState=busy`);
      await expect(control(page)).toHaveAccessibleDescription(
        /Device control held by another controller/,
      );
      await capture(page, `${theme}-${width}-other-controller`);
      expect(await actions(page)).toHaveLength(0);
      await ready(page, `&theme=${theme}`);
      await page.evaluate(() => {
        (window as any).hostToolFixture.deviceLeaseMs = 500;
        (window as any).hostToolFixture.deviceRenewDelayMs = 1000;
      });
      await control(page).click();
      await expect(control(page)).toBeChecked();
      await expect(control(page)).not.toBeChecked({ timeout: 5000 });
      await capture(page, `${theme}-${width}-expired-control`);
      expect(await actions(page)).toHaveLength(0);
    });
  }
test("competing controller and expired control never dispatch input", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await ready(page, "&deviceState=busy");
  await expect(control(page)).toHaveAccessibleDescription(
    /Device control held by another controller/,
  );
  await expect(control(page)).not.toBeChecked();
  await capture(page, "busy-controller");
  expect(await actions(page)).toHaveLength(0);
  await ready(page);
  await page.evaluate(() => {
    (window as any).hostToolFixture.deviceLeaseMs = 500;
    (window as any).hostToolFixture.deviceRenewDelayMs = 1000;
  });
  await control(page).click();
  await expect(control(page)).toBeChecked();
  await expect(control(page)).not.toBeChecked({ timeout: 5000 });
  await capture(page, "expired-control");
  expect(await actions(page)).toHaveLength(0);
});
test("narrow short long labels, local text validation and keyboard swipe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 540 });
  await ready(page, "&deviceName=long&theme=light");
  await control(page).click();
  await expect(control(page)).toBeChecked();
  await preview(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await actions(page)).length).toBe(1);
  expect((await actions(page))[0].params.action.type).toBe("swipe");
  await page.getByRole("button", { name: "Device text input", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Text to type on device", exact: true });
  await input.fill("Türkçe 日本語 %s");
  await expect(page.getByRole("button", { name: "Type text", exact: true })).toBeDisabled();
  await expectReadableTextError(page);
  expect(await actions(page)).toHaveLength(1);
  await capture(page, "narrow-short-long-label-text-error-reduced-motion");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Device text input", exact: true }).click();
  await expect(input).toHaveValue("Türkçe 日本語 %s");
});

test("device text drafts survive switching targets without carrying control", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await ready(page);
  const select = async (name: string) => {
    await page.getByRole("button", { name: /^Selected device:/ }).click();
    await page.getByRole("option", { name: new RegExp(`^${name} `) }).click();
    await expect(control(page)).not.toBeChecked();
  };
  const edit = async () => {
    await control(page).click();
    await expect(control(page)).toBeChecked();
    await page.getByRole("button", { name: "Device text input", exact: true }).click();
    return page.getByRole("textbox", { name: "Text to type on device", exact: true });
  };
  await (await edit()).fill("First device unsent draft");
  await page.keyboard.press("Escape");
  await select("Second Android emulator");
  await expect(await edit()).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Text to type on device", exact: true })
    .fill("Second device draft");
  await page.keyboard.press("Escape");
  await select("Demo Android emulator");
  await expect(await edit()).toHaveValue("First device unsent draft");
  expect(await actions(page)).toHaveLength(0);
  await capture(page, "device-switch-retained-draft");
});
