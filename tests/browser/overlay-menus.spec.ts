import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "temp/verification/2026-10-28-session5-overlays/menus";
// MENUS_PREFIX=baseline- records pre-change captures; the default records the redesigned ones.
const PREFIX = process.env.MENUS_PREFIX ?? "";
mkdirSync(OUT, { recursive: true });

const URL = "/tests/browser/overlay-menus.html";
const themes = ["light", "dark"] as const;
const sizes = [
  { name: "1280", width: 1280, height: 800 },
  { name: "800", width: 800, height: 600 },
  { name: "390", width: 390, height: 760 },
  { name: "1280x420", width: 1280, height: 420 },
];

type Size = { width: number; height: number };

async function open(page: Page, theme: string, extra = "", size: Size = sizes[0]) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`${URL}?theme=${theme}${extra}`);
  await page.waitForSelector('[data-fixture="menus"]');
}
// Popovers animate in; capture the settled frame.
async function shot(page: Page, name: string, theme: string, size: string) {
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${OUT}/${PREFIX}${name}-${theme}-${size}.png` });
}
const trigger = (page: Page, id: string) => page.locator(`[data-trigger="${id}"]`);
const settle = (page: Page) => page.waitForTimeout(320);

async function roleColor(page: Page, role: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, role);
}
// The inset ring uses the shared focus width token.
const focusRing = (el: Element) => {
  const style = getComputedStyle(el);
  return (
    style.outlineStyle === "solid" &&
    parseFloat(style.outlineWidth) > 0 &&
    style.outlineWidth === style.getPropertyValue("--ui-focus-width").trim()
  );
};
const background = (row: Locator) => row.evaluate((el) => getComputedStyle(el).backgroundColor);
// Layout height: a popover that is still scaling in has a smaller bounding box.
const height = (row: Locator) => row.evaluate((el) => (el as HTMLElement).offsetHeight);

async function expectInside(page: Page, box: Locator, size: Size) {
  const bounds = (await box.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width + 0.5);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height + 0.5);
}

// Every capture below renders production components with memory-only props; nothing here is a
// native Tauri window, installed build or production data.
for (const theme of themes) {
  for (const size of sizes) {
    test(`captures menus ${theme} ${size.name}`, async ({ page }) => {
      await open(page, theme, "", size);
      await shot(page, "static-rows", theme, size.name);

      await trigger(page, "dropdown").click();
      await expect(page.getByRole("menu", { name: "Item actions" })).toBeVisible();
      await page.getByRole("menuitem", { name: "Copy path" }).hover();
      await shot(page, "dropdown-hover", theme, size.name);
      await page.getByRole("menuitem", { name: "Delete" }).hover();
      await shot(page, "dropdown-danger-hover", theme, size.name);
      await page.keyboard.press("Escape");

      await trigger(page, "dropdown").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu", { name: "Item actions" })).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await shot(page, "dropdown-keyboard", theme, size.name);
      await page.keyboard.press("Escape");

      await trigger(page, "described").click();
      await expect(page.getByRole("menu", { name: "Session modes" })).toBeVisible();
      await shot(page, "dropdown-described", theme, size.name);
      await page.keyboard.press("Escape");

      await trigger(page, "ctx-center").click();
      const ctx = page.getByRole("menu", { name: "Point actions" });
      await expect(ctx).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await shot(page, "context-keyboard", theme, size.name);
      await ctx.getByRole("menuitem", { name: "Open with" }).hover();
      await expect(page.getByRole("menu", { name: "Open with" })).toBeVisible();
      await shot(page, "context-submenu", theme, size.name);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await trigger(page, "ctx-right").click();
      const edge = page.getByRole("menu", { name: "Edge actions" });
      await expect(edge).toBeVisible();
      await edge.getByRole("menuitem", { name: "Open with" }).hover();
      await shot(page, "context-edge-submenu", theme, size.name);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await trigger(page, "ctx-bottom").click();
      await expect(page.getByRole("menu", { name: "Bottom actions" })).toBeVisible();
      await shot(page, "context-bottom", theme, size.name);
      await page.keyboard.press("Escape");

      await trigger(page, "ctx-anchor").click();
      await expect(page.getByRole("menu", { name: "Anchored actions" })).toBeVisible();
      await shot(page, "context-anchored", theme, size.name);
      await page.keyboard.press("Escape");

      await trigger(page, "native-host").click();
      await expect(page.getByRole("menu", { name: "Native host actions" })).toBeVisible();
      await shot(page, "native-host", theme, size.name);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Project group menu" }).click();
      await expect(page.getByRole("menu", { name: "Project group actions" })).toBeVisible();
      await shot(page, "project-group", theme, size.name);
      await page.keyboard.press("Escape");

      await page.getByText("Click or right-click target").click();
      await expect(page.getByRole("menu", { name: "Arc context menu" })).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await shot(page, "arc-context", theme, size.name);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "About menus" }).click();
      await expect(page.getByRole("dialog", { name: "About menus" })).toBeVisible();
      await shot(page, "info-popover", theme, size.name);
    });
  }
}

for (const theme of themes) {
  test(`captures density, touch and reduced motion ${theme}`, async ({ page }) => {
    for (const density of ["comfortable", "touch"]) {
      await open(page, theme, `&density=${density}`);
      await trigger(page, "dropdown").click();
      await expect(page.getByRole("menu", { name: "Item actions" })).toBeVisible();
      await shot(page, `dropdown-${density}`, theme, "1280");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, theme);
    await trigger(page, "described").click();
    await expect(page.getByRole("menu", { name: "Session modes" })).toBeVisible();
    await shot(page, "dropdown-reduced-motion", theme, "1280");
  });
}

test("measures the hover, pressed, highlight and danger roles on the raised menu surface", async ({
  page,
}) => {
  for (const theme of themes) {
    await open(page, theme);
    const rows = page.getByRole("menu", { name: "MenuRow states" });
    const raised = await roleColor(page, "--ui-surface-raised");
    const hover = await roleColor(page, "--ui-surface-hover");
    const pressed = await roleColor(page, "--ui-surface-pressed");
    const dangerHover = await roleColor(page, "--ui-tone-danger-hover");
    const dangerPressed = await roleColor(page, "--ui-tone-danger-pressed");
    const plain = rows.getByTestId("row-plain");
    const danger = rows.getByTestId("row-danger");

    // Resting rows are transparent: they take the raised menu surface.
    expect(await background(plain)).toBe("rgba(0, 0, 0, 0)");
    await plain.hover();
    await settle(page);
    expect(await background(plain)).toBe(hover);
    expect(hover).not.toBe(raised);
    await page.mouse.down();
    await settle(page);
    expect(await background(plain)).toBe(pressed);
    await page.mouse.move(600, 500);
    await page.mouse.up();

    // Keyboard highlight and an expanded branch use the shared selected role; they never invent a tint.
    const selected = await roleColor(page, "--ui-surface-selected");
    expect(await background(rows.getByTestId("row-highlight"))).toBe(selected);
    expect(await background(rows.getByTestId("row-expanded"))).toBe(selected);

    await danger.hover();
    await settle(page);
    expect(await background(danger)).toBe(dangerHover);
    await page.mouse.down();
    await settle(page);
    expect(await background(danger)).toBe(dangerPressed);
    await page.mouse.move(600, 500);
    await page.mouse.up();
    expect(await danger.evaluate((el) => getComputedStyle(el).color)).toBe(
      await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--ui-tone-danger-fg)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    );

    // Disabled rows are inert: no hover fill, reduced presence, no pointer cursor.
    const disabled = rows.getByTestId("row-disabled");
    await disabled.hover({ force: true });
    await settle(page);
    expect(await background(disabled)).toBe("rgba(0, 0, 0, 0)");
    expect(await disabled.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.5");
    expect(await disabled.evaluate((el) => getComputedStyle(el).cursor)).toBe("default");

    // No local color-mix recipe remains in the shared menu row rules.
    const mixes = await page.evaluate(() => {
      const found: string[] = [];
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules)
            visit((rule as CSSGroupingRule).cssRules);
          if (/--menu-row-|--menu-slot-/.test(rule.cssText) && /color-mix/.test(rule.cssText))
            found.push(rule.cssText.slice(0, 120));
        }
      };
      for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules);
      return found;
    });
    expect(mixes).toEqual([]);
  }
});

test("dropdown keyboard: roving focus, disabled rows skipped, Escape returns focus", async ({
  page,
}) => {
  await open(page, "dark");
  const opener = trigger(page, "dropdown");
  await opener.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Item actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Copy path" })).toBeFocused();
  // Keyboard focus is visible: the shared ring is inset and the row takes the selected fill.
  const focused = menu.getByRole("menuitem", { name: "Copy path" });
  await settle(page);
  expect(await focused.evaluate(focusRing)).toBe(true);
  expect(await background(focused)).toBe(await roleColor(page, "--ui-surface-selected"));
  await page.keyboard.press("ArrowDown"); // Archive is disabled and skipped.
  await expect(menu.getByRole("menuitem", { name: /Rename the current checkout/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Rename", exact: true })).toBeFocused();
  await page.keyboard.press("p");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Pinned" })).toBeFocused();
  // Disabled rows never activate.
  await menu.getByRole("menuitem", { name: "Archive" }).click({ force: true });
  await expect(page.getByTestId("picked")).toHaveText("none");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.getByTestId("picked")).toHaveText("none");
});

test("dropdown semantics: checkbox and radio roles, aria-disabled rows, shared slots align", async ({
  page,
}) => {
  await open(page, "light");
  await trigger(page, "dropdown").click();
  const menu = page.getByRole("menu", { name: "Item actions" });
  await expect(menu.getByRole("menuitemcheckbox", { name: "Pinned" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu.getByRole("menuitemradio", { name: "Merge commit" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(menu.getByRole("menuitem", { name: "Archive" })).toBeDisabled();
  await settle(page); // the popover scales in; measure the settled frame
  // One label column: rows with and without an icon start their text at the same x.
  const xs = await menu.getByRole("menuitem").evaluateAll((rows) =>
    rows.map((row) => {
      const copy = row.querySelector("[class*='_copy_']") as HTMLElement;
      return Math.round(copy.getBoundingClientRect().left);
    }),
  );
  const boxes = await menu
    .getByRole("menuitemcheckbox", { name: "Notify on finish" })
    .evaluate((row) =>
      Math.round(
        (row.querySelector("[class*='_copy_']") as HTMLElement).getBoundingClientRect().left,
      ),
    );
  expect(new Set(xs).size).toBe(1);
  expect(boxes).toBe(xs[0]);
  // A long label wraps inside the row instead of widening or clipping the menu.
  const long = menu.getByRole("menuitem", { name: /Rename the current checkout/ });
  expect(await height(long)).toBeGreaterThan(40);
  const overflow = await menu.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("row metric follows density, with a 44px floor for coarse pointers", async ({ page }) => {
  const heights: Record<string, number> = {};
  for (const density of ["compact", "comfortable", "touch"]) {
    await open(page, "dark", `&density=${density}`);
    await trigger(page, "dropdown").click();
    const row = page.getByRole("menuitem", { name: "Rename", exact: true });
    await expect(row).toBeVisible();
    heights[density] = await height(row);
    // The same metric reaches the point/anchor menu and MenuRow consumers.
    await page.keyboard.press("Escape");
    expect(await height(page.getByTestId("row-plain"))).toBe(heights[density]);
    await trigger(page, "ctx-center").click();
    expect(
      await height(
        page
          .getByRole("menu", { name: "Point actions" })
          .getByRole("menuitem", { name: "Open", exact: true }),
      ),
    ).toBe(heights[density]);
  }
  expect(heights).toEqual({ compact: 32, comfortable: 36, touch: 48 });
});

test("coarse pointers get a 44px target on every menu path", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${URL}?theme=dark`);
  await page.waitForSelector('[data-fixture="menus"]');
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await trigger(page, "dropdown").tap();
  const row = page.getByRole("menuitem", { name: "Rename", exact: true });
  await expect(row).toBeVisible();
  expect(await height(row)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  expect(await height(page.getByTestId("row-plain"))).toBeGreaterThanOrEqual(44);
  await trigger(page, "ctx-center").tap();
  expect(
    await height(
      page
        .getByRole("menu", { name: "Point actions" })
        .getByRole("menuitem", { name: "Open", exact: true }),
    ),
  ).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  // Info help works on tap without hover.
  await page.getByRole("button", { name: "About menus" }).tap();
  await expect(page.getByRole("dialog", { name: "About menus" })).toBeVisible();
  await context.close();
});

