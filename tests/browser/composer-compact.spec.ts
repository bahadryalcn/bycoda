import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Fixture evidence for the composer reading mode (V2-001). Captures are written
// only when V2_CAPTURE is set; the assertions always run.
const captureDir = process.env.V2_CAPTURE_DIR ?? "temp/verification/v2-001";
if (process.env.V2_CAPTURE) mkdirSync(captureDir, { recursive: true });
async function capture(page: Page, name: string) {
  if (process.env.V2_CAPTURE) {
    const folder = process.env.V2_CAPTURE_DIR
      ? `${captureDir}/${test.info().project.name}`
      : captureDir;
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${name}.png` });
  }
}

type Fixture = { events: { sends: number; stops: number } };
const fixtureEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { compactFixture: Fixture }).compactFixture.events);
const stream = (page: Page, chunks: number) =>
  page.evaluate(
    (count) =>
      (
        window as unknown as { compactFixture: { stream: (chunks: number) => void } }
      ).compactFixture.stream(count),
    chunks,
  );
const finish = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { compactFixture: { finish: () => void } }).compactFixture.finish(),
  );

const url = (query: Record<string, string> = {}, light = false) => {
  const params = new URLSearchParams(query);
  if (light) params.set("light", "");
  return `/tests/browser/composer-compact.html?${params}`;
};
const scroller = (page: Page) => page.locator(".agent-transcript");
const reading = (page: Page) => page.locator("[data-composer][data-composer-reading]");
const field = (page: Page) => page.locator("[data-composer] textarea");
const state = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".agent-transcript")!;
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
    return {
      top: el.scrollTop,
      distance: el.scrollHeight - el.scrollTop - el.clientHeight,
      viewport: el.clientHeight,
      dock: dock.getBoundingClientRect().height,
      field: input.getBoundingClientRect().height,
      fieldScrolls: input.scrollHeight > input.clientHeight + 1,
      reading: !!document.querySelector("[data-composer][data-composer-reading]"),
    };
  });
async function wheel(page: Page, deltaY: number) {
  const box = (await scroller(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(120);
}
async function readHistory(page: Page, deltaY = -1800) {
  await wheel(page, deltaY);
  await expect(reading(page)).toHaveCount(1);
  // Let the dock motion settle before measuring.
  await page.waitForTimeout(350);
}
async function open(page: Page, query: Record<string, string> = {}, light = false) {
  await page.goto(url(query, light));
  await expect(field(page)).toBeVisible();
  // The transcript renders its history progressively (later in WebKit); wait until it has
  // settled so the reader's first scroll happens over the full history, not an empty start.
  let previous = -1;
  await expect
    .poll(async () => {
      const height = await scroller(page).evaluate((el) => el.scrollHeight);
      const settled = height === previous && height > 2 * (await state(page)).viewport;
      previous = height;
      return settled;
    })
    .toBe(true);
  await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
}

for (const light of [false, true]) {
  const theme = light ? "light" : "dark";
  test.describe(theme, () => {
    test("normal at the end, compact while reading history, normal on focus and at the end", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, {}, light);
      const normal = await state(page);
      expect(normal.reading).toBe(false);
      await capture(page, `${theme}-1280-1-bottom-normal`);

      await readHistory(page);
      const compact = await state(page);
      expect(compact.field).toBeLessThan(normal.field);
      expect(compact.dock).toBeLessThan(normal.dock - 30);
      expect(compact.viewport).toBeGreaterThan(normal.viewport + 30);
      await capture(page, `${theme}-1280-2-reading-compact-empty`);

      // Focus restores the normal layout without moving the reading position.
      const before = (await state(page)).top;
      await field(page).click();
      await expect(reading(page)).toHaveCount(0);
      await page.waitForTimeout(350);
      const focused = await state(page);
      expect(Math.abs(focused.top - before)).toBeLessThanOrEqual(1);
      expect(focused.dock).toBeGreaterThan(compact.dock + 30);
      await capture(page, `${theme}-1280-3-focused-normal`);

      // Leaving focus while still reading history compacts again.
      await page.locator(".agent-transcript").click({ position: { x: 40, y: 40 } });
      await expect(reading(page)).toHaveCount(1);
      await page.waitForTimeout(350);
      expect(Math.abs((await state(page)).top - before)).toBeLessThanOrEqual(1);

      // Returning to the end restores the normal layout and following.
      await wheel(page, 20000);
      await expect(reading(page)).toHaveCount(0);
      await page.waitForTimeout(350);
      const end = await state(page);
      expect(end.distance).toBeLessThan(2);
      expect(Math.abs(end.dock - normal.dock)).toBeLessThanOrEqual(1);
    });

    test("one mounted textarea keeps its draft, caret and size to its content", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const heights: Record<string, number> = {};
      for (const draft of ["none", "short", "multi", "long"]) {
        await open(page, { draft }, light);
        await page.evaluate(() => {
          const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
          (window as unknown as { mounted: HTMLTextAreaElement }).mounted = input;
          input.setSelectionRange(2, Math.min(7, input.value.length));
        });
        const full = await state(page);
        await readHistory(page);
        const compact = await state(page);
        heights[draft] = compact.field;
        expect(compact.field).toBeLessThanOrEqual(full.field);
        await capture(page, `${theme}-1280-4-reading-draft-${draft}`);
        await field(page).focus();
        await expect(reading(page)).toHaveCount(0);
        const kept = await page.evaluate(() => {
          const input = document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")!;
          const mounted = (window as unknown as { mounted: HTMLTextAreaElement }).mounted;
          return {
            same: input === mounted,
            start: input.selectionStart,
            end: input.selectionEnd,
            length: input.value.length,
            textareas: document.querySelectorAll("textarea").length,
          };
        });
        expect(kept.same).toBe(true);
        expect(kept.textareas).toBe(1);
        expect(kept.start).toBe(Math.min(2, kept.length));
        expect(kept.end).toBe(Math.min(7, kept.length));
      }
      // Empty and short drafts share one readable row; more text gets more room.
      expect(heights.none).toBe(heights.short);
      expect(heights.multi).toBeGreaterThan(heights.short + 20);
      expect(heights.long).toBeGreaterThanOrEqual(heights.multi);
      // A very long draft is capped and scrolls inside the field.
      await open(page, { draft: "long" }, light);
      await readHistory(page);
      const long = await state(page);
      expect(long.field).toBeLessThanOrEqual(132 + 2);
      expect(long.fieldScrolls).toBe(true);
    });

    test("does not toggle back and forth after compacting", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, { draft: "short" }, light);
      await page.evaluate(() => {
        const toggles: boolean[] = [];
        (window as unknown as { toggles: boolean[] }).toggles = toggles;
        new MutationObserver(() => {
          toggles.push(!!document.querySelector("[data-composer][data-composer-reading]"));
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-composer-reading"],
        });
      });
      // A gentle upward scroll that ends just past the entry distance.
      await wheel(page, -230);
      await page.waitForTimeout(800);
      const toggles = await page.evaluate(
        () => (window as unknown as { toggles: boolean[] }).toggles,
      );
      expect(toggles.length).toBeLessThanOrEqual(1);
    });
  });
}

test("the first click on a compact control opens its menu and the layout stays normal while open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  const compact = await state(page);

  // First click on a compact control opens it; nothing is sent or switched.
  await page.locator("[data-composer-model-controls] button").first().click();
  await expect(reading(page)).toHaveCount(0);
  // Shared tooltips also use popover frames; the pointer may rest on a hinted control.
  const menu = page
    .locator("[data-popover-side]:not([role='tooltip']):not(:has([role='tooltip']))")
    .first();
  await expect(menu).toBeVisible();
  await page.waitForTimeout(350);
  // The menu stays attached to its trigger after the layout swap.
  const trigger = await page.locator("[data-composer-model-controls] button").first().boundingBox();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(trigger!.y + 2);
  expect(trigger!.y - (menuBox.y + menuBox.height)).toBeLessThan(40);
  await capture(page, "dark-1280-5-model-menu-from-reading");
  expect((await fixtureEvents(page)).sends).toBe(0);

  // Focus inside the menu is still the composer: no compacting while it is open.
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(reading(page)).toHaveCount(0);
  expect((await state(page)).dock).toBeGreaterThan(compact.dock + 30);
  expect((await fixtureEvents(page)).sends).toBe(0);
});

test("keyboard Tab through the composer and its add menu never compacts it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  await field(page).focus();
  await expect(reading(page)).toHaveCount(0);
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    await expect(reading(page)).toHaveCount(0);
  }
  const add = page.getByRole("button", { name: "Add files or skills", exact: true });
  await add.focus();
  await add.press("ArrowDown");
  await expect(page.getByRole("menu", { name: "Add files or skills", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await expect(reading(page)).toHaveCount(0);
  // Focus leaving the composer while still reading history compacts it again.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(reading(page)).toHaveCount(1);
});

test("a click on the compact box focuses the input without sending", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await readHistory(page);
  const box = (await page.locator("[data-composer-box]").boundingBox())!;
  // The box edge above the text, outside any control.
  await page.mouse.click(box.x + box.width / 2, box.y + 2);
  await expect(field(page)).toBeFocused();
  await expect(reading(page)).toHaveCount(0);
  expect((await fixtureEvents(page)).sends).toBe(0);
});

test("streaming does not move a reader of history; at the end it keeps following", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  // Following the end while a reply streams.
  await stream(page, 30);
  await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
  await stream(page, 30);
  await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
  // Reading history while it continues.
  await readHistory(page);
  const reader = (await state(page)).top;
  for (let index = 0; index < 5; index++) {
    await stream(page, 20);
    await page.waitForTimeout(80);
  }
  expect(Math.abs((await state(page)).top - reader)).toBeLessThanOrEqual(1);
  await expect(reading(page)).toHaveCount(1);
  // The stop control stays reachable while the turn runs.
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await finish(page);
  // Back at the end: the normal layout returns and following resumes.
  await wheel(page, 20000);
  await expect(reading(page)).toHaveCount(0);
  // A dispatched wheel and normal composer alone do not prove its off-thread
  // scroll reached the end. Verify that precondition with the same strict bound.
  await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
  await stream(page, 40);
  await expect.poll(async () => (await state(page)).distance).toBeLessThan(2);
  await testInfo.attach("following-geometry", {
    body: JSON.stringify(await state(page)),
    contentType: "application/json",
  });
  await page.screenshot({ path: testInfo.outputPath("streaming-following-end.png") });
});

test("reduced motion swaps the layout without an animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, { draft: "short" });
  await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    (window as unknown as { animations: number }).animations = 0;
    const animate = dock.animate.bind(dock);
    dock.animate = (...args: Parameters<typeof animate>) => {
      (window as unknown as { animations: number }).animations++;
      return animate(...args);
    };
  });
  await wheel(page, -1800);
  await expect(reading(page)).toHaveCount(1);
  await field(page).focus();
  await expect(reading(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { animations: number }).animations)).toBe(
    0,
  );
});

for (const size of [
  { width: 800, height: 800, label: "800" },
  { width: 1280, height: 560, label: "1280x560" },
]) {
  for (const light of [false, true]) {
    test(`narrow and short windows keep the composer usable (${size.label}, ${light ? "light" : "dark"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open(page, { draft: "wrap", attach: "" }, light);
      const theme = light ? "light" : "dark";
      await capture(page, `${theme}-${size.label}-1-bottom-normal`);
      await readHistory(page);
      const compact = await state(page);
      expect(compact.dock).toBeLessThan(size.height / 2);
      expect(compact.field).toBeLessThanOrEqual(132 + 2);
      await capture(page, `${theme}-${size.label}-2-reading-compact-wrapped-draft`);
      await field(page).focus();
      await expect(reading(page)).toHaveCount(0);
      await capture(page, `${theme}-${size.label}-3-focused-normal`);
      // Send and the model control stay reachable while reading.
      await page.locator(".agent-transcript").click({ position: { x: 30, y: 30 } });
      await expect(reading(page)).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
      await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
    });
  }
}

