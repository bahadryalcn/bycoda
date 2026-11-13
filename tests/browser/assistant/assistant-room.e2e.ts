import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function openRoomSection(page: Page, section: string) {
  const group = ["Jobs", "Sessions"].includes(section)
    ? "Work"
    : ["Notes", "History", "Memory"].includes(section)
      ? "Records"
      : section;
  await page.getByRole("tab", { name: new RegExp(`^${group}(?:\\s|$)`) }).click();
  if (group !== section) await page.getByRole("tab", { name: section, exact: true }).click();
}

async function openWrittenBrief(page: Page) {
  await openRoomSection(page, "Jobs");
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "Use a written brief" }) })
    .first();
  if (!(await disclosure.getAttribute("open"))) {
    if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open)))
      await disclosure.locator("summary").click();
  }
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`rich Room chat preserves voice and drafts ${theme} ${width}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&chat-redesign`);
      await page.getByRole("tab", { name: "Conversations", exact: true }).click();
      const answer = page
        .locator('article[data-author="assistant"]')
        .filter({ hasText: "Recovery status" });
      await expect(answer.getByRole("heading", { name: "Recovery status" })).toBeVisible();
      await expect(answer.getByRole("table")).toContainText("Draft recovery");
      await expect
        .poll(() =>
          answer
            .locator("ul")
            .first()
            .evaluate((list) => getComputedStyle(list).listStyleType),
        )
        .toBe("disc");
      await expect(answer.locator("pre")).toContainText("restoreDraft(threadId)");
      await expect(answer.getByRole("link", { name: "Review the guide" })).toBeVisible();
      await expect(answer.getByText("Voice", { exact: true })).toBeVisible();
      await answer.getByRole("button", { name: "Copy response", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain("## Recovery status");
      await answer.getByText("Recorded actions", { exact: true }).click();
      await expect(answer).toContainText("files.read");
      const input = page.getByRole("textbox", { name: /^Message / });
      await input.fill("Keep this draft");
      await input.press("Shift+Enter");
      await input.pressSequentially("second line");
      const threads = page.getByRole("complementary", { name: "Conversations" });
      await threads.getByRole("button", { name: /^Upstream/ }).click();
      await expect(input).toHaveValue("");
      await threads.getByRole("button", { name: /^Global/ }).click();
      await expect(input).toHaveValue("Keep this draft\nsecond line");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const output = join(
        process.cwd(),
        "temp/verification/assistant-redesign-20261113/conversations",
      );
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: join(output, `${theme}-${width}-rich-chat.png`),
        animations: "disabled",
      });
      await answer.getByRole("button", { name: "Delete message", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Delete message?");
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(answer).toBeVisible();
    });
  }

const setupTitles = [
  "Identity",
  "Language",
  "Voice provider",
  "Voice",
  "Microphone test",
  "Conversation behavior",
  "Work mode",
  "Presence and hours",
  "First rules",
  "Review",
];
test("an untouched discovered worker becomes explicit only after choosing a work mode", async ({
  page,
}) => {
  await page.goto("/tests/browser/assistant/assistant-room.html?real-controls&setup=core&fresh");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Identity");
  expect((await setupDraft(page)).patch.execution).toBeNull();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("Work mode");
  expect((await setupDraft(page)).patch.execution).toBeNull();
  const workAndAsk = dialog.getByRole("radio", { name: /^Work and ask/ });
  await expect(workAndAsk).toBeVisible();
  await workAndAsk.click();
  expect((await setupDraft(page)).patch.execution).toMatchObject({
    harness: "codex",
    model: "codex:fixture-worker",
    modelSettings: { reasoningEffort: "low" },
  });
  expect(await page.evaluate(() => (window as any).__setupModelSelections ?? 0)).toBe(0);
  expect(
    await page.evaluate(() =>
      (window as any).__setupRequests.filter(
        (request: any) => request.input.op === "profile.update",
      ),
    ),
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toHaveAccessibleName("Review");
  await expect(dialog).toContainText("Fixture worker");
  await dialog.getByRole("button", { name: "Start", exact: true }).click();
  await finishSetup(page);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__setupProfile.execution)).toMatchObject({
    harness: "codex",
    model: "codex:fixture-worker",
    modelSettings: { reasoningEffort: "low" },
  });
});
async function setupDraft(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.assistant.setup-draft")!));
}
async function finishSetup(page: Page) {
  const ready = page.getByRole("dialog", { name: "Ready for 24/7", exact: true });
  await expect(ready).toBeVisible();
  await ready.getByRole("button", { name: "Done", exact: true }).click();
}
async function chooseSetupValue(page: Page, label: string, option: string) {
  const field = page
    .getByRole("button", { name: new RegExp(`^${label}:`) })
    .and(
      page.locator(
        '[aria-haspopup="listbox"], [aria-haspopup="dialog"]:not([aria-label$=": Help"])',
      ),
    );
  await expect(field).toBeVisible();
  await field.click();
  const choice = page.getByRole("option", { name: option, exact: true });
  await expect(choice).toBeVisible();
  await choice.click();
}

