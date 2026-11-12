import { expect, test, type Locator } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const appVersion = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const route = "/tests/browser/app-shell/update-footer.html";
const captureRoot = "temp/verification/2026-10-27-update-footer";
const nextVersion = "0.6.93";
const accountCaptureRoot = "temp/verification/2026-11-11-rail-size-reset";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ currentVersion, availableVersion }) => {
      localStorage.setItem("bycoda.language", "en");
      Object.assign(window, {
        __fixtureOpenedUrls: [] as string[],
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
          transformCallback: () => 1,
          invoke: async (command: string, args?: { url?: string }) => {
            if (command === "plugin:app|version") return currentVersion;
            if (command === "plugin:app|identifier") return "com.bycoda.desktop";
            if (command === "account_status")
              return { configured: true, signedIn: false, apiBaseUrl: null, environment: null };
            if (command === "assistant_presence_state" || command === "assistant_presence_refresh")
              return {
                revision: 1,
                sourceToken: "fixture-presence",
                status: { state: "present", setupComplete: true, assistantName: "Arif" },
                pending: false,
                statusError: false,
                writeError: false,
                retry: null,
              };
            if (command === "app_update_check")
              return {
                rid: 1,
                currentVersion,
                version: availableVersion,
                body: "Fixture release notes",
                rawJson: {},
              };
            if (command === "plugin:opener|open_url") {
              (window as unknown as { __fixtureOpenedUrls: string[] }).__fixtureOpenedUrls.push(
                args?.url ?? "",
              );
              return;
            }
            if (command.includes("download") || command.includes("install"))
              throw new Error("Native installation is forbidden in this browser fixture");
            if (command === "plugin:event|listen") return 1;
            return null;
          },
        },
      });
    },
    { currentVersion: appVersion, availableVersion: nextVersion },
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function paint(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, borderRadius: style.borderRadius };
  });
}

test("joined actions paint hover per segment and retain separate hit targets, focus and update access", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(route);
  const github = page.getByRole("button", { name: "View bycoda on GitHub", exact: true });
  const close = page.getByRole("button", { name: "Dismiss GitHub repository prompt", exact: true });
  const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  const group = page.locator("[data-github-star-prompt]");
  await expect(update).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(group.getByRole("button")).toHaveCount(3);
  const boxes = await Promise.all([github, close, update].map((button) => button.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 0.5);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 0.5);
  // The group owns only the outer boundary; each segment paints its own hover and press,
  // so the state always names the action under the pointer.
  const segments = [github, close, update];
  const rest = (await paint(group)).background;
  const hovers = [];
  for (const button of segments) {
    await button.hover();
    hovers.push((await paint(button)).background);
    expect(hovers.at(-1)).not.toBe("rgba(0, 0, 0, 0)");
    for (const child of segments)
      if (child !== button) expect((await paint(child)).background).toBe("rgba(0, 0, 0, 0)");
    expect((await paint(group)).background).toBe(rest);
  }
  const presses = [];
  for (const [index, button] of segments.entries()) {
    await button.hover();
    await page.mouse.down();
    presses.push((await paint(button)).background);
    expect(presses.at(-1)).not.toBe(hovers[index]);
    for (const child of segments)
      if (child !== button) expect((await paint(child)).background).toBe("rgba(0, 0, 0, 0)");
    await page.mouse.move(700, 10);
    await page.mouse.up();
  }
  await github.focus();
  await expect(github).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(update).toBeFocused();
  expect(await update.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    "none",
  );
  await github.click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __fixtureOpenedUrls: string[] }).__fixtureOpenedUrls,
    ),
  ).toEqual(["https://github.com/bahadryalcn/bycoda"]);
  await close.click();
  await expect(github).toHaveCount(0);
  await expect(update).toBeVisible();
  await page.reload();
  await expect(github).toHaveCount(0);
  await expect(update).toBeVisible();
  await update.click();
  await expect(page.getByRole("dialog", { name: "Update available" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("GitHub dismissal is scoped to a version", async ({ page }) => {
  await page.goto(`${route}?prompt&version=${appVersion}`);
  await page.getByRole("button", { name: "Dismiss GitHub repository prompt" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "View bycoda on GitHub" })).toHaveCount(0);
  await page.goto(`${route}?prompt&version=${nextVersion}`);
  await expect(page.getByRole("button", { name: "View bycoda on GitHub" })).toBeVisible();
});

test("installed notice survives reload and reading notes, closes persistently, then returns for the next install", async ({
  page,
}) => {
  await page.goto(route);
  const notice = page.getByRole("button", {
    name: `Updated to ${appVersion} — What's new`,
    exact: true,
  });
  await expect(notice).toBeVisible();
  await notice.click();
  await expect(page.locator("[data-fixture-notes]")).toHaveText(appVersion);
  await expect(notice).toBeVisible();
  await page.reload();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Dismiss update notification" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(notice).toHaveCount(0);
  await page.goto(`${route}?install=${nextVersion}`);
  await expect(
    page.getByRole("button", { name: `Updated to ${nextVersion} — What's new`, exact: true }),
  ).toBeVisible();
});

test("captures both themes and widths with disabled and pending shared actions", async ({
  page,
}) => {
  await page.goto(route);
  await expect(
    page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }),
  ).toBeVisible();
  const sample = page.getByRole("group", { name: "Representative actions" });
  await expect(sample.getByRole("button", { name: "Disabled action" })).toBeDisabled();
  await expect(sample.getByRole("button", { name: "Working" })).toBeDisabled();
  await sample.getByRole("button", { name: "Enabled action" }).click();
  await expect(page.locator("[data-fixture-clicks]")).toHaveText("1");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await page.mouse.move(width - 10, 10);
      await page.screenshot({ path: `${captureRoot}/footer-${theme}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.getByRole("button", { name: "Dismiss GitHub repository prompt" }).hover();
  await page.screenshot({ path: `${captureRoot}/footer-dark-hover.png` });
  await page.mouse.move(790, 10);
  await page.locator(".update-fixture-rail").evaluate((element) => {
    (element as HTMLElement).style.inlineSize = "200px";
  });
  const group = page.locator("[data-github-star-prompt]");
  const railBounds = (await page.locator(".update-fixture-rail").boundingBox())!;
  for (const button of await page.locator(".update-fixture-rail button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(railBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(railBounds.x + railBounds.width);
  }
  expect(await group.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `${captureRoot}/footer-dark-narrow-200.png` });
  await page.locator(".update-fixture-rail").evaluate((element) => {
    (element as HTMLElement).style.removeProperty("inline-size");
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${captureRoot}/footer-dark-1280-normal-motion.png` });
});

