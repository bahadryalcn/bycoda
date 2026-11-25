import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/presented-catalog");

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`every catalog example draws inside its column ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/voice/presented-catalog.html?theme=${theme}`);
      await expect(page.locator("[data-spec]").first()).toBeVisible();
      const overflowing = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-spec]")]
          .filter((section) => section.scrollWidth > section.clientWidth + 1)
          .map((section) => section.dataset.spec),
      );
      expect(overflowing).toEqual([]);
      expect(errors).toEqual([]);
      // Meters and the heatmap animate in; the captures show them settled.
      await page.waitForTimeout(1500);
      for (const name of [
        "form",
        "Timeline",
        "UsageMeter",
        "StepStrip",
        "ActivityHeatmap",
        "JsonViewer",
        "RowList",
        "Link",
      ])
        await page
          .locator(`[data-spec="${name}"]`)
          .screenshot({ path: join(captures, `${name}-${theme}-${width}.png`) });
    });
  }
}

test("the period, free text and list the owner chose reach the action", async ({ page }) => {
  await page.goto("/tests/browser/voice/presented-catalog.html?theme=light&only=form");
  const create = page.getByRole("button", { name: "Create report", exact: true });
  await expect(create).toBeDisabled();
  await page.getByRole("option", { name: /Review notes/ }).click();
  // Still waiting for the period.
  await expect(create).toBeDisabled();
  await page.getByRole("button", { name: /Days/ }).click();
  await page.getByRole("button", { name: /Last 7 days/i }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Branch" });
  await input.fill("feature/<x>");
  await input.press("Enter");
  await expect(create).toBeEnabled();
  await create.click();
  const press = await page.evaluate(
    () => (window as unknown as { presentedPresses: unknown[] }).presentedPresses[0],
  );
  expect(press).toMatchObject({
    action: "workspace.usage.open",
    input: {
      at: "2026-11-24T09:30",
      window: { start: "2026-11-24T00:00", end: "2026-11-25T00:00" },
      branch: "feature/<x>",
      session: "b",
      days: { start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), end: expect.any(String) },
    },
  });
});
