import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __counters: Record<string, number>;
    __clipboard: { writes: string[]; mode: "ok" | "fail" };
  }
}

const URL = "/tests/browser/overlay-feedback.html";
// FEEDBACK_CAPTURE="baseline-" (or "" for the final set) writes the evidence PNGs.
const prefix = process.env.FEEDBACK_CAPTURE;
const outDir = "temp/verification/2026-10-28-session5-overlays/feedback";

async function open(page: Page, query = "") {
  await page.goto(`${URL}${query}`);
  await page.waitForSelector("[data-section], main, section");
  await page.waitForTimeout(700);
}
const counter = (page: Page, name: string) =>
  page.evaluate((key) => window.__counters[key] ?? 0, name);

test.describe("evidence captures", () => {
  test.skip(prefix === undefined, "set FEEDBACK_CAPTURE to write screenshots");
  const sections = ["status", "notices", "empty", "failure", "progress"];
  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [
      [1280, 800],
      [800, 800],
      [390, 800],
    ] as const) {
      test(`sections ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await open(page, `?theme=${theme}`);
        for (const name of sections) {
          const section = page.locator(`[data-section="${name}"]`);
          // Fit the viewport to the section so one capture shows it whole.
          const box = (await section.boundingBox())!;
          await page.setViewportSize({ width, height: Math.ceil(box.height) + 40 });
          await page.waitForTimeout(250);
          await section.screenshot({ path: `${outDir}/${prefix}${name}-${theme}-${width}.png` });
          await page.setViewportSize({ width, height });
        }
      });
    }
    test(`boot ${theme}`, async ({ page }) => {
      for (const [width, height, tag] of [
        [1280, 800, "1280"],
        [390, 700, "390"],
        [800, 360, "800-short"],
      ] as const) {
        await page.setViewportSize({ width, height });
        await open(page, `?view=boot&theme=${theme}`);
        await page.screenshot({ path: `${outDir}/${prefix}boot-${theme}-${tag}.png` });
        await page.getByRole("button", { name: "Show details" }).click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${outDir}/${prefix}boot-details-${theme}-${tag}.png` });
      }
    });
    test(`reduced motion ${theme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, `?theme=${theme}`);
      await page
        .locator('[data-section="progress"]')
        .screenshot({ path: `${outDir}/${prefix}progress-reduced-${theme}-1280.png` });
    });
  }
});

test.describe("feedback behavior", () => {
  test("status roles: danger asserts, others are polite, decorative indicator is hidden", async ({
    page,
  }) => {
    await open(page);
    const alerts = page.getByTestId("alerts");
    // The danger alert and the inline danger row assert; the other tones stay polite.
    await expect(alerts.getByRole("alert")).toHaveCount(2);
    await expect(alerts.getByRole("alert").first()).toContainText("Could not reach the host");
    await expect(alerts.getByRole("status").filter({ hasText: "Indexing started" })).toHaveCount(1);
    await expect(alerts.getByRole("status")).not.toHaveCount(0);
    const announced = page.getByTestId("working-announced");
    await expect(announced).toHaveAttribute("role", "status");
    await expect(announced.locator('[aria-hidden="true"]').first()).toBeAttached();
    const decorative = page.getByTestId("working-decorative");
    await expect(decorative.locator('[aria-hidden="true"]').first()).toBeAttached();
    await page.getByRole("button", { name: "Announce failure" }).click();
    await expect(page.getByTestId("live-result")).toHaveAttribute("role", "alert");
    await page.getByRole("button", { name: "Announce success" }).click();
    await expect(page.getByTestId("live-result")).toHaveAttribute("role", "status");
    // Distinct glyphs: info and warning no longer share one icon.
    const glyph = (name: string) =>
      alerts.getByText(name).locator("xpath=ancestor::*[@role][1]").locator("svg").first();
    expect(await glyph("Indexing started").innerHTML()).not.toEqual(
      await glyph("Provider needs attention").innerHTML(),
    );
    // The action slot is reachable.
    await alerts.getByRole("button", { name: "Retry" }).click();
    expect(await counter(page, "alert-retry")).toBe(1);
  });

  test("badge grammar: counts are tabular, capped counts keep their number, dots are named", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByLabel("128", { exact: true })).toContainText("9+");
    const numeric = await page
      .locator('[data-section="status"]')
      .getByText("12", { exact: true })
      .first()
      .evaluate((node) => {
        const badge = node.closest("span[class*='count']") as HTMLElement;
        return getComputedStyle(badge).fontVariantNumeric;
      });
    expect(numeric).toContain("tabular-nums");
    await expect(page.getByRole("img", { name: "Offline" })).toBeVisible();
  });

  test("FailureState previews a bounded diagnostic and copies the complete text", async ({
    page,
  }) => {
    await open(page);
    const frame = page.locator('[data-frame="failure-long"]');
    await frame.getByRole("button", { name: "Show details" }).click();
    const pre = frame.getByLabel("Error details");
    const shown = (await pre.textContent()) ?? "";
    expect(shown.length).toBe(8000);
    expect(shown).toContain("HEAD-MARKER");
    expect(shown).not.toContain("TAIL-MARKER");
    await expect(frame.locator("[data-preview-note]")).toContainText("Showing the first 8,000 of");
    await frame.getByRole("button", { name: "Copy details" }).click();
    await expect(frame.getByRole("button", { name: "Copied" })).toBeVisible();
    const write = await page.evaluate(() => window.__clipboard.writes[0]);
    expect(write.startsWith("Could not load the workspace\n\nHEAD-MARKER")).toBe(true);
    expect(write.endsWith("TAIL-MARKER")).toBe(true);
    expect(write.length).toBeGreaterThan(17000);
    await expect(frame.locator("[data-preview-note]")).toBeVisible();
  });

  test("copy failure announces, shows and selects the complete text for manual copy", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => (window.__clipboard.mode = "fail"));
    const frame = page.locator('[data-frame="failure-long"]');
    await frame.getByRole("button", { name: "Show details" }).click();
    await frame.getByRole("button", { name: "Copy details" }).click();
    await expect(frame.getByRole("status")).toContainText("Could not copy");
    const pre = frame.getByLabel("Error details");
    await expect(pre).toContainText("TAIL-MARKER");
    await expect(frame.locator("[data-preview-note]")).toHaveCount(0);
    await expect(pre).toBeFocused();
    const selected = await page.evaluate(() => getSelection()?.toString() ?? "");
    expect(selected).toContain("HEAD-MARKER");
    expect(selected).toContain("TAIL-MARKER");
    // Retry works afterwards without losing the details.
    await page.evaluate(() => (window.__clipboard.mode = "ok"));
    await frame.getByRole("button", { name: "Copy details" }).click();
    await expect(frame.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  test("retry stays with the caller and a pending retry blocks a duplicate", async ({ page }) => {
    await open(page);
    const frame = page.locator('[data-frame="failure-pending"]');
    const retry = frame.getByRole("button", { name: "Reconnect" });
    await expect(retry).toBeVisible();
    await retry.dblclick();
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await retry.click({ force: true });
    expect(await counter(page, "failure-retry-pending")).toBe(1);
    await expect(retry).not.toHaveAttribute("aria-busy", "true", { timeout: 4000 });
    await retry.click();
    expect(await counter(page, "failure-retry-pending")).toBe(2);
    await page
      .locator('[data-frame="failure-short"]')
      .getByRole("button", { name: "Try again" })
      .click();
    expect(await counter(page, "failure-retry-short")).toBe(1);
  });

  test("RecoveryBoundary shows a labelled failure, retries and resets on a key change", async ({
    page,
  }) => {
    await open(page);
    const frame = page.locator('[data-frame="boundary"]');
    await page.getByRole("button", { name: "Break the view" }).click();
    await expect(frame.getByRole("alert")).toContainText("This view could not be displayed");
    await expect(frame.getByRole("button", { name: "Try again" })).toBeVisible();
    await frame.getByRole("button", { name: "Back to workspace" }).click();
    expect(await counter(page, "boundary-back")).toBe(1);
    // Retrying a view that still throws stays failed instead of looping.
    await frame.getByRole("button", { name: "Try again" }).click();
    await expect(frame.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Change reset key" }).click();
    await expect(page.getByTestId("boundary-ok")).toBeVisible();
  });

  test("progress exposes determinate, zero, full and unknown values without fake completion", async ({
    page,
  }) => {
    await open(page);
    const bar = (name: string) =>
      page.getByTestId("progress-list").getByRole("progressbar", { name });
    const unknown = bar("Unknown duration");
    await expect(unknown).not.toHaveAttribute("aria-valuenow", /.*/);
    await expect(unknown).toHaveAttribute("aria-busy", "true");
    await expect(bar("Not started")).toHaveAttribute("aria-valuenow", "0");
    await expect(bar("Not started")).toHaveAttribute("aria-valuetext", "0%");
    await expect(bar("Almost there")).toHaveAttribute("aria-valuetext", "99%");
    await expect(bar("Almost there").locator("svg")).toHaveCount(0);
    await expect(bar("Finished")).toHaveAttribute("aria-valuenow", "100");
    await expect(bar("Finished").locator("svg")).toHaveCount(1);
    await expect(bar("Quota remaining")).toHaveAttribute("aria-valuetext", "18% remaining");
  });

  test("skeleton and unknown progress stop moving for reduced motion and decorative off", async ({
    page,
  }) => {
    const animationNames = () =>
      page.evaluate(() => {
        const name = (selector: string) =>
          getComputedStyle(document.querySelector(selector)!).animationName;
        return {
          line: name('[data-testid="skeleton-list"] [class*="_line_"]'),
          unknown: name('[data-testid="progress-list"] [class*="unknown"]'),
        };
      });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page);
    const moving = await animationNames();
    expect(moving.line).not.toBe("none");
    expect(moving.unknown).not.toBe("none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await animationNames()).toEqual({ line: "none", unknown: "none" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page, "?motion=off");
    expect(await animationNames()).toEqual({ line: "none", unknown: "none" });
    // The placeholder is a labelled busy status, then real content replaces it.
    const skeleton = page.getByRole("status", { name: "Loading records" });
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: "Toggle loading" }).click();
    await expect(page.getByTestId("skeleton-content")).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });

  test("ordinary danger notices expire after ten focused seconds", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
    await open(page);
    await expect(page.locator('[data-frame="notice-danger"]').getByRole("alert")).toContainText(
      "The release feed returned 503",
    );
    await page.clock.fastForward(9_999);
    expect(await counter(page, "dismiss-danger")).toBe(0);
    await page.clock.fastForward(1);
    expect(await counter(page, "dismiss-danger")).toBe(1);
  });

  test("explicitly persistent danger notices announce assertively and keep a pending retry single", async ({
    page,
  }) => {
    await page.clock.install();
    await open(page, "?persistent-notice");
    const notice = page.locator('[data-frame="notice-danger"]').getByRole("alert");
    await expect(notice).toContainText("The release feed returned 503");
    await page.clock.fastForward(120_000);
    expect(await counter(page, "dismiss-danger")).toBe(0);
    await expect(notice).toBeVisible();
    const retry = notice.getByRole("button", { name: "Retry" });
    await retry.click();
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await retry.click({ force: true });
    expect(await counter(page, "notice-retry")).toBe(1);
    await page.clock.fastForward(1000);
    await expect(retry).not.toHaveAttribute("aria-busy", "true");
    // The action sits under the message, not between title and message.
    const boxes = await Promise.all([
      notice.getByText("Update failed").boundingBox(),
      notice.getByText("The release feed returned 503").boundingBox(),
      retry.boundingBox(),
    ]);
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    await page.getByRole("button", { name: "Show file action error" }).click();
    const fileError = page.getByRole("alert").filter({ hasText: "Could not rename the file." });
    await page.clock.fastForward(60_000);
    await expect(fileError).toBeVisible();
  });

  test("empty states keep one adapter and change only density by context", async ({ page }) => {
    await open(page);
    const pad = (name: string) =>
      page
        .locator(`[data-frame="${name}"] [data-context]`)
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).paddingTop));
    const [pagePad, panelPad, listPad] = await Promise.all([
      pad("empty-page"),
      pad("empty-panel"),
      pad("empty-list"),
    ]);
    expect(panelPad).toBeLessThan(pagePad);
    expect(listPad).toBeLessThan(panelPad);
    await expect(page.locator('[data-frame="empty-panel-long"] section')).toHaveAttribute(
      "aria-label",
      "Unavailable",
    );
    await expect(page.locator('[data-frame="empty-page"] button')).toBeVisible();
    // Existing callers with no context keep the page presentation.
    await expect(
      page.locator('[data-frame="empty-consumer-document"] [data-context]'),
    ).toHaveAttribute("data-context", "page");
  });

  test("boot failure keeps the label and retry reachable by keyboard at narrow and short sizes", async ({
    page,
  }) => {
    for (const [width, height] of [
      [390, 700],
      [800, 360],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page, "?view=boot");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const title = page.getByRole("heading", { level: 1 });
      const retry = page.getByRole("button", { name: "Reload app" });
      for (const box of [await title.boundingBox(), await retry.boundingBox()]) {
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      }
      await page.keyboard.press("Tab");
      await expect(retry).toBeFocused();
      if (prefix !== undefined)
        await page.screenshot({ path: `${outDir}/${prefix}boot-focus-retry-${width}.png` });
      await page.keyboard.press("Tab");
      const toggle = page.getByRole("button", { name: /(Show|Hide) details/ });
      await expect(toggle).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("Error details")).toBeFocused();
      await page.keyboard.press("Tab");
      const copy = page.getByRole("button", { name: "Copy details" });
      await expect(copy).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
      expect(await page.evaluate(() => window.__clipboard.writes.length)).toBe(1);
    }
  });
});