test("compact account rail preserves its width, standard targets and action order", async ({
  page,
}) => {
  await page.goto(`${route}?account&compact`);
  const rail = page.locator("[data-account-fixture-rail]");
  const footer = rail.locator("[data-sidebar-account-footer]");
  await expect(footer.getByRole("button", { name: "Talk to Arif", exact: true })).toBeVisible();
  await expect(footer.locator("[data-account-menu-trigger]")).toBeVisible();
  expect((await rail.boundingBox())!.width).toBe(56);
  const top = rail.getByRole("navigation", { name: "Workspace tools" });
  for (const button of await top.getByRole("button").all()) {
    expect((await button.boundingBox())!.height).toBe(28);
    const icon = button.locator("svg").first();
    expect((await icon.boundingBox())!.width).toBe(14);
  }
  for (const button of await footer.getByRole("button").all()) {
    expect((await button.boundingBox())!.height).toBe(28);
  }
  const order = await footer
    .getByRole("button", { includeHidden: true })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  expect(order).toEqual([
    "Talk to Arif",
    "View bycoda on GitHub",
    "Dismiss GitHub repository prompt",
    `Update to ${nextVersion}`,
    "Settings",
    expect.stringMatching(/^Account: Guest\./),
  ]);
  const bounds = (await rail.boundingBox())!;
  for (const button of await footer.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
});

test("footer star and assistant share the idle Settings surface", async ({ page }) => {
  const backgroundCaptureRoot = "temp/verification/2026-11-12-footer-background";
  mkdirSync(backgroundCaptureRoot, { recursive: true });
  writeFileSync(
    `${backgroundCaptureRoot}/README.md`,
    "# Footer background browser evidence\n\nReal SidebarAccountFooter and VoiceLauncher components, with native account, updater, presence and repository commands mocked. Captures cover wide and compact footers in light and dark themes. Installed application and live native behavior are not verified.\n",
  );
  for (const compact of [false, true]) {
    await page.goto(`${route}?account${compact ? "&compact" : ""}`);
    const footer = page.locator("[data-sidebar-account-footer]");
    const assistant = footer.getByRole("button", { name: "Talk to Arif", exact: true });
    const github = footer.getByRole("button", { name: "View bycoda on GitHub", exact: true });
    const settings = footer.getByRole("button", { name: "Settings", exact: true });
    const group = footer.locator("[data-github-star-prompt]");
    await expect(assistant).toBeVisible();
    await expect(github).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.mouse.move(1270, 10);
      await footer.screenshot({
        path: `${backgroundCaptureRoot}/${compact ? "compact" : "wide"}-${theme}.png`,
      });
      const settingsBackground = (await paint(settings)).background;
      expect.soft(settingsBackground).toBe("rgba(0, 0, 0, 0)");
      for (const control of [assistant, github, group]) {
        expect.soft((await paint(control)).background).toBe(settingsBackground);
        const borders = await control.evaluate((element) => {
          const visible = (style: CSSStyleDeclaration) =>
            style.display !== "none" &&
            style.borderTopStyle !== "none" &&
            parseFloat(style.borderTopWidth) > 0 &&
            style.borderTopColor !== "rgba(0, 0, 0, 0)";
          const overlay = getComputedStyle(element, "::after");
          return {
            control: visible(getComputedStyle(element)),
            overlay: overlay.content !== "none" && visible(overlay),
          };
        });
        expect.soft(borders).toEqual({ control: false, overlay: false });
      }
    }
  }
});

