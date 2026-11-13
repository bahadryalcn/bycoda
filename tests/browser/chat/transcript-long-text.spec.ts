import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("text in the long text preview and window can be selected with the mouse and copied", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  await page.goto("/tests/browser/chat/transcript.html?longText");
  const trigger = page.getByRole("button", { name: "Show full long text" });
  await trigger.hover();
  const preview = page
    .locator("[data-hover-card]")
    .filter({ has: page.getByText("Long text preview", { exact: true }) });
  await expect(preview.getByRole("button", { name: "Copy message" })).toBeVisible();
  const selectExcerpt = async (selector: string) => {
    const pre = page.locator(selector);
    await expect(pre).toHaveCSS("user-select", "text");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Visibility alone can catch the preview/modal during its scale animation.
    // Hover waits for stable geometry before we measure real mouse coordinates.
    await pre.hover();
    const points = await pre.evaluate((element) => {
      const node = element.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, "Selectable excerpt".length);
      const rect = range.getBoundingClientRect();
      return {
        x: rect.x + 1,
        y: rect.y + rect.height / 2,
        // The excerpt is the entire first line. Land beyond its final glyph so
        // fractional coordinate rounding cannot omit the last character.
        end: rect.right + 2,
      };
    });
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.end, points.y, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("Selectable excerpt");
    if (browserName === "chromium") {
      await page.keyboard.press("Control+c");
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("Selectable excerpt");
    }
  };
  await selectExcerpt("[data-hover-card] pre.select-text");
  await page.getByRole("button", { name: "Show full content", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Copy message" })).toBeVisible();
  await selectExcerpt('[role="dialog"] pre');
  if (browserName === "chromium") {
    await dialog.getByRole("button", { name: "Copy message" }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n")),
      )
      .toBe("Selectable excerpt\n" + "Long content ".repeat(200).trimEnd());
  }
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    for (const zoom of [1, 2])
      test(`technical error disclosure ${theme} ${width} zoom ${zoom}`, async ({ page }) => {
        const captures = join(
          process.cwd(),
          "temp/verification/2026-11-13-ui-coherence/transcript-errors",
        );
        await mkdir(captures, { recursive: true });
        await writeFile(
          join(captures, "README.md"),
          "Production AgentTranscript and shared ErrorDetails rendered with synthetic HTTP/JSON, long international diagnostics and plain errors at the fixture data boundary. CSS zoom simulates 200% layout, not native browser zoom. No live provider or installed application acceptance.\n",
        );
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/tests/browser/chat/transcript.html?technical-errors");
        await page.evaluate(
          ({ theme, zoom }) => {
            document.documentElement.classList.toggle("dark", theme === "dark");
            document.documentElement.classList.toggle("theme-light", theme === "light");
            // Environment stress only. Production markup and component styles remain unchanged.
            document.documentElement.style.zoom = String(zoom);
          },
          { theme, zoom },
        );
        await expect(
          page.getByText("Workspace policy changed. Select a working copy before sending.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("Weekly usage limit reached. Choose another account.", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("API Error: HTTP 429", { exact: false })).toHaveCount(0);
        const trigger = page.getByRole("button", {
          name: "Technical details: Weekly usage limit reached. Choose another account.",
          exact: true,
        });
        await trigger.focus();
        await expect(trigger).toBeFocused();
        await trigger.press("Enter");
        const dialog = page.getByRole("dialog", {
          name: "Technical details: Weekly usage limit reached. Choose another account.",
          exact: true,
        });
        await expect(dialog).toBeVisible();
        const raw = await page.evaluate(
          () => (window as unknown as { fixtureTechnicalError: string }).fixtureTechnicalError,
        );
        await expect(dialog.getByLabel("Error details", { exact: true })).toHaveText(raw);
        await expect(
          dialog.getByRole("button", { name: "Copy details", exact: true }),
        ).toBeVisible();
        expect(
          await dialog.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.left >= -1 &&
              box.right <= innerWidth + 1 &&
              box.top >= -1 &&
              box.bottom <= innerHeight + 1
            );
          }),
        ).toBe(true);
        await page.screenshot({
          path: join(captures, `${theme}-${width}-zoom-${zoom}-details.png`),
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: join(captures, `${theme}-${width}-zoom-${zoom}-summary.png`),
          animations: "disabled",
        });
      });