test("a real Chromium IME composition keeps the full layout and commits into the same draft", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Input.imeSetComposition is a Chromium DevTools protocol command",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await readHistory(page);
  await field(page).click();
  await expect(reading(page)).toHaveCount(0);
  await page.waitForTimeout(350);
  const before = await state(page);
  await page.evaluate(() => {
    (window as unknown as { imeNode: Element }).imeNode = document.querySelector(
      "[data-composer] textarea",
    )!;
  });
  // Chromium's input-method path (compositionstart/update), not synthetic events.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "かな", selectionStart: 2, selectionEnd: 2 });
  await expect(field(page)).toHaveValue(/かな/);
  await page.waitForTimeout(200);
  expect((await state(page)).reading).toBe(false);
  await cdp.send("Input.insertText", { text: "仮名" });
  await expect(field(page)).toHaveValue(/仮名/);
  const after = await state(page);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { imeNode: Element }).imeNode ===
        document.querySelector("[data-composer] textarea"),
    ),
  ).toBe(true);
  // Leaving the composer while still reading compacts it again with the committed text.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(reading(page)).toHaveCount(1);
  await expect(field(page)).toHaveValue(/仮名/);
});

test("a file dragged over the compact composer gets the full drop target until it leaves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await readHistory(page);
  const drag = (type: string) =>
    page.evaluate((name) => {
      const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
      const data = new DataTransfer();
      data.items.add(new File(["x"], "note.txt", { type: "text/plain" }));
      dock.dispatchEvent(
        new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: data }),
      );
    }, type);
  await drag("dragenter");
  await expect(reading(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(reading(page)).toHaveCount(0);
  await drag("dragleave");
  await expect(reading(page)).toHaveCount(1);
});