test("context menu: point placement, edge flip, keyboard submenu and Escape", async ({ page }) => {
  const size = sizes[0];
  await open(page, "dark");
  await trigger(page, "ctx-right").click();
  const menu = page.getByRole("menu", { name: "Edge actions" });
  await expect(menu).toBeVisible();
  await expectInside(page, menu, size);
  // Disabled "Move to trash" is never highlighted; keyboard walks the enabled rows.
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const more = menu.getByRole("menuitem", { name: "Open with" });
  await expect(more).toHaveAttribute("data-highlighted", "true");
  // The keyboard highlight is visible without hover: the selected fill plus the inset focus ring.
  await settle(page);
  expect(await more.evaluate(focusRing)).toBe(true);
  expect(await background(more)).toBe(await roleColor(page, "--ui-surface-selected"));
  await page.keyboard.press("ArrowRight");
  const sub = page.getByRole("menu", { name: "Open with" });
  await expect(sub).toBeVisible();
  await expect(sub).toHaveAttribute("data-popover-side", "left");
  await expectInside(page, sub, size);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(sub).toBeHidden();
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Add to project" })).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger(page, "ctx-right")).toBeFocused();
  // Disabled rows do not activate and describe themselves through the native title.
  await trigger(page, "ctx-center").click();
  const point = page.getByRole("menu", { name: "Point actions" });
  await point.getByRole("menuitem", { name: "Move to trash" }).click({ force: true });
  await expect(page.getByTestId("picked")).toHaveText("none");
  await point.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(page.getByTestId("picked")).toHaveText("rename");
});

