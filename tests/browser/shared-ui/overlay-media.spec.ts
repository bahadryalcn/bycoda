import { expect, test, type Page } from "@playwright/test";

// Fixture evidence for the shared media family (ImageLightbox, ImageCompare,
// ImageAnnotationCanvas). Memory-only page generated from canvas images: no
// network, clipboard, disk export or production data.

const SHOTS = "temp/verification/2026-10-28-session5-overlays/media";
const PREFIX = process.env.OVERLAY_SHOT_PREFIX ?? "";
const URL = "/tests/browser/shared-ui/overlay-media.html";

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

/** Resolves any computed color (oklch, color-mix) to rgb through a probe element. */
async function colorOf(page: Page, selector: string, property: string, pseudo?: string) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (el, args) => {
        const raw = getComputedStyle(el, args.pseudo)[args.property as "backgroundColor"];
        const probe = document.createElement("div");
        probe.style.color = raw;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      },
      { property, pseudo },
    );
}

const THEMES = ["light", "dark"] as const;
const SIZES = [
  [1280, 800, "1280"],
  [800, 600, "800"],
  [390, 844, "390"],
  [1280, 420, "short"],
] as const;

/** A small canvas-drawn PNG used as the comparison file chosen in the lightbox. */
async function comparePng(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 480, 320);
    gradient.addColorStop(0, "#20304a");
    gradient.addColorStop(1, "#d98c4a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 480, 320);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(data, "base64");
}

test.describe("captures", () => {
  for (const theme of THEMES) {
    for (const [width, height, size] of SIZES) {
      test(`surfaces ${theme} ${size}`, async ({ page }) => {
        await setup(page, theme, width, height);
        await shot(page, "page", theme, size);
        if (size === "1280" || size === "390" || size === "800") {
          for (const id of [
            "compare-mixed-bright",
            "compare-vertical",
            "compare-dark-dark",
            "compare-broken",
            "annotator-mixed",
            "annotator-broken",
          ]) {
            const card = page.getByTestId(id);
            await card.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            await card.screenshot({ path: `${SHOTS}/${PREFIX}${id}-${theme}-${size}.png` });
          }
          await page.evaluate(() => document.querySelector("div.overflow-auto")?.scrollTo(0, 0));
        }
        for (const scene of ["bright", "dark", "broken"]) {
          await page.getByTestId(`open-lightbox-${scene}`).click();
          await shot(page, `lightbox-${scene}`, theme, size);
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        await page.getByTestId("open-lightbox-bright").click();
        await page.locator('input[type="file"]').setInputFiles({
          name: "after.png",
          mimeType: "image/png",
          buffer: await comparePng(page),
        });
        await shot(page, "lightbox-compare", theme, size);
        await page.keyboard.press("Escape");
      });
    }
  }
});

test.describe("F6 theme signal", () => {
  for (const theme of THEMES) {
    test(`ImageCompare separator and handle colors follow the app theme (${theme})`, async ({
      page,
    }) => {
      await setup(page, theme);
      const root = '[data-testid="compare-bright-dark"]';
      const line = `${root} [class*="line"]`;
      const handle = `${root} [data-handle]`;
      const colors = {
        line: await colorOf(page, line, "backgroundColor"),
        handle: await colorOf(page, handle, "backgroundColor"),
        handleBorder: await colorOf(page, handle, "borderTopColor"),
        text: await colorOf(page, handle, "color"),
        chip: await colorOf(page, `${root} [class*="chip"]`, "backgroundColor"),
      };
      console.log(`F6 ${theme} ${JSON.stringify(colors)}`);
      await page.screenshot({
        path: `${SHOTS}/${PREFIX}f6-compare-${theme}-1280.png`,
        clip: (await page.locator(root).boundingBox()) ?? undefined,
      });
    });
  }
});

test.describe("F6 resolved colors", () => {
  test("separator and handle are theme-neutral and match in both themes", async ({ page }) => {
    const seen: Record<string, string[]> = {};
    for (const theme of THEMES) {
      await setup(page, theme);
      const root = '[data-testid="compare-bright-dark"]';
      seen[theme] = [
        await colorOf(page, `${root} [class*="line"]`, "backgroundColor"),
        await colorOf(page, `${root} [data-handle]`, "backgroundColor"),
        await colorOf(page, `${root} [data-handle]`, "color"),
        await colorOf(page, `${root} [class*="chip"]`, "color"),
      ];
    }
    expect(seen.light).toEqual(seen.dark);
    expect(seen.dark[0]).toBe("rgb(255, 255, 255)");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  });
});

test.describe("lightbox", () => {
  test("Escape closes the preview and returns focus to the trigger", async ({ page }) => {
    await setup(page, "dark");
    const trigger = page.getByTestId("open-lightbox-bright");
    await trigger.focus();
    await trigger.press("Enter");
    const viewport = page.getByRole("group", { name: "Image preview: bright photo" });
    await expect(viewport).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.__mediaLog.includes("lightbox-close:bright"))).toBe(
      true,
    );
  });

  test("zoom buttons and keys share one transform and reset", async ({ page }) => {
    await setup(page, "light");
    await page.getByTestId("open-lightbox-bright").click();
    const image = page.getByRole("dialog").locator("img");
    const scale = () => image.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(await scale()).toBeCloseTo(1);
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await scale()).toBeCloseTo(1.5);
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeEnabled();
    await page.getByRole("group", { name: "Image preview: bright photo" }).focus();
    await page.keyboard.press("+");
    expect(await scale()).toBeCloseTo(2.25);
    await page.keyboard.press("0");
    expect(await scale()).toBeCloseTo(1);
    await page.getByRole("button", { name: "Zoom out" }).click();
    expect(await scale()).toBeLessThan(1);
    await page.getByRole("button", { name: "Reset zoom" }).click();
    expect(await scale()).toBeCloseTo(1);
  });

  test("a broken image shows a readable alert with Retry and Close", async ({ page }) => {
    await setup(page, "dark");
    await page.getByTestId("open-lightbox-broken").click();
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("Preview unavailable");
    const retry = alert.getByRole("button", { name: "Retry" });
    await expect(retry).toBeFocused();
    await retry.click();
    await expect(alert).toContainText("Preview unavailable");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("compare mode swaps the toolbar, exposes a keyboard slider and can stop", async ({
    page,
  }) => {
    await setup(page, "light");
    await page.getByTestId("open-lightbox-bright").click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "after.png",
      mimeType: "image/png",
      buffer: await comparePng(page),
    });
    const dialog = page.getByRole("dialog");
    const slider = dialog.getByRole("slider");
    await expect(slider).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "49");
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Reopening starts in view mode again.
    await page.getByTestId("open-lightbox-bright").click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Zoom in" })).toBeVisible();
  });
});

