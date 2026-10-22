import { test, expect } from "@playwright/test";
for (const width of [390, 1000])
  test(`streamed output and completed actions preserve selection and scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/transcript.html?streaming");
    if (width === 390)
      await page.evaluate(() => document.documentElement.classList.add("theme-light"));
    const scroller = page.locator(".agent-transcript");
    await expect(scroller.getByText("Streaming response", { exact: true })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { appendFixtureStream: (text: string) => void }).appendFixtureStream(
        "\n\nstream-acceptance-marker " + "Content paragraph. ".repeat(30),
      ),
    );
    await expect(scroller.getByText(/stream-acceptance-marker/).first()).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
      .toBeLessThanOrEqual(2);
    await page.evaluate(() =>
      (window as unknown as { finishFixtureStream: () => void }).finishFixtureStream(),
    );
    const actions = scroller.getByRole("toolbar", { name: "Message actions", exact: true }).last();
    await expect(actions).toBeVisible();
    const save = actions.getByRole("button", { name: "Save as note", exact: true });
    await save.focus();
    await expect(save).toBeFocused();
    await save.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { savedFixtureNotes: string[] }).savedFixtureNotes.length,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { savedFixtureNotes: string[] }).savedFixtureNotes[0],
      ),
    ).toContain("stream-acceptance-marker");
    await expect(actions.getByRole("status")).toContainText("Saved to Notes");
    const copy = actions.getByRole("button", { name: "Copy response", exact: true });
    const icon = copy.locator("svg").first();
    const frame = await copy.boundingBox(),
      glyph = await icon.boundingBox();
    expect(frame).toBeTruthy();
    expect(glyph).toBeTruthy();
    expect(glyph!.width).toBeGreaterThanOrEqual(13);
    expect(glyph!.x).toBeGreaterThanOrEqual(frame!.x);
    expect(glyph!.x + glyph!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
    expect(glyph!.y).toBeGreaterThanOrEqual(frame!.y);
    expect(glyph!.y + glyph!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W6a-SESSIONS-captures/stream-${width}-${test.info().project.name}.png`,
    });
  });
