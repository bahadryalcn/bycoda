import { expect, test } from "@playwright/test";

test("finishing an anchored reply brings the latest turn back to the composer edge", async ({
  page,
}) => {
  await page.goto("/tests/browser/chat/transcript.html?streaming&anchor");
  const scroller = page.locator(".agent-transcript");
  const latest = scroller.locator("[data-transcript-turn='stream-user']");
  const bottomGap = () =>
    latest.evaluate((turn) =>
      Math.abs(
        turn.closest(".agent-transcript")!.getBoundingClientRect().bottom -
          turn.lastElementChild!.getBoundingClientRect().bottom,
      ),
    );

  await expect(latest).toHaveClass(/transcript-turn-anchor/);
  await expect.poll(bottomGap).toBeGreaterThan(100);
  await page.evaluate(() =>
    (window as unknown as { finishFixtureStream: () => void }).finishFixtureStream(),
  );
  await expect.poll(bottomGap).toBeLessThan(48);

  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(jump).toBeHidden();
  await scroller.hover();
  await page.mouse.wheel(0, -240);
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toBeHidden();
  await expect.poll(bottomGap).toBeLessThan(48);
});

test("scrolling settled history keeps the scroll range fixed", async ({ page }) => {
  await page.goto("/tests/browser/chat/transcript.html");
  const scroller = page.locator(".agent-transcript");
  await expect(scroller.locator(".transcript-turn")).toHaveCount(20, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(1);

  // Leaving the bottom reveals the Jump to latest pill, which reserves 4rem under the last row
  // (a one-time step at the end of the range). Settle that before sampling.
  await scroller.hover();
  await page.mouse.wheel(0, -160);
  await expect(page.locator("[data-jump-pill]")).toHaveCount(1);
  // Sample actual browser layout every frame. Checking only the final height
  // could miss a correction that settles before the gesture ends.
  const initial = await scroller.evaluate((el) => {
    const samples = [{ height: el.scrollHeight, top: el.scrollTop }];
    let frame = 0;
    const sample = () => {
      samples.push({ height: el.scrollHeight, top: el.scrollTop });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    Object.assign(window, {
      finishScrollSamples: () => {
        cancelAnimationFrame(frame);
        return samples;
      },
    });
    return samples[0];
  });
  expect(initial.top).toBeGreaterThan(3000);
  await scroller.hover();
  for (let tick = 0; tick < 40; tick++) {
    await page.mouse.wheel(0, -160);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  const samples = await page.evaluate(() =>
    (
      window as unknown as {
        finishScrollSamples: () => { height: number; top: number }[];
      }
    ).finishScrollSamples(),
  );
  const heights = samples.map((sample) => sample.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  expect(initial.top - samples[samples.length - 1].top).toBeGreaterThan(3000);
  const upwardGestureReversals = samples
    .slice(1)
    .filter((sample, index) => sample.top > samples[index].top + 1);
  expect(upwardGestureReversals).toEqual([]);
});

test("revisiting a parked transcript returns to the latest turn", async ({ page }) => {
  await page.goto("/tests/browser/chat/transcript.html");
  const scroller = page.locator(".agent-transcript");
  const distanceFromBottom = () =>
    scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect(scroller.locator(".transcript-turn")).toHaveCount(20, { timeout: 30_000 });
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);

  await page.evaluate(() => (window as unknown as { parkTranscript: () => void }).parkTranscript());
  await expect(scroller).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { showTranscript: () => void }).showTranscript());

  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await page.waitForTimeout(300);
  expect(await distanceFromBottom()).toBeLessThanOrEqual(1);
});

test("revisiting a parked transcript keeps the reader's place in history", async ({ page }) => {
  await page.goto("/tests/browser/chat/transcript.html");
  const scroller = page.locator(".agent-transcript");
  const distanceFromBottom = () =>
    scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect(scroller.locator(".transcript-turn")).toHaveCount(20, { timeout: 30_000 });
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await scroller.hover();
  for (let tick = 0; tick < 12; tick++) await page.mouse.wheel(0, -160);
  await expect.poll(distanceFromBottom).toBeGreaterThan(1000);
  await page.waitForTimeout(300);
  const reading = await distanceFromBottom();

  await page.evaluate(() => (window as unknown as { parkTranscript: () => void }).parkTranscript());
  await expect(scroller).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { showTranscript: () => void }).showTranscript());

  // Revealing replays the follow effects; none of them may treat it as a new prompt.
  await expect(scroller).toHaveCount(1);
  expect(Math.abs((await distanceFromBottom()) - reading)).toBeLessThanOrEqual(2);
  await page.waitForTimeout(500);
  expect(Math.abs((await distanceFromBottom()) - reading)).toBeLessThanOrEqual(2);
});