test("footer star and corner dismiss retain separate pointer targets", async ({ page }) => {
  await page.goto(`${route}?account&compact`);
  const github = page.getByRole("button", { name: "View bycoda on GitHub", exact: true });
  const close = page.getByRole("button", { name: "Dismiss GitHub repository prompt", exact: true });
  const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  await expect(update).toBeVisible();
  await expect(close).toBeHidden();
  await github.hover();
  await expect(close).toBeVisible();
  const starBounds = (await github.boundingBox())!;
  const dismissBounds = (await close.boundingBox())!;
  expect(dismissBounds.x).toBeGreaterThan(starBounds.x + starBounds.width / 2);
  expect(dismissBounds.y).toBeGreaterThan(starBounds.y + starBounds.height / 2);
  expect(dismissBounds.x).toBeLessThan(starBounds.x + starBounds.width);
  expect(dismissBounds.y).toBeLessThan(starBounds.y + starBounds.height);
  const targets = await page.evaluate(
    ({ star, dismiss }) => {
      const nameAt = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label");
      return {
        star: nameAt(star.x + star.width / 2, star.y + star.height / 2),
        dismiss: nameAt(dismiss.x + dismiss.width / 2, dismiss.y + dismiss.height / 2),
      };
    },
    { star: starBounds, dismiss: dismissBounds },
  );
  expect(targets).toEqual({
    star: "View bycoda on GitHub",
    dismiss: "Dismiss GitHub repository prompt",
  });
  await github.click();
  await expect(github).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __fixtureOpenedUrls: string[] }).__fixtureOpenedUrls,
    ),
  ).toEqual(["https://github.com/bahadryalcn/bycoda"]);
  await github.hover();
  await close.click();
  await expect(github).toHaveCount(0);
  await expect(update).toBeVisible();
  await page.reload();
  await expect(github).toHaveCount(0);
  await expect(update).toBeVisible();
});

test.describe("touch footer targets", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("corner dismiss never captures a tap intended for the star", async ({ page }) => {
    await page.goto(`${route}?account&compact`);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const rail = page.locator("[data-account-fixture-rail]");
    const github = page.getByRole("button", { name: "View bycoda on GitHub", exact: true });
    const close = page.getByRole("button", {
      name: "Dismiss GitHub repository prompt",
      exact: true,
    });
    const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
    await expect(update).toBeVisible();
    await expect(close).toBeVisible();
    const starBounds = (await github.boundingBox())!;
    const dismissBounds = (await close.boundingBox())!;
    const targets = await page.evaluate(
      ({ star, dismiss }) => {
        const nameAt = (x: number, y: number) =>
          document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label");
        return {
          star: nameAt(star.x + star.width * 0.525, star.y + star.height * 0.525),
          dismiss: nameAt(dismiss.x + dismiss.width / 2, dismiss.y + dismiss.height / 2),
        };
      },
      { star: starBounds, dismiss: dismissBounds },
    );
    expect(targets).toEqual({
      star: "View bycoda on GitHub",
      dismiss: "Dismiss GitHub repository prompt",
    });
    expect((await rail.boundingBox())!.width).toBe(56);
    const railBounds = (await rail.boundingBox())!;
    expect(dismissBounds.x + dismissBounds.width).toBeLessThanOrEqual(
      railBounds.x + railBounds.width,
    );
    await page.touchscreen.tap(
      starBounds.x + starBounds.width * 0.525,
      starBounds.y + starBounds.height * 0.525,
    );
    await expect(github).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __fixtureOpenedUrls: string[] }).__fixtureOpenedUrls,
      ),
    ).toEqual(["https://github.com/bahadryalcn/bycoda"]);
    await page.screenshot({ path: `${accountCaptureRoot}/compact-dark-touch-targets.png` });
    await close.tap();
    await expect(github).toHaveCount(0);
    await expect(update).toBeVisible();
  });
});

test("wide footer reveals the update label without changing rail width", async ({ page }) => {
  await page.goto(`${route}?account`);
  const rail = page.locator("[data-account-fixture-rail]");
  const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  await expect(update).toBeVisible();
  const labelPainted = () =>
    update.getByText("Update", { exact: true }).evaluate((element) => {
      let current: Element | null = element;
      while (current && current.tagName !== "BUTTON") {
        if (getComputedStyle(current).opacity === "0") return false;
        current = current.parentElement;
      }
      return true;
    });
  await expect.poll(labelPainted).toBe(false);
  const railWidth = (await rail.boundingBox())!.width;
  const collapsed = (await update.boundingBox())!.width;
  await update.hover();
  await expect
    .poll(async () => (await update.boundingBox())!.width)
    .toBeGreaterThan(collapsed + 20);
  await expect.poll(labelPainted).toBe(true);
  expect((await rail.boundingBox())!.width).toBe(railWidth);
  await update.focus();
  await page.mouse.move(700, 10);
  await expect
    .poll(async () => (await update.boundingBox())!.width)
    .toBeGreaterThan(collapsed + 20);
  const bounds = (await rail.boundingBox())!;
  for (const button of await rail
    .locator("[data-sidebar-account-footer]")
    .getByRole("button")
    .all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
});

test("captures account rail and footer in both themes and widths", async ({ page }) => {
  mkdirSync(accountCaptureRoot, { recursive: true });
  writeFileSync(
    `${accountCaptureRoot}/README.md`,
    "# Rail and footer browser evidence\n\nReal RailAction, SidebarAccountFooter and VoiceLauncher components. Account, updater, presence and repository operations use native-command mocks. These captures do not prove installed-app or live-native behavior.\n",
  );
  for (const compact of [true, false]) {
    await page.goto(`${route}?account${compact ? "&compact" : ""}`);
    await expect(page.getByRole("button", { name: "Talk to Arif", exact: true })).toBeVisible();
    await expect(page.locator("[data-account-menu-trigger]")).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [1280, 800]) {
        await page.setViewportSize({ width, height: 800 });
        await page.mouse.move(width - 10, 10);
        await page.screenshot({
          path: `${accountCaptureRoot}/${compact ? "compact" : "wide"}-${theme}-${width}.png`,
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  }
  await page.getByRole("button", { name: "View bycoda on GitHub", exact: true }).hover();
  await page.screenshot({ path: `${accountCaptureRoot}/wide-dark-star-hover.png` });
  await page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }).hover();
  await page.screenshot({ path: `${accountCaptureRoot}/wide-dark-update-hover.png` });
});

test("narrow expanded footer retains every action with a long assistant name", async ({ page }) => {
  const name = "ArifWithAnUnbrokenAssistantNameThatMustRemainInsideTheExistingSidebar";
  await page.goto(`${route}?account&narrow&name=${encodeURIComponent(name)}`);
  const rail = page.locator("[data-account-fixture-rail]");
  const footer = rail.locator("[data-sidebar-account-footer]");
  await expect(footer.getByRole("button", { name: `Talk to ${name}`, exact: true })).toBeVisible();
  await expect(footer.locator("[data-account-menu-trigger]")).toBeVisible();
  expect((await rail.boundingBox())!.width).toBe(200);
  const update = footer.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  await update.hover();
  const bounds = (await rail.boundingBox())!;
  for (const button of await footer.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.mouse.move(700, 10);
  await page.screenshot({ path: `${accountCaptureRoot}/wide-dark-narrow-200-long-name.png` });
});
