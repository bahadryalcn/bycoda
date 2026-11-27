import { expect, test, type Locator, type Page } from "@playwright/test";
import { scrollToAsReader } from "../support/readerScroll";

// k12 §6.2: the reading surface on the transcript scenario fixture. Selectors follow the k12 §5.1
// contract ([data-transcript-reply], [data-transcript-actions-row], html[data-transcript-surface]).
// Colors are resolved through a canvas pixel, so color-mix() and oklab() values compare exactly.

const base = "/tests/browser/chat/transcript-scenario.html";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
type Rgba = { r: number; g: number; b: number; a: number };

const open = async (page: Page, query: Record<string, string> = {}) => {
  // The question dock floats over the reply and would cover rows and pixels under measurement.
  await page.goto(`${base}?${new URLSearchParams({ question: "0", ...query })}`);
  await expect(page.locator("[data-transcript-turn]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // A settled turn folds its work behind one line and groups its steps; the row states under test
  // live inside them, so open the fold and then each step group (groups never nest).
  if (query.scene === "interleaved" && query.streaming !== "1") {
    const fold = interleavedTurn(page).getByLabel("Show the work", { exact: true });
    await scrollToAsReader(page, fold);
    await fold.click();
    const groups = interleavedTurn(page).locator("details:not([open]) > summary", {
      hasText: /^(Ran|Read) /,
    });
    await expect(groups.first()).toBeVisible();
    // Each click settles before the next, so a group is never toggled twice.
    for (let left = await groups.count(); left > 0; left -= 1) {
      await groups.first().click();
      await expect(groups).toHaveCount(left - 1);
    }
    // The last click leaves the pointer on a row; its hover fill is not part of the resting state.
    await page.mouse.move(0, 0);
  }
};
const interleavedTurn = (page: Page) =>
  page.locator("[data-transcript-turn]").filter({ hasText: "Fix the flicker" });
const interleavedReply = (page: Page) =>
  interleavedTurn(page).locator("[data-transcript-reply]").first();

for (const theme of ["light", "dark"] as const) {
  test(`clicking the transcript and pressing Escape leaves no visible outline (${theme})`, async ({
    page,
  }) => {
    await open(page, { theme, scene: "interleaved", streaming: "1" });
    const transcript = page.locator(".agent-transcript");
    await transcript.click({ position: { x: 8, y: 20 } });
    await page.keyboard.press("Escape");
    await expect(transcript).toBeFocused();
    const outline = await transcript.evaluate((element, transparent) => {
      const { outlineColor, outlineStyle, outlineWidth } = getComputedStyle(element);
      return outlineStyle !== "none" && outlineColor !== transparent && outlineWidth !== "0px";
    }, TRANSPARENT);
    expect(outline).toBe(false);
  });
}

async function resolveColor(page: Page, css: string): Promise<Rgba> {
  return page.evaluate((value) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a };
  }, css);
}
// Buttons ease their ink in (Arc Button transitions `color`), and worstContrast has just hidden and
// restored it, so a slow runner would read a half-transparent mid-transition color as black.
const inkOf = async (page: Page, locator: Locator) =>
  resolveColor(
    page,
    await locator.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})));
      return getComputedStyle(el).color;
    }),
  );

