import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const captures = join(process.cwd(), "temp/verification/voice-visual-styles");
async function open(
  page: Page,
  visual = "mark",
  state = "listening",
  theme = "dark",
  width = 1280,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(
    `/tests/browser/voice-visual-styles.html?visual=${visual}&state=${state}&theme=${theme}`,
  );
  await page.getByRole("button", { name: "Voice companion", exact: true }).click();
  const panel = page.locator("section[data-voice-state]");
  if (state !== "off") {
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    await expect(panel).toHaveAttribute(
      "data-voice-state",
      state === "connecting" ? "connecting" : "listening",
    );
  }
  await page.evaluate((state) => {
    const cb = (window as any).fixtureVoice.callbacks;
    if (state === "user") cb.state("speaking");
    if (state === "thinking") cb.state("transcribing");
    if (state === "assistant") cb.playback(true);
    if (state === "error") cb.error("Local voice disconnected. Start voice again.");
  }, state);
  if (state === "muted")
    await panel.getByRole("button", { name: "Pause mic", exact: true }).click();
  await expect(panel).toHaveAttribute(
    "data-voice-state",
    state === "working" ? "listening" : state,
  );
  return panel;
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`visual/state matrix and picker: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      for (const visual of ["mark", "wave", "dots", "orb"]) {
        for (const state of [
          "off",
          "connecting",
          "listening",
          "user",
          "thinking",
          "assistant",
          "muted",
          "error",
          "working",
        ]) {
          const panel = await open(page, visual, state, theme, width);
          await expect(panel.locator(`[data-visual="${visual}"]`)).toBeVisible();
          expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          await panel.screenshot({
            path: join(captures, `${theme}-${width}-${visual}-${state}.png`),
            animations: "disabled",
          });
        }
        await panelCompact(page, visual, theme, width);
      }
      await page.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      const picker = page.getByRole("radiogroup", { name: "Visual style", exact: true });
      await picker.scrollIntoViewIfNeeded();
      await picker.getByRole("radio", { name: "Wave", exact: true }).click();
      await expect(
        page.locator("section[data-voice-state]").locator('[data-visual="wave"]'),
      ).toBeVisible();
      await picker.getByRole("radio", { name: "Wave", exact: true }).press("ArrowRight");
      await expect(picker.getByRole("radio", { name: "Dots", exact: true })).toBeFocused();
      await expect(picker.getByRole("radio", { name: "Dots", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect.poll(() => page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(1);
      await picker.screenshot({
        path: join(captures, `${theme}-${width}-picker.png`),
        animations: "disabled",
      });
    });
  }
async function panelCompact(page: Page, visual: string, theme: string, width: number) {
  const panel = await open(page, visual, "assistant", theme, width);
  await panel.getByRole("button", { name: "Compact voice companion" }).click();
  await expect(panel).toHaveAttribute("data-compact", "true");
  await expect(panel.getByRole("button", { name: "Expand voice companion" })).toBeFocused();
  await panel.screenshot({
    path: join(captures, `${theme}-${width}-${visual}-compact.png`),
    animations: "disabled",
  });
  expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(0);
}
test("keyboard move, drag, compact double click, viewport clamp, Escape and reduced motion", async ({
  page,
}) => {
  const panel = await open(page);
  const grip = panel.getByRole("button", {
    name: "Move voice window. Use arrow keys to reposition.",
  });
  const before = (await panel.boundingBox())!;
  await grip.press("ArrowLeft");
  expect((await panel.boundingBox())!.x).toBe(before.x - 16);
  await panel.getByRole("button", { name: "Compact voice companion" }).click();
  const pos = (await grip.boundingBox())!;
  await page.mouse.move(pos.x + 10, pos.y + 10);
  await page.mouse.down();
  await page.mouse.move(500, 100);
  await page.mouse.up();
  expect((await panel.boundingBox())!.y).toBeLessThan(150);
  await grip.dblclick();
  await expect(panel).not.toHaveAttribute("data-compact");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => {
      const b = (await panel.boundingBox())!;
      return b.x + b.width <= 800 && b.y + b.height <= 600;
    })
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(panel.locator("[data-visual]")).toHaveAttribute("data-animating", "false");
  await page.screenshot({
    path: join(captures, "reduced-motion-dark-800.png"),
    animations: "disabled",
  });
  await panel.press("Escape");
  await expect(page.getByRole("button", { name: "Voice companion", exact: true })).toBeFocused();
});
