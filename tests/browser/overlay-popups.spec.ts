import { expect, test, type Page } from "@playwright/test";

// Fixture evidence for the shared popup stack (Popover, Modal, ConfirmDialog,
// tooltip). Memory-only page: no Host, clipboard, account or preference action.
// The "native host" scenarios use a fixture-provided element, not a native window.

const SHOTS = "temp/verification/2026-10-28-session5-overlays/popups";
const PREFIX = process.env.OVERLAY_SHOT_PREFIX ?? "";
const URL = "/tests/browser/overlay-popups.html";
const THEMES = ["light", "dark"] as const;
const SIZES = [
  [1280, 800],
  [800, 600],
] as const;

// Headless Chromium hides scrollbars by default; the shared thin rail must be visible
// both for the evidence and for the scrollbar-press assertion.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function setup(page: Page, theme: "light" | "dark", width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto(URL);
  await page.evaluate(
    (light) => document.documentElement.classList.toggle("theme-light", light),
    theme === "light",
  );
}

async function shot(page: Page, name: string, theme: string, size: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${PREFIX}${name}-${theme}-${size}.png` });
}

const bg = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

const rootBg = (page: Page, variable: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, variable);

const log = (page: Page) => page.evaluate(() => window.__overlayLog.slice());
const inDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));

test.describe("captures", () => {
  for (const theme of THEMES) {
    for (const [width, height] of SIZES) {
      const size = String(width);
      test(`surfaces ${theme} ${size}`, async ({ page }) => {
        await setup(page, theme, width, height);
        for (const scene of [
          "modal-sm",
          "modal-md",
          "modal-lg",
          "sheet",
          "confirm-plain",
          "confirm-pending",
        ]) {
          await page.getByTestId(`open-${scene}`).click();
          if (scene === "confirm-pending") {
            await page.getByRole("button", { name: "Delete" }).click();
          }
          await shot(page, scene, theme, size);
          if (scene === "confirm-pending") await page.evaluate(() => window.__resolveConfirm?.());
          else await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        for (const mode of ["clip", "scroll", "intrinsic"]) {
          await page.getByTestId(`popover-${mode}`).click();
          await shot(page, `popover-${mode}`, theme, size);
          await page.keyboard.press("Escape");
        }
        await page.getByTestId("tooltip-icon").focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(page.getByRole("tooltip")).toBeVisible();
        await shot(page, "tooltip", theme, size);
      });
    }
  }

  test("narrow and short viewports", async ({ page }) => {
    for (const theme of THEMES) {
      await setup(page, theme, 390, 780);
      await page.getByTestId("open-modal-md").click();
      await shot(page, "modal-md", theme, "390");
      await page.keyboard.press("Escape");
      await page.getByTestId("open-sheet").click();
      await shot(page, "sheet", theme, "390");
      await page.keyboard.press("Escape");
      await page.getByTestId("popover-scroll").click();
      await shot(page, "popover-scroll", theme, "390");
      await setup(page, theme, 1280, 420);
      await page.getByTestId("open-modal-lg").click();
      await shot(page, "modal-lg", theme, "1280x420");
      await page.keyboard.press("Escape");
      await page.getByTestId("open-sheet").click();
      await shot(page, "sheet", theme, "1280x420");
    }
  });

  test("nested, filters and native host", async ({ page }) => {
    for (const theme of THEMES) {
      await setup(page, theme);
      await page.getByTestId("open-nested").click();
      await page.getByTestId("nested-trigger").click();
      await shot(page, "nested", theme, "1280");
      await setup(page, theme);
      await page.getByRole("button", { name: /^Filters/ }).click();
      await shot(page, "filters-social", theme, "1280");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Filter Author" }).click();
      await shot(page, "filters-git", theme, "1280");
      await setup(page, theme);
      await page.getByTestId("open-native").click();
      await page.getByTestId("native-popover").click();
      await shot(page, "native-host", theme, "1280");
    }
  });

  test("reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, "dark");
    await page.getByTestId("open-sheet").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(page, "sheet-reduced", "dark", "1280");
  });
});

test.describe("modal surface and hierarchy", () => {
  for (const theme of THEMES) {
    test(`dialog and sheet use the raised popup surface (${theme})`, async ({ page }) => {
      await setup(page, theme);
      const workbench = await bg(page, "[data-workbench]");
      // Dark glass is the raised role at 95 percent, exactly like Popover.
      await page.getByTestId("popover-intrinsic").click();
      const popover = await bg(page, ".popover-backdrop");
      await page.keyboard.press("Escape");
      for (const scene of ["modal-sm", "modal-md", "sheet"]) {
        await page.getByTestId(`open-${scene}`).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const surface = await bg(page, '[role="dialog"] > .popover-backdrop');
        expect(surface).not.toBe(workbench);
        expect(surface).toBe(popover);
        if (theme === "light") expect(surface).toBe(await rootBg(page, "--ui-surface-raised"));
        // A readable boundary at rest: the frame keeps the stroke role.
        const border = await dialog.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            color: style.borderInlineStartColor,
            start: style.borderInlineStartWidth,
            end: style.borderInlineEndWidth,
            radius: style.borderTopLeftRadius,
          };
        });
        expect(border.start).toBe("1px");
        if (scene === "sheet") {
          expect(border.end).toBe("0px");
          expect(border.radius).toBe("0px");
        } else {
          expect(border.end).toBe("1px");
          expect(border.radius).toBe("12px");
        }
        expect(border.color).not.toBe("rgba(0, 0, 0, 0)");
        await page.keyboard.press("Escape");
      }
    });
  }

  test("title hierarchy follows size and placement", async ({ page }) => {
    await setup(page, "dark");
    const size = async (scene: string) => {
      await page.getByTestId(`open-${scene}`).click();
      const value = await page
        .getByRole("heading", { level: 2 })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      await page.keyboard.press("Escape");
      return value;
    };
    const sm = await size("modal-sm");
    const md = await size("modal-md");
    const lg = await size("modal-lg");
    const sheet = await size("sheet");
    expect(sm).toBe(sheet);
    expect(md).toBe(lg);
    expect(sm).toBeLessThan(md);
  });

  test("footer actions stay visible while a long body scrolls at 1280x420", async ({ page }) => {
    await setup(page, "dark", 1280, 420);
    for (const scene of ["modal-sm", "modal-md", "modal-lg", "sheet"]) {
      await page.getByTestId(`open-${scene}`).click();
      const save = page.getByRole("button", { name: "Save changes" });
      await expect(save).toBeVisible();
      await page.waitForTimeout(400); // entrance motion settles
      const box = (await save.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(420);
      const scroller = page.getByTestId("modal-body").locator("xpath=..");
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const dialog = (await page.getByRole("dialog").boundingBox())!;
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(420);
      // The footer does not move when the body scrolls.
      await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
      expect((await save.boundingBox())!.y).toBe(box.y);
      await page.keyboard.press("Escape");
    }
  });

  test("focus enters the dialog, stays inside and returns to the opener on Escape", async ({
    page,
  }) => {
    await setup(page, "light");
    const opener = page.getByTestId("open-modal-md");
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText("Dialog md");
    expect(await inDialog(page)).toBe(true);
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(await inDialog(page)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("reduced motion removes the dialog and sheet entrance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, "dark");
    for (const scene of ["modal-md", "sheet"]) {
      await page.getByTestId(`open-${scene}`).click();
      expect(
        await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("popover content flow", () => {
  test("bounded content scrolls in one region and wheel, keys and rail are not dismissals", async ({
    page,
  }) => {
    await setup(page, "dark", 1280, 600);
    await page.getByTestId("popover-scroll").click();
    const surface = page.getByTestId("popover-surface");
    await expect(surface).toBeVisible();
    const state = () =>
      surface.evaluate((el) => ({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        flow: el.getAttribute("data-popover-flow"),
        page: window.scrollY,
        // One scroll rail: nothing else in or around the region scrolls.
        rails: [el, ...el.querySelectorAll("*")].filter((node) => {
          const style = getComputedStyle(node);
          return /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
        }).length,
      }));
    const before = await state();
    expect(before.flow).toBe("scroll");
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
    expect(before.rails).toBe(1);
    const box = (await surface.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(320);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await state()).scrollTop).toBeGreaterThan(0);
    await page.mouse.wheel(0, 20000);
    await page.mouse.wheel(0, 2000);
    expect((await state()).page).toBe(0);
    await expect(surface).toBeVisible();
    await surface.locator("button").first().focus();
    for (let index = 0; index < 12; index++) await page.keyboard.press("Tab");
    await expect(surface).toBeVisible();
    expect(await log(page)).toEqual([]);
    await surface.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(surface.locator("button").last()).toBeInViewport();
    // Pressing the scrollbar track is inside the overlay, not an outside click.
    await page.mouse.move(box.x + box.width - 3, box.y + 40);
    await page.mouse.down();
    await page.mouse.up();
    expect(await log(page)).toEqual([]);
    await page.mouse.click(20, 500);
    await expect(surface).toHaveCount(0);
    expect(await log(page)).toEqual(["popover-dismiss:outside"]);
  });

  test("the default scrolls instead of clipping, explicit intrinsic clips; short content stays natural", async ({
    page,
  }) => {
    await setup(page, "dark", 1280, 600);
    await page.getByTestId("popover-clip").click();
    const bounded = page.getByTestId("popover-surface");
    expect(await bounded.getAttribute("data-popover-flow")).toBe("auto");
    expect(await bounded.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    expect(await bounded.evaluate((el) => getComputedStyle(el).overflowX)).toBe("hidden");
    await bounded.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(bounded.locator("button").last()).toBeInViewport();
    await page.keyboard.press("Escape");
    await page.getByTestId("popover-hard-clip").click();
    const clip = page.getByTestId("popover-surface");
    expect(await clip.getAttribute("data-popover-flow")).toBe("intrinsic");
    expect(await clip.evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");
    await page.keyboard.press("Escape");
    await page.getByTestId("popover-intrinsic").click();
    const natural = page.getByTestId("popover-surface");
    expect(await natural.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(
      0,
    );
  });

  test("a short viewport keeps the list reachable", async ({ page }) => {
    await setup(page, "light", 1280, 300);
    await page.getByTestId("popover-scroll").click();
    const surface = page.getByTestId("popover-surface");
    const box = (await surface.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(300);
    await surface.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(surface.locator("button").last()).toBeInViewport();
  });
});

test.describe("tooltip", () => {
  test("keyboard hint is compact, keeps focus and leaves Escape to the dialog", async ({
    page,
  }) => {
    for (const theme of THEMES) {
      await setup(page, theme);
      const icon = page.getByTestId("tooltip-icon");
      await icon.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const hint = page.getByRole("tooltip");
      await expect(hint).toBeVisible();
      await expect(icon).toBeFocused();
      // One line of caption text plus padding; no sub-pixel wrap.
      expect((await hint.boundingBox())!.height).toBeLessThan(36);
      await expect(hint).toHaveText("Project settings");
      await page.keyboard.press("Escape");
      await expect(hint).toHaveCount(0);
      await expect(icon).toBeFocused();
    }
    await setup(page, "dark");
    await page.getByTestId("open-modal-sm").click();
    await page.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});

test.describe("confirm dialog", () => {
  test("danger confirm with pending work blocks double submit and Escape", async ({ page }) => {
    await setup(page, "dark");
    const opener = page.getByTestId("open-confirm-pending");
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Delete 3 worktrees?" });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Delete" });
    expect(await confirm.getAttribute("data-button-tone")).toBe("danger");
    await confirm.dblclick();
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    expect((await log(page)).filter((entry) => entry.startsWith("confirm-call"))).toEqual([
      "confirm-call:1",
    ]);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.__resolveConfirm?.());
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("last-settle")).toHaveText("true");
    await expect(opener).toBeFocused();
  });

  test("a failure stays visible, the dialog stays open and retry works", async ({ page }) => {
    await setup(page, "light");
    await page.getByTestId("open-confirm-error").click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Delete" });
    await confirm.click();
    await page.evaluate(() => window.__rejectConfirm?.("Worktree is locked by a terminal"));
    await expect(dialog.getByRole("alert")).toContainText("Worktree is locked by a terminal");
    await expect(confirm).not.toHaveAttribute("aria-busy", "true");
    await shot(page, "confirm-error", "light", "1280");
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect((await log(page)).filter((entry) => entry.startsWith("confirm-call"))).toHaveLength(2);
    await page.evaluate(() => window.__resolveConfirm?.());
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("nested overlays", () => {
  test("Escape closes only the top layer and focus returns down the chain", async ({ page }) => {
    await setup(page, "dark");
    const opener = page.getByTestId("open-nested");
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Dialog md" });
    await expect(dialog).toBeVisible();
    const trigger = page.getByTestId("nested-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const branches = page.getByRole("dialog", { name: "Branches" });
    await expect(branches).toBeVisible();
    await expect(branches).toBeFocused();
    // The popover is portalled yet belongs to the dialog.
    await branches.locator("button").first().click();
    await expect(dialog).toBeVisible();
    const box = (await branches.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect(branches).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(branches).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await log(page)).toContain("nested-dismiss:escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("an outside press inside the dialog closes the popover but not the dialog", async ({
    page,
  }) => {
    await setup(page, "light");
    await page.getByTestId("open-nested").click();
    await page.getByTestId("nested-trigger").click();
    const branches = page.getByRole("dialog", { name: "Branches" });
    await expect(branches).toBeVisible();
    await page.getByRole("heading", { name: "Dialog md" }).click();
    await expect(branches).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Dialog md" })).toBeVisible();
  });
});

test.describe("filters", () => {
  test("SocialFilters shows active scope, resets and returns focus", async ({ page }) => {
    await setup(page, "dark");
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Filters" });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Kind").fill("failed");
    await expect(page.getByRole("button", { name: /Filters · 1 active/ })).toBeVisible();
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeFocused();
  });

  test("GitGraphColumnFilter marks the active column, resets and returns focus", async ({
    page,
  }) => {
    await setup(page, "light");
    const trigger = page.getByRole("button", { name: "Filter Author" });
    // Keyboard open: WebKit does not focus a button on a mouse click, so there is
    // no focused opener to return to there (reported as a gap, not asserted).
    await trigger.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Filter Author" });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Author").fill("ada");
    await expect(trigger).toHaveAttribute("aria-pressed", "true");
    await shot(page, "filters-git-active", "light", "1280");
    await panel.getByRole("button", { name: "Reset filter", exact: true }).click();
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("native popup host routing (fixture-provided host element)", () => {
  test("popover and modal portal into the provided host", async ({ page }) => {
    await setup(page, "dark");
    await page.getByTestId("open-native").click();
    const host = page.getByTestId("native-host");
    await page.getByTestId("native-popover").click();
    const popover = host.getByRole("dialog", { name: "Native popover" });
    await expect(popover).toBeVisible();
    expect(await popover.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await page.getByTestId("native-modal").click();
    await expect(host.getByRole("dialog", { name: "Native dialog" })).toBeVisible();
    expect(await page.locator("body > div > [role='dialog']").count()).toBe(0);
  });
});