const luminance = ({ r, g, b }: Rgba) => {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

// Worst contrast of `ink` against every pixel behind the reply. The text is made transparent and
// icons, chips, code cards and guide lines (which carry their own ink and fill) are hidden,
// the reply is captured, and each captured pixel is compared, so the measure is the real composite.
async function worstContrast(page: Page, reply: Locator, ink: Rgba): Promise<number> {
  const style = await page.addStyleTag({
    content:
      '[data-transcript-reply] * { transition: none !important; color: transparent !important; -webkit-text-fill-color: transparent !important; border-color: transparent !important; } [data-transcript-reply] *::before, [data-transcript-reply] *::after { visibility: hidden !important; } [data-transcript-reply] :is(svg, img, canvas, button, code, pre, table, .bg-sidebar, [class*="_badge_"], [class*="_appearance_"], [class*="_track_"], [data-transcript-inset]) { visibility: hidden !important; }',
  });
  // A reply taller than the viewport is captured in pieces with the fixed composer and wallpaper
  // stitched in; a viewport that holds the whole reply measures the reply surface only.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 3200 });
  await expect(reply).toBeVisible();
  const png = await reply.screenshot({ animations: "disabled" });
  await page.setViewportSize(viewport);
  await style.evaluate((node: HTMLElement) => node.remove());
  return page.evaluate(
    async ({ base64, ink }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const lum = (r: number, g: number, b: number) => {
        const c = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const inkLum = lum(ink.r, ink.g, ink.b);
      let worst = Infinity;
      // Text never sits in the rounded corners or the padding ring, where the capture shows the
      // wallpaper past the surface edge instead of the surface.
      const edge = 16;
      for (let i = 0; i < data.length; i += 4) {
        const px = (i / 4) % canvas.width;
        const py = Math.floor(i / 4 / canvas.width);
        if (px < edge || py < edge || px >= canvas.width - edge || py >= canvas.height - edge)
          continue;
        const bgLum = lum(data[i], data[i + 1], data[i + 2]);
        const ratio = (Math.max(inkLum, bgLum) + 0.05) / (Math.min(inkLum, bgLum) + 0.05);
        if (ratio < worst) worst = ratio;
      }
      return worst;
    },
    { base64: png.toString("base64"), ink },
  );
}

test.describe("one reply, one surface", () => {
  test("an interleaved reply is one surface and its rows sit inside it", async ({ page }) => {
    await open(page, { scene: "interleaved" });
    const replies = interleavedTurn(page).locator("[data-transcript-reply]");
    await expect(replies).toHaveCount(1);
    const reply = replies.first();
    for (const text of ["I will check the setup first", "The checks pass", "Two agents are idle"])
      await expect(reply.getByText(text).first()).toBeAttached();
    await expect(reply.getByText("bun run check", { exact: true }).first()).toBeAttached();
    // Rows carry no fill of their own; user bubbles, code, tables, inset cards, severity chips and
    // progress tracks are the exceptions.
    const stray = await reply.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("*")]
        .filter((el) => {
          if (
            el.closest(
              '[data-chat-message-surface="user"], pre, code, table, [data-transcript-inset], .bg-sidebar, .markdown-code-copy, [class*="_badge_"], [class*="_highlight_"], [class*="_appearance_"], [class*="_track_"]',
            )
          )
            return false;
          const bg = getComputedStyle(el).backgroundColor;
          return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`),
    );
    expect(stray).toEqual([]);
  });

  test("the reply fill does not change while the turn streams", async ({ page }) => {
    await open(page, { scene: "interleaved", streaming: "1" });
    await expect(page.locator('[data-session-streaming="true"]').first()).toBeAttached();
    const streaming = await page
      .locator("[data-transcript-reply]")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await open(page, { scene: "interleaved", streaming: "0" });
    const settled = await page
      .locator("[data-transcript-reply]")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(streaming).toBe(settled);
  });
});

test.describe("ink order", () => {
  for (const theme of ["dark", "light"] as const)
    for (const contrastValue of [75, 100, 150])
      test(`body is at least as strong as chrome and actions in ${theme} at contrast ${contrastValue}`, async ({
        page,
      }) => {
        await open(page, { scene: "interleaved", theme, contrast: String(contrastValue) });
        const reply = interleavedReply(page);
        const body = reply.locator(".agent-markdown p").first();
        const chrome = reply.getByText("bun run check", { exact: true }).first();
        const action = reply.locator("[data-transcript-actions-row] button").first();
        const bodyWorst = await worstContrast(page, reply, await inkOf(page, body));
        const chromeWorst = await worstContrast(page, reply, await inkOf(page, chrome));
        const actionWorst = await worstContrast(page, reply, await inkOf(page, action));
        expect(bodyWorst).toBeGreaterThanOrEqual(chromeWorst);
        expect(bodyWorst).toBeGreaterThanOrEqual(actionWorst);
      });
});

test.describe("imghigh contrast", () => {
  for (const theme of ["dark", "light"] as const)
    test(`body reaches 7:1 and chrome 4.5:1 over the busiest wallpaper in ${theme}`, async ({
      page,
    }) => {
      await open(page, { scene: "interleaved", theme, bg: "image", opacity: "0.65" });
      const reply = interleavedReply(page);
      const body = reply.locator(".agent-markdown p").first();
      const chrome = reply.getByText("bun run check", { exact: true }).first();
      expect(await worstContrast(page, reply, await inkOf(page, body))).toBeGreaterThanOrEqual(7);
      expect(await worstContrast(page, reply, await inkOf(page, chrome))).toBeGreaterThanOrEqual(
        4.5,
      );
    });
});

test.describe("hover", () => {
  test("hover moves chrome to body ink and keeps the font weight", async ({ page }) => {
    await open(page, { scene: "interleaved" });
    const reply = interleavedReply(page);
    const row = reply.getByText("bun run check", { exact: true }).first();
    const body = reply.locator(".agent-markdown p").first();
    const weightBefore = await row.evaluate((el) => getComputedStyle(el).fontWeight);
    await row.hover();
    const weightAfter = await row.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weightAfter).toBe(weightBefore);
    // Dark theme only: hover may brighten chrome up to the body ink, never past it.
    const chromeHover = luminance(await inkOf(page, row));
    const bodyInk = luminance(await inkOf(page, body));
    expect(chromeHover).toBeLessThanOrEqual(bodyInk + 1e-6);
  });
});

test.describe("trigger", () => {
  test("every openable row opens from its left, middle, right and arrow points", async ({
    page,
  }) => {
    await open(page, { scene: "interleaved" });
    const summaries = page.locator("[data-transcript-reply] details > summary");
    const count = await summaries.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const summary = summaries.nth(index);
      const details = summary.locator("xpath=..");
      await scrollToAsReader(page, summary);
      await page.mouse.move(0, 0);
      // The arrow is always visible at rest.
      await expect(summary.locator("svg").last()).toHaveCSS("opacity", "1");
      const pointsFor = async () => {
        const box = (await summary.boundingBox())!;
        const arrow = (await summary.locator("svg").last().boundingBox())!;
        const middleY = box.y + box.height / 2;
        return {
          left: { x: box.x + 8, y: middleY },
          middle: { x: box.x + box.width / 2, y: middleY },
          // 8px in: the hover wash overhangs the gutter by 6px and the transcript clips that overhang.
          right: { x: box.x + box.width - 8, y: middleY },
          arrow: { x: arrow.x + arrow.width / 2, y: arrow.y + arrow.height / 2 },
        };
      };
      let expected = await details.evaluate((node: HTMLDetailsElement) => node.open);
      for (const name of ["left", "middle", "right", "arrow"] as const) {
        // Toggling a row re-measures the virtual list, so the point is taken fresh each time.
        await scrollToAsReader(page, summary);
        await expect
          .poll(async () => {
            const before = JSON.stringify(await summary.boundingBox());
            await page.waitForTimeout(100);
            return before === JSON.stringify(await summary.boundingBox());
          })
          .toBe(true);
        const point = (await pointsFor())[name];
        const hitsSummary = await summary.evaluate(
          (node, { x, y }) => node.contains(document.elementFromPoint(x, y)),
          point,
        );
        expect(hitsSummary, `${name} point of row ${index}`).toBe(true);
        // A file chip or action inside the row owns its own click; only bare row points toggle.
        const onAction = await summary.evaluate(
          (node, { x, y }) =>
            !!document.elementFromPoint(x, y)?.closest("button, a, [role=button]"),
          point,
        );
        if (onAction) continue;
        await page.mouse.click(point.x, point.y);
        expected = !expected;
        await expect(details, `${name} click on row ${index}`).toHaveJSProperty("open", expected);
      }
    }
  });

  test("a row without steps has no arrow and a click opens nothing", async ({ page }) => {
    await open(page, { scene: "interleaved" });
    const reply = interleavedReply(page);
    const row = reply.getByText("Contrast check", { exact: true }).first();
    await expect(row).toBeAttached();
    await expect(reply.locator("details > summary:has-text('Contrast check')")).toHaveCount(0);
    const openBefore = await reply.locator("details[open]").count();
    await row.click();
    await expect(reply.locator("details[open]")).toHaveCount(openBefore);
  });

  test("Enter and Space open and close a row from the keyboard", async ({ page }) => {
    await open(page, { scene: "interleaved" });
    const summary = page.locator("[data-transcript-reply] details > summary").first();
    const details = summary.locator("xpath=..");
    const initial = await details.evaluate((node: HTMLDetailsElement) => node.open);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", !initial);
    await page.keyboard.press("Space");
    await expect(details).toHaveJSProperty("open", initial);
  });

  // shortcut: the Appearance > Chat controls need the Appearance page fixture, which this spec does
  // not load; their attribute and variable wiring is covered by the appearance unit tests.
  test.skip("Chat settings controls rewrite the preview root", async () => {});
});

test.describe("surface modes", () => {
  test("reply paints the surface, column paints the column, off paints nothing", async ({
    page,
  }) => {
    for (const mode of ["reply", "column", "off"] as const) {
      await open(page, { scene: "interleaved", surface: mode });
      await expect(page.locator("html")).toHaveAttribute("data-transcript-surface", mode);
      const replyFill = await interleavedReply(page).evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const columnFill = await page
        .locator(".transcript-content")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      if (mode === "reply") expect(replyFill).not.toBe(TRANSPARENT);
      if (mode === "column") {
        expect(replyFill).toBe(TRANSPARENT);
        expect(columnFill).not.toBe(TRANSPARENT);
      }
      if (mode === "off") expect(replyFill).toBe(TRANSPARENT);
    }
  });

  test("actions=hover shows the action row only while its reply is hovered", async ({ page }) => {
    await open(page, { actions: "hover" });
    const reply = page.locator("[data-transcript-reply]").first();
    const row = reply.locator("[data-transcript-actions-row]").first();
    await page.mouse.move(0, 0);
    await expect(row).toHaveCSS("opacity", "0");
    // The transcript follows its tail until a real wheel gesture leaves it, so reach the first
    // reply the way a reader does instead of scrolling the page programmatically.
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, -4000);
    await expect(reply).toBeInViewport();
    await reply.hover({ position: { x: 20, y: 20 } });
    await expect(row).toHaveCSS("opacity", "1");
  });

  test("reduced transparency makes the reply opaque and drops the backdrop filter", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Emulation.setEmulatedMedia is Chromium-only");
    await open(page, { scene: "interleaved", bg: "image" });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    const reply = interleavedReply(page);
    await expect(reply).toHaveCSS("backdrop-filter", "none");
    const fill = await resolveColor(
      page,
      await reply.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    expect(fill.a).toBe(255);
  });
});