test.describe("compare", () => {
  test("keys, pointer taps and reduced motion move the divider", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, "dark");
    const card = page.getByTestId("compare-bright-dark");
    const slider = card.getByRole("slider");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "49");
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    const box = (await card.locator("[data-orientation]").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await expect(slider).toHaveAttribute("aria-valuenow", "75");
  });

  test("a failed side shows a readable fallback instead of a blank pane", async ({ page }) => {
    await setup(page, "light");
    const card = page.getByTestId("compare-broken");
    await expect(card.getByRole("status")).toContainText("Preview unavailable");
    await expect(card.getByRole("status")).toHaveCount(1);
  });
});

test.describe("annotation", () => {
  test("draws, undoes and exports through the owner without touching disk", async ({ page }) => {
    await setup(page, "light");
    const card = page.getByTestId("annotator-mixed");
    const layer = card.locator("svg[role='group']");
    await layer.scrollIntoViewIfNeeded();
    const box = (await layer.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("annotation-count-mixed")).toContainText("1 marks");
    await page.getByRole("button", { name: "Export" }).first().click();
    await expect(page.getByTestId("annotation-count-mixed")).toContainText("export:1");
    await card.getByRole("button", { name: "Undo annotation" }).click();
    await expect(page.getByTestId("annotation-count-mixed")).toContainText("0 marks");
  });

  test("keyboard drawing shows the visible hint and focus ring", async ({ page }) => {
    await setup(page, "dark");
    const card = page.getByTestId("annotator-mixed");
    await card.getByRole("button", { name: "Add numbered pin" }).click();
    const layer = card.locator("svg[role='group']");
    await layer.focus();
    await page.keyboard.press("ArrowRight");
    await expect(card.locator("[data-visible]")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("annotation-count-mixed")).toContainText("1 marks");
    await shot(page, "annotation-keyboard", "dark", "1280");
  });

  test("a failed frame offers Retry and keeps drawing off", async ({ page }) => {
    await setup(page, "light");
    const card = page.getByTestId("annotator-broken");
    await expect(card.getByRole("alert")).toContainText("Preview unavailable");
    await expect(card.locator("svg[role='group']")).toHaveCount(0);
    await card.getByRole("button", { name: "Retry" }).click();
    await expect(card.getByRole("alert")).toContainText("Preview unavailable");
  });
});
