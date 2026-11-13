import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type Locator } from "@playwright/test";

// Real production controls, synthetic Host/provider ports. No native or provider acceptance.
const translations: Record<string, string> = JSON.parse(
  await readFile(new URL("../../../src/shared/i18n/locales/tr.json", import.meta.url), "utf8"),
);
const tr = (key: string) => translations[key] ?? key;
const output = "temp/verification/2026-11-04-assistant-settings-terra";

async function assertSettingsGeometry(dialog: Locator, region: Locator) {
  const problems = await region.evaluate((content) => {
    const issues: string[] = [];
    const bounds = content.getBoundingClientRect();
    for (const row of content.querySelectorAll<HTMLElement>(".settings-row")) {
      const rowBounds = row.getBoundingClientRect();
      if (!rowBounds.height) continue;
      const label = row.querySelector(":scope > .settings-row-label");
      const control = row.querySelector(":scope > .settings-row-control");
      const name = label?.textContent?.trim().slice(0, 65) ?? "row";
      if (rowBounds.left < bounds.left - 1 || rowBounds.right > bounds.right + 1)
        issues.push(`${name}: row exceeds scroll region`);
      if (rowBounds.left > bounds.left + 40) issues.push(`${name}: nested row indentation`);
      if (label && control) {
        const a = label.getBoundingClientRect();
        const b = control.getBoundingClientRect();
        if (/^(Idle after|Away after|Stall timeout)$/.test(name) && a.bottom <= b.top) {
          const trigger = control.querySelector("button")?.getBoundingClientRect();
          if (trigger && Math.abs(trigger.left - a.left) > 2)
            issues.push(`${name}: stacked preset is not aligned with its label`);
        }
        if (
          a.width &&
          b.width &&
          Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
          Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1
        )
          issues.push(`${name}: label overlaps control`);
      }
      for (const field of row.querySelectorAll<HTMLElement>(
        "input,textarea,button,[role='radiogroup'],.settings-row-control",
      )) {
        const box = field.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(field).opacity === "0") continue;
        if (
          box.left < rowBounds.left - 1 ||
          box.right > rowBounds.right + 1 ||
          box.top < rowBounds.top - 1 ||
          box.bottom > rowBounds.bottom + 1
        )
          issues.push(`${name}: ${field.getAttribute("aria-label") ?? field.tagName} exceeds row`);
      }
    }
    return issues;
  });
  expect(problems).toEqual([]);
  const lastControl = region
    .locator(
      "button:visible,input:not([type='checkbox']):visible,textarea:visible,[role='switch']:not(input):visible",
    )
    .last();
  await lastControl.scrollIntoViewIfNeeded();
  const box = (await lastControl.boundingBox())!;
  const footer = (await dialog
    .getByRole("button", { name: "Save profile settings", exact: true })
    .boundingBox())!;
  const regionBox = (await region.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(regionBox.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(regionBox.y + regionBox.height + 1);
  expect(box.y + box.height).toBeLessThan(footer.y);
  expect(
    await lastControl.evaluate((control) => {
      const box = control.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === control || (hit !== null && control.contains(hit));
    }),
  ).toBe(true);
}

for (const [theme, width] of [
  ["light", 1280],
  ["dark", 1280],
  ["light", 800],
  ["dark", 800],
  ["dark", 560],
] as const)
  test(`assistant settings compact row containment ${theme} ${width}`, async ({ page }) => {
    const directory = "temp/verification/assistant-settings-layout-20261113/after";
    await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      `/tests/browser/assistant/assistant-room.html?real-controls&desktop&manual&settings-layout&theme=${theme}`,
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog").first();
    for (const tab of ["Personal", "Work", "Access", "Advanced"]) {
      await dialog.getByRole("tab", { name: tab, exact: true }).click();
      const region = dialog
        .locator('[data-axis="y"]')
        .and(dialog.getByRole("region", { name: tab, exact: true }));
      const capture = async (state: string) => {
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        return page.screenshot({
          path: join(directory, `${theme}-${width}-${tab}-${state}.png`),
          animations: "disabled",
        });
      };
      await capture("top");
      if (tab === "Personal") {
        await dialog.getByRole("button", { name: "Avatar", exact: true }).click();
        const avatarField = await dialog
          .getByRole("textbox", { name: "Emoji or initials", exact: true })
          .boundingBox();
        const rowLabel = await region.locator(".settings-row-label").first().boundingBox();
        expect(avatarField).not.toBeNull();
        expect(rowLabel).not.toBeNull();
        expect(Math.abs(avatarField!.x - rowLabel!.x)).toBeLessThanOrEqual(1);
        await dialog
          .getByRole("button", { name: "Generate avatar", exact: true })
          .scrollIntoViewIfNeeded();
        await capture("avatar");
        await dialog
          .getByRole("button", { name: "Personality and conversation", exact: true })
          .click();
      } else if (tab === "Work") {
        await dialog.getByRole("button", { name: "Inactivity and recovery", exact: true }).click();
        await dialog.getByRole("button", { name: /^Notifications/ }).click();
      } else if (tab === "Access") {
        await dialog.getByRole("radio", { name: "Full access", exact: true }).click();
        await expect(
          dialog.getByRole("switch", { name: "Enable computer use", exact: true }),
        ).toHaveCount(0);
        await expect(
          dialog.getByRole("switch", { name: "Allow physical input", exact: true }),
        ).toHaveCount(0);
        await expect(
          dialog.getByRole("switch", { name: "Run commands without asking", exact: true }),
        ).toHaveCount(0);
        await capture("full-access");
        await dialog.getByRole("radio", { name: "Custom", exact: true }).click();
        await dialog
          .locator(".settings-row")
          .filter({ has: page.getByText("Assistant folders", { exact: true }) })
          .scrollIntoViewIfNeeded();
        await capture("folders");
        await expect(
          dialog.getByText(/International-Platform-Development/, { exact: false }).first(),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Custom helper", exact: true }).click();
        await dialog
          .getByRole("textbox", { name: "Helper file", exact: true })
          .fill(
            "C:\\Program Files\\International Platform Development\\Assistant Computer Use Helper\\agent-desktop.exe",
          );
        await dialog
          .getByRole("textbox", { name: "Helper file", exact: true })
          .scrollIntoViewIfNeeded();
        await capture("helper");
        await dialog.locator("summary").filter({ hasText: "All checks" }).click();
      } else {
        await dialog.getByRole("button", { name: "Supervisor limits", exact: true }).click();
        await dialog.getByRole("button", { name: "Worker context limits", exact: true }).click();
      }
      await assertSettingsGeometry(dialog, region);
      await capture("expanded-bottom");
    }
  });

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
        `/tests/browser/assistant/assistant-room.html?real-controls&desktop&manual&lang=tr&theme=${theme}`,
      );
      await page.getByRole("button", { name: tr("Settings"), exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      const tab = (name: string) =>
        dialog.getByRole("tab", {
          name: tr(
            (
              { Schedule: "Work", Projects: "Access", "Computer use": "Access" } as Record<
                string,
                string
              >
            )[name] ?? name,
          ),
          exact: true,
        });
      const group = (name: string) =>
        name === "Computer use"
          ? dialog
              .locator("section")
              .and(dialog.getByRole("region", { name: tr(name), exact: true }))
          : dialog
              .locator("section")
              .filter({
                has: page.getByRole("heading", {
                  name: tr(
                    (
                      {
                        Personality: "Conversation",
                        Conversation: "Conversation",
                        Jobs: "Work mode",
                      } as Record<string, string>
                    )[name] ?? name,
                  ),
                  exact: true,
                }),
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
      await expect(dialog.getByRole("tab")).toHaveCount(4);
      await dialog
        .getByRole("textbox", { name: tr("Assistant name"), exact: true })
        .fill("Settings fixture");
      await capture("personal");
      await sectionCapture("Identity", "identity");
      const conversation = dialog.getByRole("button", {
        name: tr("Personality and conversation"),
        exact: true,
      });
      await expect(conversation).toBeVisible();
      await conversation.click();
      await sectionCapture("Personality", "personality");
      await sectionCapture("Conversation", "conversation");

      const writesBefore = (await requests(page)).filter((r) =>
        /profile.update|manual.policy|configure|resume|prepare/.test(r.input.op),
      );
      // Shared tabs retain keyboard activation and focus while keeping drafts mounted.
      await tab("Personal").focus();
      await page.keyboard.press("ArrowRight");
      await expect(tab("Work")).toHaveAttribute("aria-selected", "true");
      await expect(
        dialog.getByRole("button", { name: tr("Manage in Models"), exact: true }),
      ).toBeVisible();
      await capture("work");

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
      await dialog.getByRole("radio", { name: tr("Custom"), exact: true }).click();
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
      await dialog.getByRole("button", { name: tr("Supervisor limits"), exact: true }).click();
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
      await expect(
        dialog.getByRole("button", { name: tr("Manage in Models"), exact: true }),
      ).toBeVisible();
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
      await expect(dialog.getByRole("button", { name: tr("Saved"), exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__setupProfile)).toMatchObject({
        name: "Settings fixture",
        activeStart: 22,
        activeEnd: 6,
        perWakeTokenCap: 9000,
        summaryRefreshMessages: 25,
      });
      // Models are managed globally; saving the assistant cannot rewrite their pool.
      expect((await requests(page)).filter((r) => r.input.op === "models.pool.set")).toHaveLength(
        0,
      );
      await tab("Personal").click();
      const unsavedAddress = dialog.getByRole("textbox", {
        name: tr("How should I address you?"),
        exact: true,
      });
      await unsavedAddress.fill("Retained unsaved address");
      await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
      await expect(dialog.getByText(tr("Discard unsaved changes?"), { exact: true })).toBeVisible();
      await capture("unsaved-close");
      const profileWritesBeforeKeepEditing = (await requests(page)).filter(
        (request) => request.input.op === "profile.update",
      );
      await dialog.getByRole("button", { name: tr("Keep editing"), exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: tr("Keep editing"), exact: true }),
      ).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(unsavedAddress).toHaveValue("Retained unsaved address");
      expect(
        (await requests(page)).filter((request) => request.input.op === "profile.update"),
      ).toEqual(profileWritesBeforeKeepEditing);
      await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
      const discard = dialog.getByRole("button", { name: tr("Discard"), exact: true });
      await expect(discard).toBeVisible();
      await discard.click();
      await expect(dialog).toHaveCount(0);
    });

// Production settings and shared Button; synthetic Host receipts, no installed-app acceptance.
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`assistant save feedback ${theme} ${width}`, async ({ page }) => {
      const captureOutput = "temp/verification/action-feedback";
      await mkdir(captureOutput, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?real-controls&desktop&manual&theme=${theme}`,
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog
        .getByRole("textbox", { name: "Assistant name", exact: true })
        .fill("Arif updated");
      await dialog.getByRole("tab", { name: "Work", exact: true }).click();
      await dialog.getByRole("button", { name: "Save profile settings", exact: true }).click();
      const saved = dialog.getByRole("button", { name: "Saved", exact: true });
      await expect(saved).toBeVisible();
      await expect(saved).toBeDisabled();
      await expect(saved).toHaveText("Saved");
      await expect(dialog.getByText("Profile settings saved.", { exact: true })).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Save profile settings", exact: true }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: join(captureOutput, `assistant-saved-${theme}-${width}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("tab", { name: "Personal", exact: true }).click();
      await dialog
        .getByRole("textbox", { name: "Assistant name", exact: true })
        .fill("Updated Arif");
      await expect(
        dialog.getByRole("button", { name: "Save profile settings", exact: true }),
      ).toBeEnabled();
      await expect(saved).toHaveCount(0);
    });

// Model pool editor captures (English copy; synthetic Host and usage-limits ports).
const poolOutput = "temp/verification/2026-11-10-voice-operator";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`assistant global model management link ${theme} ${width}`, async ({ page }) => {
      await mkdir(poolOutput, { recursive: true });
      await page.setViewportSize({ width, height: 1500 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?real-controls&desktop&manual&theme=${theme}`,
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.getByRole("tab", { name: "Work", exact: true }).click();
      const models = dialog
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Models", exact: true }) })
        .first();
      await expect(models.locator("fieldset")).toHaveCount(0);
      await page.evaluate(() => {
        window.addEventListener("bycoda:open-models-settings", (event) => {
          (window as any).__openedModelsTab = (event as CustomEvent).detail;
        });
      });
      await models.getByRole("button", { name: "Manage in Models", exact: true }).click();
      expect(await page.evaluate(() => (window as any).__openedModelsTab)).toBe("roles");
      await models.scrollIntoViewIfNeeded();
      await models.screenshot({
        path: join(poolOutput, `pool-${theme}-${width}.png`),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
