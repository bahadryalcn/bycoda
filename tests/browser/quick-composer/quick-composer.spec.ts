import { test, expect } from "@playwright/test";
import { dropAnnouncer, dropBadge, dropMarks, fileDrag, files } from "../support/external-drop";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`long plain paste in Quick Composer at ${width}px in ${theme}`, async ({
      page,
      context,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/quick-composer/quick-composer.html?pasted-text&theme=${theme}`,
      );
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      const text = "Pasted content with a newline.\n".repeat(3900);
      if (browserName === "chromium") {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.evaluate((value) => navigator.clipboard.writeText(value), text);
        await prompt.press("ControlOrMeta+v");
      } else {
        await prompt.evaluate((element, value) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", value);
          element.dispatchEvent(
            new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
          );
        }, text);
      }
      await expect(page.getByText("Pasted text", { exact: true })).toBeVisible();
      await expect(prompt).toHaveValue("");
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      await page.screenshot({
        path: `temp/verification/pasted-text-direct/quick-${theme}-${width}.png`,
      });
    });

    test(`Windows quick composer start and open ${theme} ${width}`, async ({ page }, info) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      await prompt.fill("Start this Windows session and keep its model choice");
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      // The shortcut is the Start button's tooltip, not a permanent label.
      await page.getByRole("button", { name: "Start", exact: true }).hover();
      await expect(page.getByRole("tooltip")).toContainText("Ctrl+↵");
      await page.screenshot({
        path: info.outputPath(`windows-quick-${theme}-${width}.png`),
        animations: "disabled",
      });
      await prompt.press("Control+Enter");
      await expect(prompt).toHaveValue("");
      const requests = await page.evaluate(() =>
        (window as any).quickFixtureCalls.filter(
          (call: any) => call.command === "quick_composer_submit_intent",
        ),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].args.submission.request).toMatchObject({
        prompt: "Start this Windows session and keep its model choice",
        harness: "codex",
        model: "fixture-0",
        reveal: true,
      });
    });
  }
}

for (const [theme, width] of [
  ["light", 390],
  ["dark", 1000],
] as const) {
  test(`quick composer shared controls ${theme} ${width}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(prompt).toBeFocused();
    await prompt.fill("A retained native composer draft");
    await page.getByRole("button", { name: "Fixture model 0", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search models", exact: true });
    await expect(search).toBeFocused();
    await search.fill("model 37");
    await expect(page.getByRole("option", { name: /Fixture model 37/ })).toBeVisible();
    await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(search).toBeVisible();
    await search.press("Enter");
    // Picking a model collapses the list; the Model row names the choice above its settings.
    const selector = page.getByRole("region", { name: "Model selector", exact: true });
    await expect(selector.getByRole("button", { name: "Model", exact: true })).toContainText(
      "Fixture model 37",
    );
    await expect(prompt).toHaveValue("A retained native composer draft");
    const reasoning = selector.getByRole("combobox", { name: "Reasoning", exact: true });
    await reasoning.selectOption({ label: "High" });
    await expect(reasoning.locator("option:checked")).toHaveText("High");
    await reasoning.press("Escape");
    await expect(prompt).toBeFocused();
    await page.getByRole("button", { name: "Permissions", exact: true }).click();
    await page.getByRole("listbox", { name: "Permissions", exact: true }).press("Escape");
    await expect(prompt).toBeFocused();
    await prompt.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    expect(
      await page.evaluate(
        () =>
          (window as any).quickFixtureCalls.filter(
            (call: any) => call.command === "quick_composer_submit_intent",
          ).length,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`quick-controls-${theme}-${width}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Start", exact: true }).dblclick();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).quickFixtureCalls.filter(
              (call: any) => call.command === "quick_composer_submit_intent",
            ).length,
        ),
      )
      .toBe(1);
    await expect(prompt).toHaveValue("");
    expect(errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`quick composer inherits current checkout by default ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
      await page
        .getByRole("textbox", { name: "Prompt", exact: true })
        .fill("Preserve the current checkout draft");
      await expect(
        page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      expect(
        await page.evaluate(() =>
          (window as any).quickFixtureCalls.some(
            (call: any) => call.args?.method === "projects.workspacePolicy.get",
          ),
        ),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`quick-current-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

test("quick composer displays inherited worktree policy and an explicit current choice overrides it", async ({
  page,
}) => {
  await page.goto("/tests/browser/quick-composer/quick-composer.html?worktree-policy");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep this policy override draft");
  await expect(
    page.getByRole("button", { name: "Workspace New worktree", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-workspace-creation-status]")).toContainText(
    "New worktree from main",
  );
  await page.getByRole("button", { name: "Workspace New worktree", exact: true }).click();
  await page.evaluate(() => (window as any).quickFixture.pickWorkspace("current"));
  await expect(
    page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).quickFixtureCalls.filter(
            (call: any) => call.command === "quick_composer_submit_intent",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).quickFixtureCalls.find(
          (call: any) => call.command === "quick_composer_submit_intent",
        ).args.submission.request.workspaceMode,
    ),
  ).toBe("current");
});

test("quick composer keeps an explicit worktree blocked on a legacy Host and preserves the draft", async ({
  page,
}) => {
  await page.goto("/tests/browser/quick-composer/quick-composer.html");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep this failed worktree draft");
  await page.getByRole("button", { name: "Workspace Current checkout", exact: true }).click();
  await page.evaluate(() => (window as any).quickFixture.pickWorkspace("worktree"));
  await page
    .locator("[data-workspace-creation-status]")
    .getByRole("button", { name: /^Details/ })
    .click();
  await expect(page.getByRole("dialog", { name: /^Details/ })).toContainText("Update bycoda Host");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(prompt).toHaveValue("Keep this failed worktree draft");
  await page.getByRole("button", { name: "Use current checkout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(prompt).toHaveValue("Keep this failed worktree draft");
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`native intent pending, newer draft and unknown status retry ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      const count = (command: string) =>
        page.evaluate(
          (name) =>
            (window as any).quickFixtureCalls.filter((call: any) => call.command === name).length,
          command,
        );
      await page.evaluate(() => {
        (window as any).quickFixture.hold = true;
      });
      await prompt.fill("Original accepted prompt");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect.poll(() => count("quick_composer_submit_intent")).toBe(1);
      await prompt.fill("Newer unsent prompt kept through the old acknowledgment");
      await page.screenshot({
        path: info.outputPath(`quick-pending-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.hold = false;
        (window as any).quickFixture.finish();
      });
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      await expect(prompt).toHaveValue("Newer unsent prompt kept through the old acknowledgment");
      expect(
        await page.evaluate(
          () =>
            (window as any).quickFixtureCalls.find(
              (call: any) => call.command === "quick_composer_submit_intent",
            ).args.submission.request.prompt,
        ),
      ).toBe("Original accepted prompt");
      await page.screenshot({
        path: info.outputPath(`quick-newer-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.fail = true;
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(prompt).toHaveValue("Newer unsent prompt kept through the old acknowledgment");
      await page.screenshot({
        path: info.outputPath(`quick-unknown-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.fail = false;
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(prompt).toHaveValue("");
      expect(await count("quick_composer_submit_status")).toBe(1);
      expect(await count("quick_composer_submit_intent")).toBe(2);
      expect(await count("quick_composer_submit")).toBe(0);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`external drop: the quick composer frame carries one mark and one badge ${theme}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
    const frame = page.locator('[data-external-drop-owner="quick-attachments"]');
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeFocused();

    // DOM drag: the mark sits on the frame, the badge names the action, nothing else repeats it.
    await fileDrag(frame, "dragover", files(2));
    await expect(frame).toHaveAttribute("data-drop-indicator", "inside");
    await expect(dropBadge(page)).toHaveText("Attach 2 files");
    await expect(dropAnnouncer(page)).toHaveText("Attach 2 files");
    await expect(dropMarks(page)).toHaveCount(1);
    await expect(page.getByText("Drop to attach")).toHaveCount(0);
    await page.screenshot({ path: `temp/verification/vis-dnd-4/quick-attach-2-${theme}.png` });

    await page.keyboard.press("Escape");
    await expect(dropBadge(page)).toHaveCount(0);
    await expect(dropMarks(page)).toHaveCount(0);
    await fileDrag(frame, "dragover", files(1));
    await expect(dropBadge(page)).toHaveText("Attach 1 file");
    await fileDrag(frame, "dragleave", files(1), { x: 1, y: 1 });
    await expect(dropBadge(page)).toHaveCount(0);

    // Synthesized tauri://drag-* events through the mocked event bus (the native handler, not a
    // real OS drag): enter carries the paths, leave ends it.
    const box = await frame.boundingBox();
    await page.evaluate(
      ({ x, y }) =>
        (
          window as unknown as {
            quickFixtureEmit: (name: string, payload: unknown) => Promise<void>;
          }
        ).quickFixtureEmit("tauri://drag-enter", {
          paths: ["C:/fixture/a.png", "C:/fixture/b.png", "C:/fixture/c.png"],
          position: { x, y },
        }),
      { x: box!.x + 100, y: box!.y + 60 },
    );
    await expect(dropBadge(page)).toHaveText("Attach 3 files");
    await expect(frame).toHaveAttribute("data-drop-indicator", "inside");
    await page.evaluate(() =>
      (
        window as unknown as {
          quickFixtureEmit: (name: string, payload: unknown) => Promise<void>;
        }
      ).quickFixtureEmit("tauri://drag-leave", {}),
    );
    await expect(dropBadge(page)).toHaveCount(0);
    await expect(dropMarks(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`quick picker roots preserve IME and draft ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer/quick-composer.html?theme=${theme}`);
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      await prompt.fill("/");
      const commands = page.getByRole("listbox", { name: "Commands", exact: true });
      await expect(commands.getByRole("option").first()).toBeVisible();
      await prompt.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      await expect(prompt).toHaveValue("/");
      await expect(commands).toBeVisible();
      await page.screenshot({
        path: `temp/verification/picker-roots/quick-commands-${theme}-${width}.png`,
      });
      await prompt.fill("Exact retained quick draft");
      await page.getByRole("button", { name: "alpha", exact: true }).click();
      const projects = page.getByRole("listbox", { name: "Projects", exact: true });
      await expect(projects.getByRole("option").first()).toBeVisible();
      await page.screenshot({
        path: `temp/verification/picker-roots/quick-projects-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(prompt).toBeFocused();
      await expect(prompt).toHaveValue("Exact retained quick draft");
    });