async function expectModelsNavigation(page: Page, group: Locator) {
  // Room fixture has no workspace Settings owner. Observe the real navigation event;
  // models-settings owns destination UI and central pool editing coverage.
  await page.evaluate(() => {
    (window as any).__modelsNavigation = null;
    window.addEventListener(
      "bycoda:open-models-settings",
      (event) => {
        (window as any).__modelsNavigation = (event as CustomEvent).detail;
      },
      { once: true },
    );
  });
  await group.getByRole("button", { name: "Manage in Models", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__modelsNavigation)).toBe("roles");
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`compact setup journey ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/assistant-setup-compact-2026-11-03/captures";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&real-controls&setup`,
      );
      const frames: Array<{
        step: number;
        title: string;
        width: number;
        height: number;
        x: number;
        y: number;
      }> = [];
      const dialog = page.getByRole("dialog");
      const capture = async (index: number) => {
        await expect(dialog).toHaveAccessibleName(setupTitles[index]);
        await expect(dialog.getByRole("progressbar")).toHaveAccessibleName(
          `Step ${index + 1} of 10`,
        );
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(901);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(
          dialog.getByRole("button", { name: index === 9 ? "Start" : "Next", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          animations: "disabled",
          path: join(output, `setup-${theme}-${width}-${String(index + 1).padStart(2, "0")}.png`),
        });
        frames.push({
          step: index + 1,
          title: setupTitles[index],
          width: box.width,
          height: box.height,
          x: box.x,
          y: box.y,
        });
      };
      const next = async () => {
        const button = dialog.getByRole("button", { name: "Next", exact: true });
        await expect(button).toBeEnabled();
        await button.focus();
        await button.press("Enter");
      };
      await dialog
        .getByRole("textbox", { name: "Assistant name", exact: true })
        .fill("Setup fixture");
      await capture(0);
      await next();
      await chooseSetupValue(page, "Language", "English");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "Reopen setup", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveAccessibleName("Language");
      await page.reload();
      await expect(dialog).toHaveAccessibleName("Language");
      expect((await setupDraft(page)).patch.name).toBe("Setup fixture");
      await expect(
        dialog.getByRole("button", { name: "Language: English", exact: true }),
      ).toBeVisible();
      await capture(1);
      await next();
      await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      expect(await page.evaluate(() => (window as any).setupVoice.microphoneStarts)).toBe(0);
      await dialog.getByRole("radio", { name: "On this computer", exact: true }).click();
      await dialog.getByRole("button", { name: "Check connection", exact: true }).click();
      await expect(dialog.getByRole("status").filter({ hasText: "Ready" })).toBeVisible();
      await capture(2);
      await next();
      await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Listen", exact: true }).click();
      await expect(dialog.getByRole("status").filter({ hasText: "Ready" })).toBeVisible();
      await dialog.getByRole("button", { name: "Stop", exact: true }).click();
      await capture(3);
      await next();
      await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).setupVoice.microphoneStarts))
        .toBe(1);
      await expect(
        dialog.getByRole("meter", { name: "Microphone level", exact: true }),
      ).toHaveAttribute("value", "0.35");
      await page.evaluate(() => (window as any).setupVoice.transcript());
      await expect(
        dialog.getByRole("status").filter({ hasText: "This is a synthetic microphone sentence." }),
      ).toBeVisible();
      await capture(4);
      await next();
      await capture(5);
      await next();
      for (const name of ["Only watch", "Work freely", "Work and ask"]) {
        const mode = dialog.getByRole("radio", { name: new RegExp(`^${name}`) });
        await expect(mode).toBeVisible();
        await mode.click();
        await expect(mode).toBeChecked();
      }
      expect((await setupDraft(page)).patch).toMatchObject({
        autonomy: "chief",
        confirmJobs: true,
        planApproval: "large",
        allowRoutineQuestions: true,
        execution: {
          harness: "codex",
          model: "codex:fixture-worker",
          modelSettings: { reasoningEffort: "low" },
          runtimeMode: "supervised",
        },
      });
      expect(await page.evaluate(() => (window as any).__setupModelSelections ?? 0)).toBe(0);
      await capture(6);
      await next();
      // "Work hours" is on while a range is set; off means all day.
      const workHours = dialog.getByRole("switch", { name: "Work hours", exact: true });
      if (!(await workHours.isChecked())) await workHours.click();
      await chooseSetupValue(page, "Work hours start", "00:00");
      await chooseSetupValue(page, "Work hours end", "06:00");
      await chooseSetupValue(page, "Work hours start", "22:00");
      await workHours.click();
      await expect(dialog.getByRole("button", { name: /^Work hours start:/ })).toHaveCount(0);
      const allDayPatch = (await setupDraft(page)).patch;
      expect(allDayPatch.activeStart).toBe(allDayPatch.activeEnd);
      await workHours.click();
      await expect(
        dialog.getByRole("button", { name: "Work hours start: 22:00", exact: true }),
      ).toBeVisible();
      const quiet = dialog.getByRole("switch", { name: "Quiet hours", exact: true });
      if (await quiet.isChecked()) await quiet.click();
      const quietPatch = (await setupDraft(page)).patch;
      expect(quietPatch.quietStart).toBe(quietPatch.quietEnd);
      await quiet.click();
      await capture(7);
      await next();
      await dialog
        .getByRole("textbox", { name: "Anything I should know?", exact: true })
        .fill("Keep my drafts intact.");
      await capture(8);
      await next();
      await expect(dialog).toContainText("2,000,000");
      await capture(9);
      expect(
        await page.evaluate(() =>
          (window as any).__setupRequests.filter(
            (request: any) => request.input.op === "profile.update",
          ),
        ),
      ).toEqual([]);
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await finishSetup(page);
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__setupProfile)).toMatchObject({
        name: "Setup fixture",
        setupComplete: true,
        voiceSetupComplete: true,
        dailyTokenBudget: 2000000,
        execution: { model: "codex:fixture-worker", modelSettings: { reasoningEffort: "low" } },
        activeStart: 22,
        activeEnd: 6,
      });
      expect(await page.evaluate(() => (window as any).setupVoice)).toMatchObject({
        inspections: 1,
        previews: 1,
        microphoneStarts: 1,
        forbiddenMediaRequests: 0,
      });
      expect(
        await page.evaluate(
          () =>
            (window as any).__setupRequests.filter(
              (request: any) => request.input.op === "profile.update",
            ).length,
        ),
      ).toBe(1);
      await writeFile(
        join(output, `setup-${theme}-${width}-geometry.json`),
        JSON.stringify(frames, null, 2),
      );
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`compact profile controls preserve effort budget and hours ${theme} ${width}`, async ({
      page,
    }) => {
      const output = "temp/verification/assistant-setup-compact-2026-11-03/captures";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&real-controls`);
      const originalPool = await page.evaluate(() => (window as any).__readSetupModelPool());
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const showGroup = (label: string) => openSettingsGroup(page, label);
      const identity = await showGroup("Identity");
      await identity
        .getByRole("textbox", { name: "Assistant name", exact: true })
        .fill("Settings fixture");
      await identity
        .getByRole("textbox", { name: "How should I address you?", exact: true })
        .fill("Owner fixture");
      await identity.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-identity.png`),
      });
      const language = await showGroup("Language");
      await chooseSetupValue(page, "Language", "English");
      await language.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-language.png`),
      });
      const behavior = await showGroup("Conversation behavior");
      await chooseSetupValue(page, "Start a conversation", "Only when I return");
      await behavior.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-behavior.png`),
      });
      const models = await showGroup("Models");
      await expectModelsNavigation(page, models);
      expect(await page.evaluate(() => (window as any).__setupModelSelections ?? 0)).toBe(0);
      const autonomy = dialog.getByRole("region", { name: "Work", exact: true });
      for (const amount of ["100k", "500k", "1m", "5m"])
        await chooseSetupValue(page, "Daily token budget", `${amount} tokens/day`);
      await chooseSetupValue(page, "Daily token budget", "Custom");
      const customBudget = dialog.getByRole("spinbutton", {
        name: "Custom Daily token budget",
        exact: true,
      });
      await customBudget.fill("0");
      expect(
        await customBudget.evaluate((input) => (input as HTMLInputElement).validity.rangeUnderflow),
      ).toBe(true);
      await customBudget.fill("123456");
      await chooseSetupValue(page, "Daily token budget", "500k tokens/day");
      await autonomy.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-autonomy.png`),
      });
      const presence = await showGroup("Presence and hours");
      const workHours = presence.getByRole("switch", { name: "Work hours", exact: true });
      if (!(await workHours.isChecked())) await workHours.click();
      await chooseSetupValue(page, "Work hours start", "22:00");
      await chooseSetupValue(page, "Work hours end", "06:00");
      await presence.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-presence.png`),
      });
      const cost = await showGroup("Cost and context");
      await cost.getByRole("spinbutton", { name: "Review reservation", exact: true }).fill("9000");
      await cost.getByRole("spinbutton", { name: "Summary every", exact: true }).fill("25");
      await cost.screenshot({
        animations: "disabled",
        path: join(output, `settings-${theme}-${width}-cost.png`),
      });
      await saveProfileSettings(page);
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__setupProfile)).toMatchObject({
        name: "Settings fixture",
        addressAs: "Owner fixture",
        language: "en-US",
        proactiveSpeech: "return",
        dailyTokenBudget: 500000,
        activeStart: 22,
        activeEnd: 6,
        perWakeTokenCap: 9000,
        summaryRefreshMessages: 25,
      });
      expect(
        await page.evaluate(() =>
          (window as any).__setupRequests.filter(
            (request: any) => request.input.op === "models.pool.set",
          ),
        ),
      ).toEqual([]);
      expect(await page.evaluate(() => (window as any).__readSetupModelPool())).toEqual(
        originalPool,
      );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openSettingsGroup(page, "Models");
      const reopened = dialog.getByRole("region", { name: "Work", exact: true });
      await expect(
        reopened.getByRole("button", { name: "Daily token budget: 500k tokens/day", exact: true }),
      ).toBeVisible();
      const reopenedModels = await openSettingsGroup(page, "Models");
      await expectModelsNavigation(page, reopenedModels);
    });

