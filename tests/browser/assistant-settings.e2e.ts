import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Real production controls, synthetic Host/provider ports. No native or provider acceptance.
const translations: Record<string, string> = JSON.parse(
  await readFile(new URL("../../src/shared/i18n/locales/tr.json", import.meta.url), "utf8"),
);
const tr = (key: string) => translations[key] ?? key;
const output = "temp/verification/2026-11-04-assistant-settings-terra";

async function requests(page: Page) {
  return page.evaluate(() => (window as any).__setupRequests ?? []) as Promise<
    Array<{ method: string; input: { op: string; [key: string]: unknown } }>
  >;
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(`^${tr(label)}:`) }).click();
  await page.getByRole("option", { name: tr(value), exact: true }).click();
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`assistant settings reachable sections and retained drafts ${theme} ${width}`, async ({
      page,
    }) => {
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant-room.html?real-controls&desktop&manual&lang=tr&theme=${theme}`,
      );
      await page.getByRole("button", { name: tr("Settings"), exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      const tab = (name: string) => dialog.getByRole("tab", { name: tr(name), exact: true });
      const group = (name: string) =>
        name === "Computer use"
          ? dialog
              .locator("section")
              .and(dialog.getByRole("region", { name: tr(name), exact: true }))
          : dialog
              .locator("section")
              .filter({
                has: page.getByRole("heading", { name: tr(name), exact: true }),
              })
              .first();
      const capture = async (name: string) => {
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(901);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        // The discard confirmation replaces the footer's Save with Keep editing and Discard.
        await expect(
          dialog.getByRole("button", {
            name: tr(name === "unsaved-close" ? "Keep editing" : "Save profile settings"),
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: join(output, `${theme}-${width}-${name}.png`),
          animations: "disabled",
        });
      };
      const sectionCapture = async (name: string, slug: string) => {
        const section = group(name);
        await expect(section).toBeVisible();
        await section.screenshot({
          path: join(output, `${theme}-${width}-${slug}.png`),
          animations: "disabled",
        });
      };
      await expect(dialog.getByRole("tab")).toHaveCount(6);
      await dialog
        .getByRole("textbox", { name: tr("Assistant name"), exact: true })
        .fill("Settings fixture");
      await capture("personal");
      await sectionCapture("Identity", "identity");
      await sectionCapture("Personality", "personality");
      await sectionCapture("Conversation", "conversation");

      const writesBefore = (await requests(page)).filter((r) =>
        /profile.update|manual.policy|configure|resume|prepare/.test(r.input.op),
      );
      // Shared tabs retain keyboard activation and focus while keeping drafts mounted.
      await tab("Personal").focus();
      await page.keyboard.press("ArrowRight");
      await expect(tab("Work")).toHaveAttribute("aria-selected", "true");
      const worker = dialog.locator("[data-settings-page=work] fieldset").first();
      await expect(worker).toContainText("Fixture worker");
      await worker.getByRole("button").first().click();
      // Reasoning is an inline radio row in the model panel's settings column.
      await page
        .getByRole("dialog", { name: tr("Model and settings"), exact: true })
        .getByRole("radio", { name: tr("High"), exact: true })
        .click();
      await page.keyboard.press("Escape");
      const workerBefore = await worker.innerText();
      await capture("work");
      await sectionCapture("Jobs", "autonomy");

      await tab("Schedule").click();
      const workHours = dialog.getByRole("switch", { name: tr("Work hours"), exact: true });
      if (!(await workHours.isChecked())) await workHours.click();
      await choose(page, "Work hours start", "22:00");
      await choose(page, "Work hours end", "06:00");
      await capture("schedule");
      await sectionCapture("Presence and hours", "presence");

      await tab("Projects").click();
      await capture("projects");
      const projectPicker = dialog.getByRole("button", {
        name: new RegExp(`^${tr("Selected projects")}:`),
      });
      await expect(projectPicker).toBeEnabled();
      await projectPicker.click();
      await expect(page.getByRole("option", { name: /Upstream/ })).toContainText("/fixture");
      await page.screenshot({
        path: join(output, `${theme}-${width}-project-picker.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await sectionCapture("Manual session supervision", "manual-supervision");

      await tab("Computer use").click();
      const helperPath = dialog.getByRole("textbox", {
        name: tr("Helper file"),
        exact: true,
      });
      await expect(helperPath).toBeHidden();
      await expect(
        dialog.getByRole("switch", { name: tr("Enable computer use"), exact: true }),
      ).not.toBeChecked();
      await expect(
        dialog.getByRole("switch", { name: tr("Allow physical input"), exact: true }),
      ).not.toBeChecked();
      // Emergency stop is offered only while computer use is on.
      await expect(
        dialog.getByRole("button", { name: tr("Stop computer use"), exact: true }),
      ).toHaveCount(0);
      await capture("computer");
      await dialog.getByRole("button", { name: tr("Custom helper"), exact: true }).click();
      await expect(helperPath).toBeVisible();
      await helperPath.scrollIntoViewIfNeeded();
      await capture("computer-helper-expanded");
      await sectionCapture("Computer use", "computer-all");

      await tab("Advanced").click();
      await dialog
        .getByRole("spinbutton", { name: tr("Review reservation"), exact: true })
        .fill("9000");
      await dialog
        .getByRole("spinbutton", {
          name: tr("Summary every"),
          exact: true,
        })
        .fill("25");
      await capture("advanced");
      await sectionCapture("Cost and context", "cost");
      await sectionCapture("Retention and usage", "retention");

      await tab("Work").click();
      await expect.poll(() => worker.innerText()).toBe(workerBefore);
      await tab("Personal").click();
      await expect(
        dialog.getByRole("textbox", { name: tr("Assistant name"), exact: true }),
      ).toHaveValue("Settings fixture");
      expect(
        (await requests(page)).filter((r) =>
          /profile.update|manual.policy|configure|resume|prepare/.test(r.input.op),
        ),
      ).toEqual(writesBefore);
      await tab("Advanced").click();
      const reservation = dialog.getByRole("spinbutton", {
        name: tr("Review reservation"),
        exact: true,
      });
      await reservation.fill("1");
      await tab("Personal").click();
      await dialog.getByRole("button", { name: tr("Save profile settings"), exact: true }).click();
      await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true");
      await expect(reservation).toBeVisible();
      expect((await requests(page)).filter((r) => r.input.op === "profile.update")).toHaveLength(0);
      await reservation.fill("9000");
      await dialog.getByRole("button", { name: tr("Save profile settings"), exact: true }).click();
      await expect(dialog.getByText(tr("Saved"), { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__setupProfile)).toMatchObject({
        name: "Settings fixture",
        activeStart: 22,
        activeEnd: 6,
        perWakeTokenCap: 9000,
        summaryRefreshMessages: 25,
      });
      // The footer Save also applies the model list draft, with its own version.
      const poolSave = (await requests(page)).find((r) => r.input.op === "models.pool.set");
      expect(poolSave?.input.expectedVersion).toBe(0);
      expect((poolSave?.input.rows as any[])[0].modelSettings.reasoningEffort).toBe("high");
      await tab("Personal").click();
      const unsavedAddress = dialog.getByRole("textbox", {
        name: tr("How should I address you?"),
        exact: true,
      });
      await unsavedAddress.fill("Retained unsaved address");
      await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
      await expect(dialog.getByText(tr("Discard unsaved changes?"), { exact: true })).toBeVisible();
      await capture("unsaved-close");
      await dialog.getByRole("button", { name: tr("Keep editing"), exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(unsavedAddress).toHaveValue("Retained unsaved address");
      await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
      await dialog.getByRole("button", { name: tr("Discard"), exact: true }).click();
      await expect(dialog).toHaveCount(0);
    });

// Model pool editor captures (English copy; synthetic Host and usage-limits ports).
const poolOutput = "temp/verification/2026-11-10-voice-operator";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`assistant model pool editor ${theme} ${width}`, async ({ page }) => {
      await mkdir(poolOutput, { recursive: true });
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(
        `/tests/browser/assistant-room.html?real-controls&desktop&manual&theme=${theme}`,
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.getByRole("tab", { name: "Work", exact: true }).click();
      const models = dialog
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Models", exact: true }) })
        .first();
      await expect(models.locator("fieldset")).toHaveCount(3);
      await expect(models).toContainText("Limit unknown");
      await expect(models).toContainText("48% left");
      await expect(models).toContainText("12% left");
      await models.scrollIntoViewIfNeeded();
      await models.screenshot({
        path: join(poolOutput, `pool-${theme}-${width}.png`),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
