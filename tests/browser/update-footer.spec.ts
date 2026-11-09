import { expect, test, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";

const appVersion = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const route = "/tests/browser/update-footer.html";
const captureRoot = "temp/verification/2026-10-27-update-footer";
const nextVersion = "0.6.93";

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
