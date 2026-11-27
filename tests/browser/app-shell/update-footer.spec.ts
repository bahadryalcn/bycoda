import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const appVersion = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const route = "/tests/browser/app-shell/update-footer.html";
const captureRoot = "temp/verification/2026-10-27-update-footer";
const [major, minor, patch] = appVersion.split("-")[0].split(".");
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
const accountCaptureRoot = "temp/verification/2026-11-11-rail-size-reset";
const toolsCaptureRoot = "temp/verification/2026-11-13-rail-tools-selection";

test("update impact previews show active work and preserve cancel focus", async ({ page }) => {
  const capture = "temp/verification/update-running-work";
  mkdirSync(capture, { recursive: true });
  for (const kind of ["idle", "app", "host", "ssh", "loading", "error"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [1280, 800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${route}?impact=${kind}`);
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
        if (kind === "idle") {
          await expect(dialog.getByRole("table")).toHaveCount(0);
          await expect(dialog).not.toContainText("may be interrupted");
        } else if (kind === "loading" || kind === "error") {
          await expect(dialog).toContainText(
            kind === "error"
              ? "Machine activity could not be checked."
              : "Checking machine activity…",
          );
          if (kind === "error")
            await expect(dialog).toContainText("Unverified activity may also be interrupted.");
          else await expect(dialog).not.toContainText("may be interrupted");
        } else {
          await expect(dialog).toContainText("This computer");
          await expect(dialog).toContainText("Studio Mac");
          await expect(dialog).not.toContainText("Offline laptop");
          await expect(dialog).toContainText(
            kind === "app" ? "This app restarts" : "Host restarts",
          );
          await expect(dialog).toContainText(
            `Sessions that may be interrupted: ${kind === "app" ? 1 : kind === "host" ? 3 : 2}.`,
          );
          await expect(dialog).not.toContainText("Unverified activity may also be interrupted.");
        }
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `${capture}/${kind}-${theme}-${width}.png` });
      }
    }
  }
});

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
                body: location.search.includes("long-notes")
                  ? [
                      "### Added\n",
                      "- The model picker keeps its selection when the list changes size.",
                      "- Escape closes the Access or Mode menu without closing the model panel.",
                      "- The app recovers when the Host closes during startup.",
                      "\n### Changed\n",
                      "- Activity labels keep their separators and ellipses.",
                      "- Reconnecting restores the selected workspace and its open tabs.",
                      "- Draft messages stay in the composer when switching conversations.",
                      "\n### Fixed\n",
                      "- On Windows, the app relaunches if the WebView2 browser process exits.",
                      "- Keyboard focus returns to the sidebar after closing a dialog.",
                    ].join("\n")
                  : "Fixture release notes",
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

test("footer update is the only rail action and the dialog joined actions paint hover per segment", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(route);
  const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  await expect(update).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The repository prompt is part of the update dialog, never a standing footer action.
  await expect(page.locator("[data-github-star-prompt]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View bycoda on GitHub" })).toHaveCount(0);
  await update.focus();
  expect(await update.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    "none",
  );
  const { dialog, github, close } = await openUpdatePrompt(page);
  const group = dialog.locator("[data-github-star-prompt]");
  await expect(group.getByRole("button")).toHaveCount(2);
  const boxes = await Promise.all([github, close].map((button) => button.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 0.5);
  // The group owns only the outer boundary; each segment paints its own hover and press,
  // so the state always names the action under the pointer.
  const segments = [github, close];
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
  await github.click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __fixtureOpenedUrls: string[] }).__fixtureOpenedUrls,
    ),
  ).toEqual(["https://github.com/bahadryalcn/bycoda"]);
  await close.click();
  await expect(github).toHaveCount(0);
  await expect(dialog).toBeVisible();
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
    name: `What's new in ${appVersion}`,
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
    page.getByRole("button", { name: `What's new in ${nextVersion}`, exact: true }),
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
  await page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }).hover();
  await page.screenshot({ path: `${captureRoot}/footer-dark-hover.png` });
  await page.mouse.move(790, 10);
  await page.locator(".update-fixture-rail").evaluate((element) => {
    (element as HTMLElement).style.inlineSize = "200px";
  });
  const railBounds = (await page.locator(".update-fixture-rail").boundingBox())!;
  for (const button of await page.locator(".update-fixture-rail button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(railBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(railBounds.x + railBounds.width);
  }
  expect(
    await page
      .locator(".update-fixture-rail")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `${captureRoot}/footer-dark-narrow-200.png` });
  await page.locator(".update-fixture-rail").evaluate((element) => {
    (element as HTMLElement).style.removeProperty("inline-size");
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${captureRoot}/footer-dark-1280-normal-motion.png` });
});

test("installed update stays on one row with a corner dismiss action", async ({ page }) => {
  const capture = "temp/verification/whats-new-footer";
  mkdirSync(capture, { recursive: true });
  writeFileSync(
    `${capture}/README.md`,
    "# Installed update notice\n\nChromium account footer with a seeded update, real quick settings, and mocked account and voice state.\n",
  );
  // An update that is waiting takes the footer slot of the installed notice, so this row is
  // measured with no pending update.
  await page.addInitScript(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (command, args) =>
      command === "app_update_check" ? Promise.resolve(null) : invoke(command, args);
  });
  await page.goto(`${route}?account&installed-notice`);
  const rail = page.locator("[data-account-fixture-rail]");
  const footer = rail.locator("[data-sidebar-account-footer]");
  const notice = footer.getByRole("button", { name: `What's new in ${appVersion}`, exact: true });
  const dismiss = footer.getByRole("button", { name: "Dismiss update notification" });
  const settings = footer.getByRole("button", { name: "Settings", exact: true });
  const voice = footer.getByRole("button", { name: "Talk to Arif", exact: true });
  const notifications = footer.getByRole("button", { name: "Notifications", exact: true });
  await expect(notice).toBeVisible();
  await expect(dismiss).toBeVisible();
  await expect(voice).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const [viewportWidth, railWidth] of [
      [1280, 380],
      [800, 280],
    ]) {
      await page.setViewportSize({ width: viewportWidth, height: 800 });
      await rail.evaluate((element, width) => (element.style.inlineSize = `${width}px`), railWidth);
      await page.mouse.move(viewportWidth - 10, 10);
      await footer.screenshot({
        path: `${capture}/${theme}-${viewportWidth}.png`,
      });
      await expect(notice).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const centerY = (box: { y: number; height: number }) => box.y + box.height / 2;
      const bounds = async () =>
        Promise.all(
          [voice, notice, notifications, settings].map(
            async (button) => (await button.boundingBox())!,
          ),
        );
      const resting = await bounds();
      for (const box of resting)
        expect(Math.abs(centerY(box) - centerY(resting[1]))).toBeLessThan(2);
      const close = (await dismiss.boundingBox())!;
      const book = (await notice.locator("svg").boundingBox())!;
      const cross = (await dismiss.locator("svg").boundingBox())!;
      expect(centerY(cross)).toBeCloseTo(book.y, 0);
      expect(
        Math.abs(close.x + close.width / 2 - (resting[1].x + resting[1].width)),
      ).toBeLessThanOrEqual(2);
      expect(Math.abs(cross.x + cross.width / 2 - (book.x + book.width))).toBeLessThanOrEqual(4);
      expect(close.x).toBeGreaterThan(resting[1].x + resting[1].width / 2);
      await notice.hover();
      // The icon-only button is named by its label; a tooltip would only repeat it.
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      expect(await bounds()).toEqual(resting);
    }
  }
  await expect(notice.locator("svg.lucide-book-open")).toBeVisible();
  await notice.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-fixture-notes]")).toHaveText(appVersion);
  await dismiss.click();
  await expect(notice).toHaveCount(0);
  await expect(settings).toBeVisible();
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

test("footer update and assistant share the idle Settings surface", async ({ page }) => {
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
    const update = footer.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
    const settings = footer.getByRole("button", { name: "Settings", exact: true });
    await expect(assistant).toBeVisible();
    await expect(update).toBeVisible();
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
      for (const control of [assistant, update]) {
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

test("account footer carries no repository prompt, which lives in the update dialog", async ({
  page,
}) => {
  for (const compact of [false, true]) {
    await page.goto(`${route}?account${compact ? "&compact" : ""}`);
    const footer = page.locator("[data-sidebar-account-footer]");
    await expect(
      footer.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }),
    ).toBeVisible();
    await expect(footer.getByRole("button", { name: "View bycoda on GitHub" })).toHaveCount(0);
    await expect(
      footer.getByRole("button", { name: "Dismiss GitHub repository prompt" }),
    ).toHaveCount(0);
    await expect(footer.locator("[data-github-star-prompt]")).toHaveCount(0);
  }
});

/** Opens the update dialog from the footer and returns its repository prompt controls. */
async function openUpdatePrompt(page: Page) {
  await page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Update available" });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    github: dialog.getByRole("button", { name: "View bycoda on GitHub", exact: true }),
    close: dialog.getByRole("button", { name: "Dismiss GitHub repository prompt", exact: true }),
  };
}

test("update dialog keeps a fixed height and visible actions while release notes scroll", async ({
  page,
}) => {
  await page.addInitScript((version) => {
    localStorage.removeItem(`bycoda.githubStarPrompt.dismissed.${version}`);
  }, appVersion);
  const capture = "temp/verification/update-dialog-release-notes";
  mkdirSync(capture, { recursive: true });
  writeFileSync(
    `${capture}/README.md`,
    "# Update dialog\n\nBrowser fixture with mocked native updates.\n",
  );
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 560 });
      await page.goto(`${route}?account&long-notes`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const { dialog, github } = await openUpdatePrompt(page);
      const install = dialog.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
      const reminder = dialog.getByRole("button", { name: "Remind me tomorrow" });
      const notesToggle = dialog.locator("summary").filter({ hasText: "Release notes" });
      const body = dialog.locator('[data-modal-scroll="auto"]');
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.width).toBe(560);
      expect(bounds.height).toBe(476);
      await expect(install).toBeInViewport();
      await expect(github).toBeInViewport();
      await expect(dialog.getByRole("heading", { name: "Added", level: 3 })).toBeInViewport();
      await expect(
        dialog.getByText("The model picker keeps its selection when the list changes size.", {
          exact: true,
        }),
      ).toBeInViewport();
      const icon = install.locator("svg");
      await expect(icon).toBeVisible();
      expect(await icon.evaluate((element) => getComputedStyle(element).stroke)).toBe(
        await install.evaluate((element) => getComputedStyle(element).color),
      );
      await dialog.screenshot({ path: `${capture}/${theme}-${width}.png` });
      await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect(dialog.getByRole("heading", { name: "Fixed", level: 3 })).toBeInViewport();
      await expect(install).toBeInViewport();
      await expect(reminder).toBeInViewport();
      await notesToggle.click();
      await expect(dialog.getByRole("heading", { name: "Added", level: 3 })).toBeHidden();
      expect((await dialog.boundingBox())?.height).toBe(bounds.height);
    }
  }
});