test("menus scroll inside a short viewport and stay reachable", async ({ page }) => {
  const size = sizes[3];
  await open(page, "dark", "", size);
  await trigger(page, "dropdown").click();
  const menu = page.getByRole("menu", { name: "Item actions" });
  await expect(menu).toBeVisible();
  await expectInside(page, menu, size);
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.keyboard.press("End");
  const last = menu.getByRole("menuitem", { name: "Delete" });
  await expect(last).toBeFocused();
  const lastBox = (await last.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 1);
  expect(lastBox.y).toBeGreaterThanOrEqual(menuBox.y - 1);
  await page.keyboard.press("Escape");

  await trigger(page, "ctx-bottom").click();
  const bottom = page.getByRole("menu", { name: "Bottom actions" });
  await expect(bottom).toBeVisible();
  await expectInside(page, bottom, size);
  await bottom.getByRole("menuitem", { name: "Open with" }).hover();
  const sub = page.getByRole("menu", { name: "Open with" });
  await expect(sub).toBeVisible();
  await expectInside(page, sub, size);
});

test("narrow viewport keeps menus inside 390px and wraps described rows", async ({ page }) => {
  const size = sizes[2];
  await open(page, "light", "", size);
  for (const [id, name] of [
    ["dropdown", "Item actions"],
    ["described", "Session modes"],
    ["ctx-right", "Edge actions"],
    ["ctx-anchor", "Anchored actions"],
  ] as const) {
    await trigger(page, id).click();
    const menu = page.getByRole("menu", { name });
    await expect(menu).toBeVisible();
    await expectInside(page, menu, size);
    expect(await menu.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
  }
});

test("reduced motion removes row transitions and the popover entrance", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "dark");
  await trigger(page, "described").click();
  const row = page.getByRole("menuitemcheckbox", { name: "Plan mode" });
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  const menu = page.getByRole("menu", { name: "Session modes" });
  expect(await menu.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("described rows use the same icon, check and shortcut slots", async ({ page }) => {
  await open(page, "dark");
  await trigger(page, "described").click();
  const menu = page.getByRole("menu", { name: "Session modes" });
  await expect(menu).toBeVisible();
  const plan = menu.getByRole("menuitemcheckbox", { name: "Plan mode" });
  await expect(plan).toHaveAttribute("data-described", "true");
  await expect(plan).toContainText("Review a plan before the agent changes files");
  const geometry = await menu
    .getByRole("menuitem")
    .or(menu.getByRole("menuitemcheckbox"))
    .evaluateAll((rows) =>
      rows.map((row) => {
        const icon = row.querySelector("[class*='_icon_']") as HTMLElement;
        const trailing = row.querySelector("[class*='_trailing_']") as HTMLElement | null;
        const bounds = row.getBoundingClientRect();
        return {
          icon: Math.round(icon.getBoundingClientRect().left - bounds.left),
          trailingGap: trailing
            ? Math.round(bounds.right - trailing.getBoundingClientRect().right)
            : null,
        };
      }),
    );
  expect(new Set(geometry.map((entry) => entry.icon)).size).toBe(1);
  expect(
    new Set(geometry.filter((entry) => entry.trailingGap != null).map((entry) => entry.trailingGap))
      .size,
  ).toBe(1);
  // Disabled described row keeps its description and is skipped by the keyboard.
  await expect(menu.getByRole("menuitem", { name: "Export transcript" })).toBeDisabled();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Clear history" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "No description row" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitemcheckbox", { name: "Auto-accept edits" })).toBeFocused();
});