// Reading mode under every supported control density (compact | comfortable | touch).
// Density changes shared control heights; the dock must still shrink while reading,
// stay one row when empty, return to the normal layout on focus and keep its controls.
const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const dock = document.querySelector<HTMLElement>("[data-session-composer]")!;
    const bounds = dock.getBoundingClientRect();
    const clipped = [...dock.querySelectorAll<HTMLElement>("button, textarea")].filter((el) => {
      const box = el.getBoundingClientRect();
      return (
        box.width > 0 &&
        (box.right > bounds.right + 1 || box.left < bounds.left - 1 || box.right > innerWidth + 1)
      );
    });
    return {
      page: root.scrollWidth - root.clientWidth,
      dock: dock.scrollWidth - dock.clientWidth,
      clipped: clipped.map((el) => el.getAttribute("aria-label") ?? el.tagName),
    };
  });
for (const density of ["compact", "comfortable", "touch"]) {
  for (const light of [false, true]) {
    const theme = light ? "light" : "dark";
    for (const draft of ["none", "short"]) {
      test(`density ${density}: bottom normal, reading compact, focus normal (${theme}, ${draft} draft)`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, { density, draft }, light);
        expect(await page.evaluate(() => document.documentElement.dataset.controlDensity)).toBe(
          density,
        );
        const normal = await state(page);
        expect(normal.reading).toBe(false);
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
        await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
        await capture(page, `density-${density}-${theme}-${draft}-1-bottom-normal`);

        await readHistory(page);
        const compact = await state(page);
        expect(compact.dock).toBeLessThan(normal.dock - (draft === "none" ? 30 : 20));
        expect(compact.viewport).toBeGreaterThan(normal.viewport + 20);
        expect(compact.field).toBeLessThan(normal.field);
        if (draft === "none") {
          // One row when empty: no taller than a single line plus the field padding.
          expect(await field(page).getAttribute("rows")).toBe("1");
          expect(compact.field).toBeLessThanOrEqual(48);
          expect(compact.fieldScrolls).toBe(false);
        }
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
        await expect(page.locator("[data-composer-model-controls] button").first()).toBeVisible();
        await capture(page, `density-${density}-${theme}-${draft}-2-reading-compact`);

        const before = (await state(page)).top;
        await field(page).click();
        await expect(reading(page)).toHaveCount(0);
        await page.waitForTimeout(350);
        const focused = await state(page);
        expect(Math.abs(focused.top - before)).toBeLessThanOrEqual(1);
        expect(Math.abs(focused.dock - normal.dock)).toBeLessThanOrEqual(2);
        expect(await overflow(page)).toEqual({ page: 0, dock: 0, clipped: [] });
        await capture(page, `density-${density}-${theme}-${draft}-3-focused-normal`);
      });
    }
  }
}

test.describe("touch input", () => {
  test.use({ hasTouch: true });
  test("a tap on the compact composer focuses the same draft without sending", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await open(page, { draft: "short" });
    await readHistory(page);
    const before = await field(page).inputValue();
    const box = (await page.locator("[data-composer-box]").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 2);
    await expect(reading(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue(before);
    expect((await fixtureEvents(page)).sends).toBe(0);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  });
});