test("update dialog star and dismiss retain separate pointer targets", async ({ page }) => {
  await page.goto(`${route}?account&compact`);
  const { dialog, github, close } = await openUpdatePrompt(page);
  const starBounds = (await github.boundingBox())!;
  const dismissBounds = (await close.boundingBox())!;
  expect(dismissBounds.x).toBeGreaterThanOrEqual(starBounds.x + starBounds.width - 0.5);
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
  await close.click();
  await expect(github).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Remind me tomorrow", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Update available" })).toBeVisible();
  await expect(github).toHaveCount(0);
});

test.describe("touch footer targets", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("update dialog dismiss never captures a tap intended for the star", async ({ page }) => {
    await page.goto(`${route}?account&compact`);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const { dialog, github, close } = await openUpdatePrompt(page);
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
    const dialogBounds = (await dialog.boundingBox())!;
    expect(dismissBounds.x + dismissBounds.width).toBeLessThanOrEqual(
      dialogBounds.x + dialogBounds.width,
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
    await expect(dialog).toBeVisible();
  });
});

test("wide footer opens the update tooltip without moving its actions", async ({ page }) => {
  await page.goto(`${route}?account`);
  const rail = page.locator("[data-account-fixture-rail]");
  const update = page.getByRole("button", { name: `Update to ${nextVersion}`, exact: true });
  await expect(update).toBeVisible();
  const actions = await rail.locator("[data-sidebar-account-footer]").getByRole("button").all();
  expect(actions.length).toBeGreaterThan(1);
  const bounds = () => Promise.all([rail, ...actions].map((action) => action.boundingBox()));
  const restingBounds = await bounds();
  const tooltip = page.getByRole("tooltip").filter({ hasText: `Update to ${nextVersion}` });
  await update.hover();
  await expect(tooltip).toBeVisible();
  expect(await bounds()).toEqual(restingBounds);
  await page.mouse.move(700, 10);
  await expect(tooltip).toBeHidden();
  await page.keyboard.press("Tab");
  await update.focus();
  await expect(tooltip).toBeVisible();
  expect(await bounds()).toEqual(restingBounds);
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

test("rail tools share the rail ground and the selected tool shows its plate", async ({ page }) => {
  mkdirSync(toolsCaptureRoot, { recursive: true });
  writeFileSync(
    `${toolsCaptureRoot}/README.md`,
    "# Rail tools browser evidence\n\nReal RailToolGroup inside a fixture rail; tool selection is browser-local state. These captures do not prove installed-app behavior.\n",
  );
  await page.goto(`${route}?tools`);
  const group = page.getByRole("group", { name: "Workspace tools" });
  const tool = (name: string) => group.getByRole("button", { name, exact: true });
  const plate = group.locator("[data-button-group-selection]");
  // The plate fills its segment (2px inside it), never just the icon's slot.
  const expectPlateOn = async (segment: Locator) => {
    await expect(plate).toHaveCount(1);
    await expect
      .poll(async () => {
        const [outer, inner] = [(await segment.boundingBox())!, (await plate.boundingBox())!];
        return [
          inner.x - outer.x,
          inner.y - outer.y,
          outer.width - inner.width,
          outer.height - inner.height,
        ].map(Math.round);
      })
      .toEqual([2, 2, 4, 4]);
  };
  await expect(tool("Inbox, New items")).toHaveAttribute("aria-current", "page");
  await expectPlateOn(tool("Inbox, New items"));
  // The unseen dot stays on the icon whether or not its tool is selected.
  const dotOffset = async () => {
    const [icon, dot] = [
      (await tool("Inbox, New items").locator("svg").first().boundingBox())!,
      (await tool("Inbox, New items").locator("span[data-appearance]").first().boundingBox())!,
    ];
    return [Math.round(dot.x - icon.x), Math.round(dot.y - icon.y)];
  };
  const selectedDot = await dotOffset();
  await tool("Tasks").click();
  await expectPlateOn(tool("Tasks"));
  expect(await dotOffset()).toEqual(selectedDot);
  for (const glass of [false, true]) {
    await page.evaluate(
      (on) => document.documentElement.classList.toggle("has-native-glass", on),
      glass,
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      expect(await group.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        "rgba(0, 0, 0, 0)",
      );
      await page.mouse.move(1270, 10);
      await page.screenshot({
        path: `${toolsCaptureRoot}/tools-${theme}${glass ? "-glass" : ""}.png`,
      });
    }
  }
});