test("native popup routing: a menu renders inside the supplied popup host (fixture only)", async ({
  page,
}) => {
  await open(page, "dark");
  await trigger(page, "native-host").click();
  const menu = page.getByRole("menu", { name: "Native host actions" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => !!el.closest("[data-testid='native-host']"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // A normal menu portals to the document body instead.
  await trigger(page, "dropdown").click();
  const normal = page.getByRole("menu", { name: "Item actions" });
  expect(await normal.evaluate((el) => !!el.closest("[data-testid='native-host']"))).toBe(false);
});

test("real consumers share the compact row: project group menu and MenuRow", async ({ page }) => {
  await open(page, "dark");
  await page.getByRole("button", { name: "Project group menu" }).click();
  const group = page.getByRole("menu", { name: "Project group actions" });
  await expect(group).toBeVisible();
  const rows = group.getByRole("menuitem");
  expect(await rows.count()).toBeGreaterThan(3);
  const lock = group.getByRole("menuitem", { name: "Lock group" });
  expect(await height(lock)).toBe(32);
  await lock.hover();
  await settle(page);
  expect(await background(lock)).toBe(await roleColor(page, "--ui-surface-hover"));
  await group.getByRole("menuitem", { name: "Delete", exact: true }).hover();
  await settle(page);
  expect(await background(group.getByRole("menuitem", { name: "Delete", exact: true }))).toBe(
    await roleColor(page, "--ui-tone-danger-hover"),
  );
  await page.keyboard.press("Escape");
});

test("standalone Arc context menu: keyboard, danger highlight roles and focus return", async ({
  page,
}) => {
  await open(page, "dark");
  const target = page.getByLabel("Arc context menu", { exact: true }).first();
  await page.getByText("Click or right-click target").click();
  const menu = page.getByRole("menu", { name: "Arc context menu" });
  await expect(menu).toBeVisible();
  // Opening focuses the first row; the arrow then moves to the destructive one.
  await expect(menu.getByRole("menuitem", { name: "Copy link" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete project" })).toBeFocused();
  await settle(page);
  const glide = menu.locator("span[aria-hidden='true']").first();
  expect(await glide.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await roleColor(page, "--ui-tone-danger-hover"),
  );
  expect(await height(menu.getByRole("menuitem", { name: "Copy link" }))).toBe(32);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(target).toBeFocused();
});

test("InfoPopover: named trigger, keyboard open, Escape returns focus, readable width", async ({
  page,
}) => {
  await open(page, "light");
  const info = page.getByRole("button", { name: "About menus" });
  await info.focus();
  await expect(info).toHaveAttribute("aria-haspopup", "dialog");
  await expect(info).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "About menus" });
  await expect(dialog).toBeVisible();
  await expect(info).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toBeFocused();
  const width = (await dialog.boundingBox())!.width;
  expect(width).toBeGreaterThan(240);
  expect(width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(info).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await info.click();
  await expect(dialog).toBeHidden();
});