const headings: Record<string, string> = {
  Language: "Conversation",
  "Conversation behavior": "Conversation",
  Jobs: "Customize access",
};
async function openSettingsGroup(page: Page, name: string) {
  const pages: Record<string, string> = {
    Identity: "Personal",
    Language: "Personal",
    "Conversation behavior": "Personal",
    Jobs: "Access",
    Models: "Work",
    "Presence and hours": "Work",
    "Cost and context": "Advanced",
    "Manual session supervision": "Access",
    "Computer use": "Access",
    "Retention and usage": "Advanced",
  };
  const tab = page.getByRole("dialog").getByRole("tab", { name: pages[name], exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  const disclosureName =
    name === "Conversation behavior"
      ? "Personality and conversation"
      : name === "Cost and context"
        ? "Supervisor limits"
        : name === "Jobs" || name === "Computer use"
          ? "Customize access"
          : undefined;
  if (disclosureName) {
    if (disclosureName === "Customize access") {
      await page.getByRole("dialog").getByRole("radio", { name: "Custom", exact: true }).click();
    } else {
      const disclosure = page
        .getByRole("dialog")
        .getByRole("button", { name: disclosureName, exact: true });
      await expect(disclosure).toBeVisible();
      if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
    }
  }
  if (name === "Computer use")
    return page
      .getByRole("dialog")
      .locator("section")
      .and(page.getByRole("region", { name, exact: true }))
      .first();
  // Settings pages are flat sections titled by a heading; the page tab shows them.
  return page
    .getByRole("dialog")
    .locator("section:visible")
    .filter({ has: page.getByRole("heading", { name: headings[name] ?? name, exact: true }) })
    .first();
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`quiet Room redesign preserves every section ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/assistant-room-redesign");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const capture = async (name: string) => {
        await expect(page.locator("body")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          animations: "disabled",
          path: join(output, `${theme}-${width}-${name}.png`),
        });
      };
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&redesign`);
      const room = page.getByRole("main");
      await expect(room.getByRole("heading", { name: "Arif", exact: true })).toBeVisible();
      await expect(
        room.getByText("Work tracking continues while voice is off.", { exact: true }),
      ).toHaveCount(0);
      await capture("today");
      await room.getByRole("button", { name: "Assistant status", exact: true }).click();
      await capture("health");
      await page.keyboard.press("Escape");
      await room.getByRole("button", { name: "Presence", exact: true }).click();
      await capture("presence");
      await page.keyboard.press("Escape");
      for (const tab of ["Conversations", "Jobs", "Sessions", "Notes", "History", "Memory"]) {
        await openRoomSection(page, tab);
        await capture(tab.toLowerCase());
      }
      await room.getByRole("button", { name: "Add memory", exact: true }).click();
      await capture("memory-editor");
      await page
        .getByRole("dialog", { name: "Add memory", exact: true })
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await openRoomSection(page, "Notes");
      await room.getByRole("button", { name: "New note", exact: true }).click();
      const note = page.getByRole("region", { name: "New note", exact: true });
      await note
        .getByRole("textbox", { name: "Note title", exact: true })
        .fill("Retained owner draft");
      await capture("note-editor");
      await note.getByRole("button", { name: "Close", exact: true }).click();
      await openRoomSection(page, "Jobs");
      await room.getByRole("button", { name: "Improve session recovery", exact: true }).click();
      await capture("job-detail");
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await openWrittenBrief(page);
      const draft = room.getByRole("textbox", { name: "Give Arif a job", exact: true });
      await draft.fill("Review the saved release draft");
      await room.getByRole("button", { name: "Review jobs", exact: true }).click();
      await capture("job-review");
      await page
        .getByRole("dialog", { name: "Review jobs", exact: true })
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await openRoomSection(page, "Notes");
      await openRoomSection(page, "Jobs");
      await openWrittenBrief(page);
      await expect(draft).toHaveValue("Review the saved release draft");
      await room.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Settings · Arif", exact: true });
      await capture("settings");
      for (const section of [
        "Jobs",
        "Presence and hours",
        "Cost and context",
        "Manual session supervision",
        "Computer use",
        "Retention and usage",
      ]) {
        const group = await openSettingsGroup(page, section);
        await group.scrollIntoViewIfNeeded();
        await capture(`settings-${section.toLowerCase().replace(/[^a-z]+/g, "-")}`);
      }
      await settings.getByRole("button", { name: "Close", exact: true }).click();
      await room.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      await capture("recently-deleted");
      await page
        .getByRole("dialog", { name: "Recently deleted", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.evaluate(() => localStorage.clear());
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&redesign-empty`);
      for (const tab of [
        "Today",
        "Conversations",
        "Jobs",
        "Sessions",
        "Notes",
        "History",
        "Memory",
      ]) {
        await openRoomSection(page, tab);
        await capture(`empty-${tab.toLowerCase()}`);
      }
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`conversation summary explicit recovery ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&summary-refresh=1`,
      );
      await page.getByRole("tab", { name: "Conversations", exact: true }).click();
      // The visible summary note is mirrored by a screen-reader-only live region.
      await expect(
        page.getByRole("paragraph").filter({ hasText: /^Updating conversation summary$/ }),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).__summaryRefreshRequests)).toBeUndefined();
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `summary-pending-menu-${theme}-${width}.png`),
      });
      await page
        .getByRole("menuitem", { name: "Refresh conversation summary", exact: true })
        .click();
      // A lost ACK keeps the visible header badge; shared Tooltip carries its reason.
      const unconfirmed = page.getByText("Summary unavailable", { exact: true }).first();
      await expect(unconfirmed).toBeVisible();
      await unconfirmed.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Summary refresh was not confirmed.");
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "Retry summary refresh", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `summary-lost-ack-menu-${theme}-${width}.png`),
      });
      await page.getByRole("menuitem", { name: "Retry summary refresh", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).__summaryRefreshRequests.length))
        .toBe(2);
      await expect(unconfirmed).toHaveCount(0);
      const replay = await page.evaluate(() => (window as any).__summaryRefreshRequests);
      expect(replay).toHaveLength(2);
      expect(replay[0]).toEqual(replay[1]);
      expect(await page.evaluate(() => (window as any).__summaryRefreshMutations)).toBe(1);
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Refresh conversation summary", exact: true })
        .click();
      // The header badge comes first; a screen-reader-only live region mirrors its text.
      await expect(page.getByText("Summary waiting", { exact: true }).first()).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `summary-blocked-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Refresh conversation summary", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => (window as any).__summaryRefreshMutations))
        .toBe(3);
      // A ready summary needs no status: the header drops both the waiting and updating notes.
      await expect(page.getByText("Summary waiting", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("paragraph").filter({ hasText: /^Updating conversation summary$/ }),
      ).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `summary-ready-${theme}-${width}.png`),
      });
      const all = await page.evaluate(() => (window as any).__summaryRefreshRequests);
      expect(all).toHaveLength(4);
      expect(new Set(all.map((item: any) => item.requestId)).size).toBe(3);
      await expect(
        page.getByText("Private fixture diagnostic must never appear", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Private fixture summary must never appear", { exact: true }),
      ).toHaveCount(0);
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`pending voice question presentation ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&question-presentation=1`,
      );
      const pending = page.getByRole("article").filter({
        hasText: "Saving this question is unconfirmed. Retry to verify the original card.",
      });
      await expect(pending).toBeVisible();
      expect(await page.evaluate(() => (window as any).__presentationRequest)).toBeUndefined();
      await pending.screenshot({
        animations: "disabled",
        path: join(output, `question-presentation-pending-${theme}-${width}.png`),
      });
      await pending.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(pending).toHaveCount(0);
      const recovered = page.getByRole("article", {
        name: "Retained planning choice",
        exact: true,
      });
      await expect(
        recovered.getByRole("radio", { name: /Preserve the existing scope/ }),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).__presentationRequest)).toMatchObject({
        requestId: "pending-voice-presentation",
        threadId: "thread-one",
        ownerMessageId: "pending-owner",
        causalContextId: "fixture-captured-context",
      });
      await recovered.screenshot({
        animations: "disabled",
        path: join(output, `question-presentation-recovered-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`saved assistant policy ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&policy=1`);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const presence = await openSettingsGroup(page, "Presence and hours");
      await expect(
        presence.getByRole("button", { name: "Work hours start: 22:00", exact: true }),
      ).toBeVisible();
      await expect(
        presence.getByRole("button", { name: "Work hours end: 06:00", exact: true }),
      ).toBeVisible();
      await presence.screenshot({
        animations: "disabled",
        path: join(output, `policy-presence-${theme}-${width}.png`),
      });
      const cost = await openSettingsGroup(page, "Cost and context");
      await expect(cost.getByRole("spinbutton", { name: "Follow-ups", exact: true })).toHaveValue(
        "0",
      );
      await cost.screenshot({
        animations: "disabled",
        path: join(output, `policy-cost-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`persistent owner question ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&owner-questions=1`,
      );
      const card = page.getByRole("article", { name: "Recovery scope", exact: true });
      await expect(card).toBeVisible();
      await page.locator('[aria-label="Questions waiting for you"]').screenshot({
        animations: "disabled",
        path: join(output, `owner-question-open-${theme}-${width}.png`),
      });
      await card.getByRole("radio", { name: /Small safe change/ }).check();
      await card.locator('button[type="submit"]').click();
      await expect(card).toHaveCount(0);
      const voice = page.getByRole("article", { name: "Saved voice choice", exact: true });
      await voice.getByRole("button", { name: "Later", exact: true }).click();
      await expect(voice.getByText(/Snoozed until/)).toBeVisible();
      await voice.screenshot({
        animations: "disabled",
        path: join(output, `owner-question-later-${theme}-${width}.png`),
      });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&owner-questions=1&question-lost=1`,
      );
      const pending = page.getByRole("article", { name: "Recovery scope", exact: true });
      await pending.getByRole("radio", { name: /Small safe change/ }).check();
      await pending.locator('button[type="submit"]').click();
      await expect(
        pending.getByText("The answer is unconfirmed. Your original choice is kept.", {
          exact: true,
        }),
      ).toBeVisible();
      await pending.screenshot({
        animations: "disabled",
        path: join(output, `owner-question-unknown-${theme}-${width}.png`),
      });
      await pending.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(pending).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__ownerQuestionMutations)).toBe(1);
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`job task deletion review ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&delete-bundle=1`,
      );
      await openRoomSection(page, "Jobs");
      await page.getByRole("button", { name: "Job actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete...", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Delete job?", exact: true });
      await expect(
        review.getByRole("checkbox", { name: "Also delete the reviewed tasks", exact: true }),
      ).not.toBeChecked();
      await expect(review).toContainText("Verify the provider handoff contract");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-default-${theme}-${width}.png`),
      });
      await review
        .getByRole("checkbox", { name: "Also delete the reviewed tasks", exact: true })
        .check();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-selected-${theme}-${width}.png`),
      });
      await review.getByRole("button", { name: "Delete job and tasks", exact: true }).click();
      await expect(review).toContainText("Original retirement is unknown");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-uncertain-${theme}-${width}.png`),
      });
      await review.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Keep job and tasks", exact: true }).click();
      await page.getByRole("button", { name: "Review tasks", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute(
        "data-reviewed-job-environment",
        "fixture-local-host",
      );
      await page.getByRole("button", { name: "Job actions", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Resume", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-kept-${theme}-${width}.png`),
      });
    });
    test(`job task deletion restore ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&delete-bundle=1&delete-success=1`,
      );
      await openRoomSection(page, "Jobs");
      await page.getByRole("button", { name: "Job actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete...", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Delete job?", exact: true });
      await review
        .getByRole("checkbox", { name: "Also delete the reviewed tasks", exact: true })
        .check();
      await review.getByRole("button", { name: "Delete job and tasks", exact: true }).click();
      await expect(review).toHaveCount(0);
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      const trash = page.getByRole("dialog", { name: "Recently deleted", exact: true });
      await expect(trash).toContainText("Includes 2 deleted tasks. Restoring keeps them stopped.");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-trash-${theme}-${width}.png`),
      });
      await trash.getByRole("button", { name: "Restore", exact: true }).last().click();
      await trash.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("button", { name: "Review tasks", exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-restored-${theme}-${width}.png`),
      });
    });
    test(`job task deletion Voice confirmation ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&voice-delete=1`);
      await expect(
        page.getByText(
          "2 tasks. Sessions, branches and working files remain. Project: Upstream, Backend",
          { exact: true },
        ),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `task-delete-voice-${theme}-${width}.png`),
      });
      await page.getByRole("radio", { name: "Delete job and tasks", exact: true }).check();
      await page.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute("data-deletion-decision", "confirm");
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`scheduled automation Room ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&quick-automation=1`,
      );
      page.setDefaultTimeout(15000);
      await openWrittenBrief(page);
      await page
        .getByRole("textbox", { name: "Give Arif a job", exact: true })
        .fill("Create a scheduled morning review");
      await page.getByRole("button", { name: "Review jobs", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Review jobs", exact: true });
      await review.getByRole("button", { name: "Job type: Project work", exact: true }).click();
      await page.getByRole("option", { name: "Create scheduled automation", exact: true }).click();
      await expect(
        review.getByRole("button", { name: "Create automations", exact: true }),
      ).toBeEnabled();
      // Model routing supplies the default; a manual picker selection is no longer required.
      await expect(
        review.getByRole("group", { name: "Execution model", exact: true }),
      ).toBeVisible();
      await review
        .getByRole("textbox", { name: "Automation prompt", exact: true })
        .fill(
          "Summarize the actual project changes and outstanding questions. Do not publish anything.",
        );
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-review-${theme}-${width}.png`),
      });
      await review
        .getByRole("spinbutton", { name: "Run time limit (minutes)", exact: true })
        .fill("45");
      await review.getByRole("spinbutton", { name: "Runs per day", exact: true }).fill("2");
      await review
        .getByText("This creates a scheduled automation. It does not run it now.", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-schedule-${theme}-${width}.png`),
      });
      await review.getByRole("button", { name: "Create automations", exact: true }).click();
      await expect(review.getByRole("alert")).toContainText("Automation receipt lost after commit");
      await expect(page.locator("body")).toHaveAttribute("data-automation-creates", "1");
      await review
        .getByRole("button", { name: "Check and retry", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-uncertain-${theme}-${width}.png`),
      });
      await review.getByRole("button", { name: "Check and retry", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(page.locator("body")).toHaveAttribute("data-automation-creates", "1");
      await openRoomSection(page, "Jobs");
      await page
        .getByRole("button", { name: "Create a scheduled morning review", exact: true })
        .click();
      const detail = page.getByRole("dialog", {
        name: "Create a scheduled morning review",
        exact: true,
      });
      await expect(detail).toContainText("Automation created");
      await expect(
        detail.getByRole("spinbutton", { name: "Run time limit (minutes)", exact: true }),
      ).toHaveValue("45");
      await detail.getByText("Automation created", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-details-${theme}-${width}.png`),
      });
      await detail.getByRole("button", { name: "Open automation", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute(
        "data-automation-environment",
        "fixture-local-host",
      );
      await expect(detail).toHaveCount(0);
    });
    test(`scheduled automation Voice review ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant-room";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&voice-jobs=1`);
      await page.getByRole("button", { name: "Job type: Project work", exact: true }).click();
      await page.getByRole("option", { name: "Create scheduled automation", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Create automations", exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole("group", { name: "Execution model", exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-voice-review-${theme}-${width}.png`),
      });
      await page
        .getByRole("switch", { name: "Enable this automation", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("switch", { name: "Enable this automation", exact: true }),
      ).not.toBeChecked();
      await expect(
        page.getByRole("group", { name: "Automation schedule", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-voice-schedule-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Create automations", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Job status is unknown");
      await expect(
        page.getByRole("textbox", { name: "Automation prompt", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Check and retry", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `automation-voice-uncertain-${theme}-${width}.png`),
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`utility output and worker context settings ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}`);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const cost = await openSettingsGroup(page, "Cost and context");
      await cost.scrollIntoViewIfNeeded();
      await cost.getByRole("button", { name: "About cost and context", exact: true }).click();
      await expect(page.getByText(/Claude utility requests include/)).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `output-context-help-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await cost.screenshot({
        animations: "disabled",
        path: join(output, `output-context-compact-${theme}-${width}.png`),
      });
      await cost.getByRole("button", { name: "Worker context limits", exact: true }).click();
      // Token and percentage limits share a label; the unit beside each field tells them apart,
      // and the token fields come first.
      const soft = cost.getByRole("spinbutton", { name: "Worker compact at", exact: true }).first();
      await expect(soft).toHaveValue("150000");
      await expect(
        cost.getByRole("spinbutton", { name: "Worker fresh session at", exact: true }).nth(1),
      ).toHaveValue("80");
      await soft.fill("160000");
      await soft.blur();
      await cost.screenshot({
        animations: "disabled",
        path: join(output, `output-context-advanced-${theme}-${width}.png`),
      });
      await saveProfileSettings(page);
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openSettingsGroup(page, "Cost and context");
      await dialog.getByRole("button", { name: "Worker context limits", exact: true }).click();
      await expect(
        dialog.getByRole("spinbutton", { name: "Worker compact at", exact: true }).first(),
      ).toHaveValue("160000");
      await expect(dialog.getByRole("spinbutton", { name: "Compact at", exact: true })).toHaveValue(
        "150000",
      );
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`multi-project voice review ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&voice-jobs=1`);
      await page.getByRole("button", { name: /^Participating projects/ }).click();
      const menu = page.getByRole("dialog", {
        name: "Participating projects options",
        exact: true,
      });
      await menu.getByRole("option", { name: /Backend/ }).click();
      await menu.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: /^Lead project/ }).click();
      await page.getByRole("option", { name: /Backend/ }).click();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `multi-voice-review-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Start jobs", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeDisabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `multi-voice-retry-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`multi-project job review ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&multi=1`);
      await openRoomSection(page, "Jobs");
      await openWrittenBrief(page);
      await page
        .getByRole("textbox", { name: "Give Arif a job", exact: true })
        .fill("Coordinate frontend and backend");
      await page.getByRole("button", { name: "Review jobs", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Review jobs", exact: true });
      await dialog.getByRole("button", { name: /^Participating projects/ }).click();
      const options = page.getByRole("dialog", {
        name: "Participating projects options",
        exact: true,
      });
      await options.getByRole("option", { name: /Backend/ }).click();
      await options.getByRole("button", { name: "Done", exact: true }).click();
      await dialog.getByRole("button", { name: /^Lead project/ }).click();
      await page.getByRole("option", { name: /Backend/ }).click();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `multi-job-review-${theme}-${width}.png`),
      });
      await dialog.getByRole("button", { name: "Start", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Connection interrupted after acceptance",
      );
      await expect(dialog.getByRole("textbox", { name: "Request 1", exact: true })).toBeDisabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `multi-job-retry-${theme}-${width}.png`),
      });
      await page
        .getByRole("button", { name: "Hide fixture project", exact: true, includeHidden: true })
        .evaluate((button) => (button as HTMLButtonElement).click());
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Give Arif a job", exact: true })).toHaveValue(
        "",
      );
      await expect(
        page.getByRole("textbox", { name: "Give Arif a job", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "Show fixture project", exact: true }).click();
      await expect(dialog.getByRole("textbox", { name: "Request 1", exact: true })).toHaveValue(
        "Coordinate frontend and backend",
      );
      await dialog.getByRole("button", { name: "Check and retry", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const created = page.getByRole("button", {
        name: "Coordinate frontend and backend",
        exact: true,
      });
      await expect(created).toHaveCount(1);
      await created.click();
      // Job details is a term/value list: the lead project is the value after its term.
      await expect(
        page
          .getByRole("dialog")
          .locator("dt", { hasText: /^Lead project$/ })
          .locator("+ dd"),
      ).toHaveText("Backend");
      await expect(page.getByRole("dialog")).toContainText("Backend · Upstream");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `multi-job-detail-${theme}-${width}.png`),
      });
      await page
        .getByRole("button", { name: "Hide fixture project", exact: true, includeHidden: true })
        .evaluate((button) => (button as HTMLButtonElement).click());
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(created).toHaveCount(0);
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`room live project privacy ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => console.error("Room fixture error:", error.message));
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&privacy=1`);
      await openRoomSection(page, "Jobs");
      await page
        .getByRole("checkbox", { name: "Select Secret project request", exact: true })
        .check();
      await page.getByRole("button", { name: "Secret project request", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Secret source request");
      // This fixture-only parent control simulates privacy changing outside the modal.
      await page
        .getByRole("button", { name: "Hide fixture project", exact: true, includeHidden: true })
        .evaluate((button) => (button as HTMLButtonElement).click());
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Secret");
      await expect(page.getByText("1 selected", { exact: true })).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `privacy-jobs-${theme}-${width}.png`),
      });
      await page.getByRole("tab", { name: "Conversations", exact: true }).click();
      const search = page.getByRole("searchbox", { name: "Search this section", exact: true });
      await search.fill("Secret");
      await expect(page.getByText("No results", { exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Secret transcript source");
      await expect(page.locator("body")).not.toContainText("Secret linked global source");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `privacy-conversations-${theme}-${width}.png`),
      });
      await search.fill("");
      await openRoomSection(page, "History");
      await expect(page.locator("body")).not.toContainText("Secret source activity");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `privacy-history-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("An earlier research request");
      await expect(page.getByRole("dialog")).not.toContainText("Secret deleted request");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `privacy-trash-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`manual session opt-in ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&manual=1`);
      await openRoomSection(page, "Sessions");
      const section = page.getByRole("region", { name: "Manual session supervision", exact: true });
      await expect(
        section.getByText("Execution changed. Enroll again to supervise this source.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(/Secret (conversation|project)/)).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `manual-sessions-${theme}-${width}.png`),
      });
      await section
        .getByRole("button", { name: "Enroll conversation", exact: true })
        .first()
        .click();
      await expect(
        section.getByRole("button", { name: "Turn off supervision", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `manual-enrolling-${theme}-${width}.png`),
      });
      await section.getByRole("button", { name: "Turn off supervision", exact: true }).click();
      await expect(
        section.getByText("Manual session supervision is off.", { exact: true }),
      ).toBeVisible();
      await section
        .getByRole("button", { name: "Choose projects in Settings", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const manual = await openSettingsGroup(page, "Manual session supervision");
      const supervise = manual.getByRole("switch", {
        name: "Supervise my conversations",
        exact: true,
      });
      await supervise.scrollIntoViewIfNeeded();
      await expect(supervise).not.toBeChecked();
      // Turning supervision off keeps the saved scope; the picker stays locked until it is on.
      await expect(
        manual.getByRole("button", { name: "Selected projects: Upstream", exact: true }),
      ).toBeDisabled();
      await expect(dialog.getByText("Secret project", { exact: true })).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `manual-settings-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`unknown briefing language ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&briefing=1&language-unknown=1`,
      );
      const card = page.getByRole("region", { name: "While you were away", exact: true });
      await expect(card.getByRole("button", { name: "Listen", exact: true })).toBeDisabled();
      await expect(
        card.getByText("Speak once or choose a language before listening.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `unknown-language-${theme}-${width}.png`),
      });
      await card.getByRole("button", { name: "Choose language", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await openSettingsGroup(page, "Language");
      await expect(page.getByRole("button", { name: "Language: Auto", exact: true })).toBeVisible();
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`briefing and retention ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&briefing=1&presence=unreadable`,
      );
      await expect(
        page.getByRole("status", { name: "Current availability: Away", exact: true }),
      ).toBeVisible();
      const card = page.getByRole("region", { name: "While you were away", exact: true });
      await card.getByRole("button", { name: "Listen", exact: true }).click();
      await expect(
        card.getByText("Reading the briefing. This does not open the microphone.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `briefing-playing-${theme}-${width}.png`),
      });
      await card.getByRole("button", { name: "Stop listening", exact: true }).click();
      await card.getByRole("button", { name: "Go to approvals", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute("data-opened-goal", "assistant-job-two");
      await card.getByRole("button", { name: "Open notes", exact: true }).click();
      await expect(page.locator("#assistant-content")).toHaveAttribute("aria-label", "Notes");
      await page.getByRole("tab", { name: /^Conversations/ }).click();
      const draft = page.getByRole("textbox", { name: "Message Arif", exact: true });
      await draft.fill("Keep this unsent draft");
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Clear conversation...", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Clear this conversation?", exact: true });
      await expect(confirm).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `clear-conversation-${theme}-${width}.png`),
      });
      await confirm.getByRole("button", { name: "Clear all messages", exact: true }).click();
      await expect(draft).toHaveValue("Keep this unsent draft");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openSettingsGroup(page, "Retention and usage");
      const retention = page.getByRole("button", {
        name: "Keep conversation messages: Forever",
        exact: true,
      });
      await retention.scrollIntoViewIfNeeded();
      await retention.click();
      await page.getByRole("option", { name: "30 days", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Keep conversation messages: 30 days", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `retention-${theme}-${width}.png`),
      });
      await saveProfileSettings(page);
      await expect(page.getByRole("dialog")).not.toBeVisible();
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`chief review recovery ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&chief-blocked=1`,
      );
      await expect(
        page.getByText("Supervisor review needs attention", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `chief-recovery-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Retry review", exact: true }).click();
      await expect(
        page.getByText("Supervisor review needs attention", { exact: true }),
      ).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop everything", exact: true }),
      ).toBeVisible();
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`emergency shortcut settings ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&keybindings=1`);
      const change = page.getByRole("button", {
        name: "Change App: Stop computer use shortcut",
        exact: true,
      });
      await change.scrollIntoViewIfNeeded();
      await expect(change).toContainText(/Esc/);
      await change.click();
      await page.keyboard.press("Escape");
      await expect(change).toContainText(/Esc/);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `emergency-shortcut-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`managed session filter ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&session-filter=1`,
      );
      await expect(page.getByText("Owner's manual conversation", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Filter sessions", exact: true }).click();
      const filter = page.getByRole("menuitemcheckbox", { name: "Managed by Arif", exact: true });
      await expect(filter).toHaveAttribute("aria-checked", "false");
      await filter.click();
      await expect(filter).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText("Owner's manual conversation", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Verify retained job output", { exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `managed-filter-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("menu", { name: "Filter sessions", exact: true }),
      ).not.toBeVisible();
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Chief retained context explanation ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}`);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openSettingsGroup(page, "Cost and context");
      await page.getByRole("button", { name: "About cost and context", exact: true }).click();
      const explanation = page.getByText(
        "These limits estimate retained text. Summaries, daily renewal, review reservations and a 1 MB safety limit can shorten it earlier. They do not guarantee the provider's context window or charges.",
        { exact: true },
      );
      await explanation.scrollIntoViewIfNeeded();
      await expect(explanation).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-chief-context.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`desktop emergency strip ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&desktop=1`);
      const strip = page.getByRole("complementary", { name: "Computer controls", exact: true });
      await expect(strip).toBeVisible();
      await expect(
        strip.getByRole("button", { name: "Stop computer use", exact: true }),
      ).toBeEnabled();
      await expect(strip).toContainText("Notepad · Set value");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `desktop-strip-${theme}-${width}.png`),
      });
      await strip.getByRole("button", { name: "Stop computer use", exact: true }).click();
      await expect(strip).not.toBeVisible();
    });

test("searches all conversations and saved memory through the Host adapter", async ({ page }) => {
  await page.goto("/tests/browser/assistant/assistant-room.html?theme=light");
  await page.getByRole("tab", { name: "Conversations", exact: true }).click();
  // Room opens the Global conversation; start from the project thread so the
  // search has to reach a message outside the open conversation.
  await page
    .getByRole("complementary", { name: "Conversations" })
    .getByRole("button", { name: /^Upstream/ })
    .click();
  await expect(
    page.getByText("Keep an eye on recovery and prepare the release notes.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search this section", exact: true }).fill("Nightly");
  await expect(page.getByText("Nightly follow-up across projects", { exact: true })).toBeVisible();
  await openRoomSection(page, "Memory");
  await page.getByRole("searchbox", { name: "Search this section", exact: true }).fill("concise");
  await expect(
    page.getByText("Prefer concise updates with source evidence.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Let me finish speaking before you reply.", { exact: true }),
  ).toHaveCount(0);
});

test("uses the chosen name and Turkish suffix in the rendered room", async ({ page }) => {
  const output = join(process.cwd(), "temp/verification/arif-assistant-room");
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/tests/browser/assistant/assistant-room.html?theme=light&lang=tr&name=Ay%C5%9Fe",
  );
  await expect(page.getByRole("heading", { name: "Ayşe", exact: true })).toBeVisible();
  await expect(page.getByRole("main", { name: "Ayşe'nin odası", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Asistan durumu", exact: true })).toHaveText(
    "Çalışıyor",
  );
  await page.screenshot({
    animations: "disabled",
    path: join(output, "tr-light-800-ayse.png"),
  });
});

// Synthetic Host adapter; verifies composition and owner controls only.
// No provider execution, real job, microphone or desktop authority is exercised.
for (const theme of ["light", "dark"] as const)
  for (const width of [1280, 800]) {
    test(`assistant Room ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}`);
      const room = page.getByRole("main");
      await expect(room.getByRole("heading", { name: "Arif", exact: true })).toBeVisible();
      for (const tab of [
        "Today",
        "Conversations",
        "Jobs",
        "Sessions",
        "Notes",
        "History",
        "Memory",
      ]) {
        await openRoomSection(page, tab);
        await expect(page.locator("#assistant-content")).toHaveAttribute("aria-label", tab);
        if (tab === "Sessions") {
          await expect(page.getByText("Context ready", { exact: true })).toBeVisible();
          await expect(
            page.getByText("Compaction required before the next message", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByText("Handoff required before the next message", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.getByText("Context usage unavailable", { exact: true })).toHaveCount(0);
        }
        expect(await room.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        await page.screenshot({
          animations: "disabled",
          path: join(output, `${theme}-${width}-${tab.toLowerCase()}.png`),
        });
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-settings.png`),
      });
      await openSettingsGroup(page, "Presence and hours");
      await page.getByText("Sleep prevention is off", { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText("Sleep prevention is off", { exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-keep-awake.png`),
      });
      await openSettingsGroup(page, "Computer use");
      await page
        .getByRole("switch", { name: "Enable computer use", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(page.getByText("Not installed", { exact: true })).toBeVisible();
      // The emergency stop appears only while computer use is on.
      await expect(
        page.getByRole("button", { name: "Stop computer use", exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-computer-settings.png`),
      });
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      await expect(page.getByText("An earlier research request", { exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-recently-deleted.png`),
      });
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await openRoomSection(page, "Jobs");
      await page.getByRole("button", { name: "Improve session recovery", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${theme}-${width}-job-details.png`),
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`note exact recovery ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&note-retry=1`);
      await openRoomSection(page, "Notes");
      await page.getByRole("button", { name: "New note", exact: true }).click();
      const dialog = page.getByRole("region", { name: "New note", exact: true });
      await dialog
        .getByRole("textbox", { name: "Note title", exact: true })
        .fill("Owner's retained note");
      await dialog.getByRole("tab", { name: "Source", exact: true }).click();
      const source = dialog.locator(".cm-content:visible");
      await source.fill("Keep this exact body when the native save reply is lost.");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("after note commit");
      await expect(source).toHaveAttribute("contenteditable", "false");
      const first = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("bycoda.assistant.note-draft:new:record")!),
      );
      expect(first.expectedUpdatedAt).toBe(0);
      expect(first.id).toBeTruthy();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `note-unknown-${theme}-${width}.png`),
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "New note", exact: true }).click();
      await dialog.getByRole("tab", { name: "Source", exact: true }).click();
      await expect(source).toHaveText(first.body);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `note-reopened-${theme}-${width}.png`),
      });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page
          .getByRole("list", { name: "Notes" })
          .getByText("Owner's retained note", { exact: true }),
      ).toHaveCount(1);
      expect(
        await page.evaluate(() => localStorage.getItem("bycoda.assistant.note-draft:new:record")),
      ).toBeNull();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `note-recovered-${theme}-${width}.png`),
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`assistant models link preserves central roles ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&real-controls`);
      const originalPool = await page.evaluate(() => (window as any).__readSetupModelPool());
      expect(
        originalPool.rows.map((row: any) => ({
          id: row.id,
          roles: row.roles,
          effort: row.modelSettings.reasoningEffort,
        })),
      ).toEqual([
        { id: "pool-a", roles: ["worker", "reply"], effort: "low" },
        { id: "pool-b", roles: ["worker", "planning"], effort: "high" },
        { id: "pool-c", roles: ["chief"], effort: "low" },
      ]);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const models = await openSettingsGroup(page, "Models");
      await expect(
        models.getByText("Models and limits follow Settings > Models.", { exact: true }),
      ).toBeVisible();
      await expectModelsNavigation(page, models);
      await models.screenshot({
        animations: "disabled",
        path: join(output, `roles-central-link-${theme}-${width}.png`),
      });
      await openSettingsGroup(page, "Identity");
      await dialog
        .getByRole("textbox", { name: "Assistant name", exact: true })
        .fill("Role retention fixture");
      await saveProfileSettings(page);
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__setupProfile.name)).toBe(
        "Role retention fixture",
      );
      expect(await page.evaluate(() => (window as any).__readSetupModelPool())).toEqual(
        originalPool,
      );
      expect(
        await page.evaluate(() =>
          (window as any).__setupRequests.filter(
            (request: any) => request.input.op === "models.pool.set",
          ),
        ),
      ).toEqual([]);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expectModelsNavigation(page, await openSettingsGroup(page, "Models"));
      expect(await page.evaluate(() => (window as any).__readSetupModelPool())).toEqual(
        originalPool,
      );
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`quick Voice review ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15000);
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&voice-jobs=1`);
      await page.getByRole("button", { name: /^Job type/ }).click();
      await page.getByRole("option", { name: "Save personal note", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Note title", exact: true })
        .fill("Personal notebook");
      await page
        .getByRole("textbox", { name: "Note content", exact: true })
        .fill('A note containing "stop everything" stays note content.');
      await page.screenshot({
        animations: "disabled",
        path: join(output, `quick-voice-review-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Save notes", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeDisabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `quick-voice-pending-${theme}-${width}.png`),
      });
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`note exact trash receipt ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant-room");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&note-trash=1`);
      await openRoomSection(page, "Notes");
      await page.getByRole("button", { name: "Delete note", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Delete note?", exact: true })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(page.locator("body")).toContainText("Temporary exact restore failure");
      expect(await page.locator("body").getAttribute("data-last-restore")).toBe(
        "notetrash:backup-note-one",
      );
      await page.screenshot({
        animations: "disabled",
        path: join(output, `note-trash-failure-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      const library = page.getByRole("dialog", { name: "Recently deleted", exact: true });
      await library
        .getByText("Today's progress", { exact: true })
        .locator("..")
        .locator("..")
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await expect(page.locator("body")).not.toContainText("Temporary exact restore failure");
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
      await library.getByRole("button", { name: "Close", exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Notes" }).getByText("Today's progress", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `note-trash-restored-${theme}-${width}.png`),
      });
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`room completion controls ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/arif-assistant/room-completion-fixture";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&completion=1`);
      await openRoomSection(page, "Jobs");
      await page.getByRole("button", { name: "Job actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Priority", exact: true }).click();
      await page.getByRole("button", { name: "Priority: Normal", exact: true }).click();
      await page.getByRole("option", { name: "High", exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `priority-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Job actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Replan", exact: true }).click();
      const replan = page.getByRole("dialog");
      await replan
        .getByRole("textbox", { name: "Replan feedback", exact: true })
        .fill("Keep the verified recovery path. Replan only the remaining checks.");
      await page.screenshot({
        animations: "disabled",
        path: join(output, `replan-draft-${theme}-${width}.png`),
      });
      await replan.getByRole("button", { name: "Replan", exact: true }).click();
      await expect(replan.getByRole("button", { name: "Check status", exact: true })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `replan-unknown-${theme}-${width}.png`),
      });
      await replan.getByRole("button", { name: "Close", exact: true }).last().click();
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      const filter = page.getByRole("dialog", { name: "Filter", exact: true });
      await filter.getByRole("button", { name: "Created: All dates", exact: true }).click();
      await page.getByRole("option", { name: "Today", exact: true }).click();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `job-filters-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await openRoomSection(page, "Notes");
      await page.getByRole("button", { name: "Summarize today", exact: true }).click();
      await expect(page.getByText(/Today's saved fixture summary:/)).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `daily-summary-${theme}-${width}.png`),
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await openSettingsGroup(page, "Retention and usage");
      await page.getByRole("group", { name: "Today's usage", exact: true }).screenshot({
        animations: "disabled",
        path: join(output, `worker-cache-${theme}-${width}.png`),
      });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&session-controls=pending`,
      );
      const control = page.getByRole("button", {
        name: "Take assistant off this session",
        exact: true,
      });
      await control.focus();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `session-controls-ready-${theme}-${width}.png`),
      });
      await page.keyboard.press("Enter");
      const detach = page.getByRole("dialog");
      await detach.getByRole("button", { name: "Remove supervision", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(detach.getByRole("button", { name: /Remove supervision/ })).toBeDisabled();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `session-detach-pending-${theme}-${width}.png`),
      });
      await page.evaluate(() => (window as any).__finishFixtureDetach());
      await expect(
        detach.getByText("Assistant supervision removed", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `session-detach-removed-${theme}-${width}.png`),
      });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&session-controls=unknown`,
      );
      await page
        .getByRole("button", { name: "Take assistant off this session", exact: true })
        .click();
      await page.getByRole("button", { name: "Remove supervision", exact: true }).click();
      await expect(
        page.getByText("Supervision removal is unconfirmed. Check its status before continuing.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: join(output, `session-detach-unknown-${theme}-${width}.png`),
      });
      expect(await page.evaluate(() => (window as any).__fixtureDetachCalls)).toBe(1);
      await page.getByRole("button", { name: "Check status", exact: true }).click();
      await expect(page.getByText("Assistant supervision removed", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__fixtureDetachCalls)).toBe(1);
    });

async function saveProfileSettings(page: Page) {
  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: "Save profile settings", exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect(dialog.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`assistant source visual states ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const output = "temp/verification/assistant-callers-visual";
      await mkdir(output, { recursive: true });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&real-controls&setup`,
      );
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({
        path: `${output}/${theme}-${width}-setup.png`,
        animations: "disabled",
      });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&global-room&slow-recovery&notification-recovery-fixture`,
      );
      await expect(page.getByText("History · fixture")).toBeVisible();
      await page.getByText("Task notification recovery", { exact: true }).click();
      await page.getByRole("button", { name: /^Project\b/ }).click();
      await page.getByRole("option", { name: "Fixture project", exact: true }).click();
      await page.getByRole("button", { name: "Check notifications", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Check notifications", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: `${output}/${theme}-${width}-recovery-loading.png`,
        animations: "disabled",
      });
      await expect(page.getByText("Outcome unknown")).toBeVisible();
      await page.screenshot({
        path: `${output}/${theme}-${width}-recovery.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`assistant activity states ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&job-state-fixture`,
      );
      await expect(page.getByText("Fixture activity unavailable")).toBeVisible();
      await expect(page.getByText("No notes mention this job yet.")).toBeVisible();
      await expect(page.getByText("Loading...", { exact: true })).toBeVisible();
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/${theme}-${width}-job-states.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`assistant recovery and folder errors ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mkdir("temp/verification/assistant-recovery-visual", { recursive: true });
      for (const [name, text] of [
        ["draft", "Fixture draft unavailable"],
        ["trash", "Recently deleted"],
        ["folders", "Fixture folders unavailable"],
      ]) {
        await page.goto(
          `/tests/browser/assistant/assistant-room.html?theme=${theme}&${name}-state-fixture`,
        );
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        await page.screenshot({
          path: `temp/verification/assistant-recovery-visual/${theme}-${width}-${name}.png`,
          animations: "disabled",
        });
      }
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`assistant remaining caller states ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mkdir("temp/verification/assistant-remaining-visual", { recursive: true });
      for (const [name, text] of [
        ["owner", "Choose the result"],
        ["remote", "Remote Room access"],
        ["supervision", "Fixture supervision unavailable"],
        ["usage", "Keep conversation messages"],
      ]) {
        await page.goto(
          `/tests/browser/assistant/assistant-room.html?theme=${theme}&${name}-state-fixture`,
        );
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
        if (name === "owner") {
          await page.getByText("Focused change", { exact: true }).click();
          await page.getByRole("button", { name: "Send answer", exact: true }).click();
          await expect(
            page.getByText("Fixture question unavailable", { exact: true }),
          ).toBeVisible();
        }
        await page.screenshot({
          path: `temp/verification/assistant-remaining-visual/${theme}-${width}-${name}.png`,
          animations: "disabled",
        });
      }
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`job row shared reveal ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&job-row-fixture`,
      );
      const checkbox = page.getByRole("checkbox");
      await expect(checkbox).toHaveCSS("opacity", "0");
      await checkbox.focus();
      await expect(checkbox).toHaveCSS("opacity", "1");
      await checkbox.check();
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/job-row-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`assistant collections dividers ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&collections-fixture`,
      );
      const activity = page.locator("ol > li");
      const memory = page.locator("section article");
      await expect(activity).toHaveCount(2);
      await expect(memory).toHaveCount(2);
      for (const rows of [activity, memory]) {
        await expect(rows.first()).toHaveCSS("border-top-width", "0px");
        await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");
      }
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/collections-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`job note separators ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&job-notes-fixture`,
      );
      const sections = page.locator("main section");
      await expect(sections).toHaveCount(2);
      await expect(sections.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(sections.nth(1)).toHaveCSS("border-bottom-width", "0px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/job-notes-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`trash rows separators ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&trash-rows-fixture`,
      );
      const rows = page.getByRole("dialog", { name: "Recently deleted" }).locator("ul > li");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-top-width", "0px");
      await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");
      await expect(rows.first()).toHaveCSS("border-radius", "0px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/trash-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`avatar picker ring ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&avatar-picker-fixture`,
      );
      const radio = page.getByRole("radio").first();
      await expect(radio).toHaveAttribute("aria-checked", "true");
      await expect(radio).toHaveCSS("border-radius", "9999px");
      const metrics = await radio.evaluate((node) => {
        const s = getComputedStyle(node);
        return { shadow: s.boxShadow, border: s.borderRadius };
      });
      expect(metrics.shadow).toContain("2px");
      const next = page.getByRole("radio").nth(1);
      await next.click();
      await expect(next).toHaveAttribute("aria-checked", "true");
      await expect(next).toHaveCSS("border-radius", "9999px");
      await expect(radio).toHaveAttribute("aria-checked", "false");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/avatar-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`notes selection and timeline ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&notes-components-fixture`,
      );
      const checkbox = page.getByRole("checkbox");
      await expect(checkbox).toHaveCSS("opacity", "0");
      await checkbox.focus();
      await expect(checkbox).toHaveCSS("opacity", "1");
      await checkbox.check();
      const rows = page.locator("article ol > li");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(rows.nth(1)).toHaveCSS("border-bottom-width", "0px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/notes-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [480, 800, 1280]) {
    test(`notes layout frame ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&notes-layout-fixture`,
      );
      const list = page.getByRole("list", { name: "Notes" });
      await expect(list).toBeVisible();
      const pane = list.locator("..");
      await expect(pane).toHaveCSS("border-right-width", width === 480 ? "0px" : "1px");
      const reader = page.locator("main article");
      const listBox = await pane.boundingBox();
      const readerBox = await reader.boundingBox();
      expect(listBox && readerBox).toBeTruthy();
      if (width === 480) expect(readerBox!.y).toBeGreaterThanOrEqual(listBox!.y + listBox!.height);
      else expect(readerBox!.x).toBeGreaterThan(listBox!.x + listBox!.width);
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/notes-layout-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`builder preview dividers ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&builder-preview-fixture`,
      );
      const rows = page.locator("main ul > li");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-top-width", "0px");
      await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/builder-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`conversation canvas and user bubble paints ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&conversation-message-fixture`,
      );
      const bubbles = page.locator("main article > div:nth-child(2)");
      await expect(bubbles).toHaveCount(2);
      const values = await bubbles.evaluateAll((nodes) =>
        nodes.map((node) => {
          const s = getComputedStyle(node);
          return {
            bg: s.backgroundColor,
            bl: s.borderBottomLeftRadius,
            br: s.borderBottomRightRadius,
          };
        }),
      );
      expect(values[0].bl).toBe("0px");
      expect(values[0].br).toBe("0px");
      expect(values[1].bl).toBe("8px");
      expect(values[1].br).toBe("8px");
      expect(values[0].bg).not.toBe(values[1].bg);
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/bubbles-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`presence marks ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&presence-marks-fixture`,
      );
      const marks = page.locator("[data-presence-state] > span:first-child");
      await expect(marks).toHaveCount(4);
      for (const mark of await marks.all()) await expect(mark).toHaveCSS("width", "9px");
      await expect(marks.last()).toHaveCSS("border-top-width", "1px");
      await expect(marks.last()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/presence-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.emulateMedia({ forcedColors: "active" });
      for (const mark of await marks.all()) await expect(mark).toHaveCSS("border-top-width", "1px");
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`job session boundaries ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&job-sessions-fixture`,
      );
      const rows = page.locator("[data-assistant-session]");
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) await expect(row).toHaveCSS("border-bottom-width", "1px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/job-sessions-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`manual supervision notice frame ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const chief of [true, false]) {
        await page.goto(
          `/tests/browser/assistant/assistant-room.html?theme=${theme}&manual-notices-fixture${chief ? "&chief" : ""}`,
        );
        const notice = page.locator("[class*=notices]");
        await expect(notice).toHaveCSS("border-top-width", chief ? "0px" : "1px");
        await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
        await page.screenshot({
          path: `temp/verification/assistant-callers-visual/manual-${theme}-${width}-${chief}.png`,
          animations: "disabled",
        });
      }
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`job review boundaries ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&job-review-fixture`,
      );
      const rows = page.locator("[class*=reviewJob]");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-top-width", "0px");
      await expect(rows.nth(1)).toHaveCSS("border-top-width", "1px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/review-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`briefing multiple approvals ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?theme=${theme}&briefing&multi-approvals`,
      );
      const card = page.getByRole("region", { name: "While you were away", exact: true });
      await card.getByRole("button", { name: "Go to approvals", exact: true }).click();
      const rows = card.locator('[data-surface-dividers="pane"] > div');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(rows.last()).toHaveCSS("border-bottom-width", "0px");
      await mkdir("temp/verification/assistant-callers-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/assistant-callers-visual/approvals-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }
