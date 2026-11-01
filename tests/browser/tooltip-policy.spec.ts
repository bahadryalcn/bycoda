import { expect, test, type Page, type Locator } from "@playwright/test";
import { join } from "node:path";

const captures = join(process.cwd(), "temp/verification/2026-11-01-tooltip-cleanup");
async function reset(page: Page) {
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.getByRole("tooltip")).toHaveCount(0);
}
async function absent(page: Page, target: Locator) {
  await reset(page);
  await target.hover();
  // Exceed the real shared delay rather than asserting before a hint could open.
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
}
async function hint(page: Page, target: Locator, content: string | RegExp) {
  await reset(page);
  await target.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText(content);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/browser/tooltip-policy.html");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("visible, clipped, multiline, icon and semantic hints follow actual layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await absent(page, page.getByTestId("visible"));
  await absent(page, page.getByTestId("inline-shortcut"));
  await absent(page, page.getByTestId("responsive"));
  await hint(page, page.getByTestId("clipped"), "A very long readable");
  await hint(page, page.getByTestId("multiline"), "A very long readable");
  await hint(page, page.getByTestId("icon"), "Search workspace");
  await hint(page, page.getByTestId("details"), "Includes nested folders");
  await hint(page, page.getByTestId("disabled"), "Choose a project first");
  await hint(page, page.getByTestId("shortcut"), /Ctrl.*K/);
  await expect(page.getByRole("tooltip").getByRole("img", { name: "Control K" })).toBeVisible();
  await reset(page);
  await expect(page.locator("main [title]")).toHaveCount(0);
});

test("hints disappear when resize reveals text; keyboard and responsive icon modes remain usable", async ({ page }) => {
  const clipped = page.getByTestId("clipped");
  await hint(page, clipped, "A very long readable");
  await clipped.evaluate(element => { element.style.width = "1000px"; });
  await page.setViewportSize({ width: 2560, height: 1000 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.setViewportSize({ width: 800, height: 1000 });
  const responsive = page.getByTestId("responsive");
  await hint(page, responsive, "Responsive Explorer");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await reset(page);
  const icon = page.getByTestId("icon");
  await icon.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(icon).toBeFocused();
  await expect(page.getByRole("tooltip")).toContainText("Search workspace");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(icon).toBeFocused();
});

test("hidden shortcut parents, single letters and already-visible keycaps keep distinct meanings", async ({ page }) => {
  await hint(page, page.getByTestId("hidden-shortcut"), /Ctrl.*H/);
  await expect(page.getByRole("tooltip").getByRole("img", { name: "Control H" })).toBeVisible();
  await hint(page, page.getByTestId("single-letter-shortcut"), "Sessions");
  await expect(page.getByRole("tooltip").getByRole("img", { name: "S", exact: true })).toBeVisible();
  await absent(page, page.getByTestId("keycap-shortcut"));
});

test("selection, middle truncation, action groups and actual activity header suppress repeated text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await absent(page, page.getByTestId("middle-short"));
  await hint(page, page.getByTestId("middle-long"), "AgentTranscriptActivity.tsx");
  for (const family of ["select", "searchable"]) {
    await absent(page, page.getByTestId(`${family}-short`).locator("button").first());
    const long = page.getByTestId(`${family}-long`).locator("button").first();
    await hint(page, long, "A very long readable");
    await reset(page);
    await long.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(long).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("A very long readable");
  }
  await absent(page, page.getByRole("button", { name: "Copy fixture", exact: true }));
  await hint(page, page.getByRole("button", { name: "Find fixture", exact: true }), "Find fixture");
  await absent(page, page.getByRole("button", { name: "Copy expanded fixture", exact: true }));
  const phase = page.getByRole("region", { name: "Production consumer" }).getByRole("button").first();
  await expect(phase).toContainText("Searched");
  await absent(page, phase);
  await phase.evaluate(element => { element.style.width = "130px"; element.style.maxWidth = "130px"; });
  await hint(page, phase, "Searched");
});

test("date range keeps its direct-child keyboard focus contract", async ({ page }) => {
  const trigger = page.getByTestId("date-range").locator("button").first();
  await reset(page);
  await trigger.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate(element => {
    const parent = element.parentElement!;
    return parent.matches(':has(> button:focus-visible)') && parent.classList.contains('bycoda-arc-date-range');
  })).toBe(true);
  const ring = await trigger.evaluate(element => getComputedStyle(element.parentElement!.querySelector('[class*="surface"]')!).boxShadow);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("touch does not create hover hints", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/tests/browser/tooltip-policy.html");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("icon").tap();
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await context.close();
});

for (const width of [1280, 800]) for (const theme of ["light", "dark"]) {
  test(`visual and reduced-motion matrix ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => document.documentElement.classList.toggle("theme-light", theme === "light"), theme);
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      await page.emulateMedia({ reducedMotion });
      await absent(page, page.getByTestId("visible"));
      await absent(page, page.getByTestId("middle-short"));
      await absent(page, page.getByRole("button", { name: "Copy expanded fixture", exact: true }));
      await expect(page.locator("main [title]")).toHaveCount(0);
      if (reducedMotion === "reduce") {
        await reset(page);
        await page.screenshot({ path: join(captures, `families-${theme}-${width}.png`), fullPage: true });
      }
      await hint(page, page.getByTestId("multiline"), "A very long readable");
      const bounds = (await page.getByRole("tooltip").boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      if (reducedMotion === "reduce") await page.screenshot({ path: join(captures, `hint-${theme}-${width}.png`), fullPage: true });
    }
  });
}
