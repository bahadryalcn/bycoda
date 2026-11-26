import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  dropAnnouncer,
  dropBadge,
  dropMarks,
  fileDrag,
  files,
  textDrag,
} from "../support/external-drop";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`queue writer feedback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      for (const [state, message] of [
        ["writer-wait", "Waiting for the previous run to finish."],
        ["writer-blocked", "Check the conversation on its Host before resuming."],
      ] as const) {
        await page.goto(
          `/tests/browser/chat/composer-extras.html?chat-layout&delivery-progress&queue-state=${state}&theme=${theme}`,
        );
        const queue = page.locator("[data-message-queue-card]");
        await expect(queue.getByText(message, { exact: true })).toHaveCount(1);
        await expect(queue.getByText(message, { exact: true })).toBeVisible();
        await expect(page.locator("[data-delivery-notice-slot]")).toHaveCount(0);
        await expect(queue.getByRole("button", { name: "Resume", exact: true })).toHaveCount(
          state === "writer-blocked" ? 1 : 0,
        );
        await queue.screenshot({
          animations: "disabled",
          path: `temp/verification/queue-writer-recovery/${state}-${theme}-${width}.png`,
        });
      }
    });

    test(`queued send details ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&delivery-progress&queue-state=waiting&theme=${theme}`,
      );
      const notice = page.locator('[data-delivery-progress="waiting"]');
      await expect(notice).toContainText("The message stays queued and is retried automatically.");
      await expect(notice).not.toContainText("The technical reason is in the details.");
      const trigger = notice.getByRole("button", { name: /^Details:/ });
      await trigger.press("Enter");
      const details = page.getByRole("dialog", { name: /^Details:/ });
      await expect(details.getByLabel("Error details")).toContainText("RPC_WS_DEADLINE");
      await expect(details.getByRole("button", { name: "Copy details" })).toBeInViewport();
      const noticeBox = (await notice.boundingBox())!;
      expect((await details.boundingBox())!.y).toBeGreaterThanOrEqual(
        noticeBox.y + noticeBox.height,
      );
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/error-details/queue-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(details).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test(`workspace footer spacing and scoped refresh ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      await page.goto(
        `/tests/browser/chat/composer-extras.html?footer&workspace-footer-bar&accounts&theme=${theme}`,
      );
      const bar = page.locator("[data-workspace-footer]");
      await expect(bar.getByRole("button", { name: "Refresh usage", exact: true })).toHaveCount(0);
      // Wide footers keep the window-wide controls inline (refresh, sounds, full screen).
      const refresh = bar.getByRole("button", { name: "Refresh current view", exact: true });
      await expect(refresh).toHaveCount(1);
      await expect(
        bar.getByRole("button", { name: "Workspace controls", exact: true }),
      ).toHaveCount(0);
      await page.evaluate(() => {
        (window as unknown as { refreshEvents: number }).refreshEvents = 0;
        window.addEventListener("bycoda:refresh-workspace-view", () => {
          (window as unknown as { refreshEvents: number }).refreshEvents += 1;
        });
      });
      await refresh.click();
      expect(
        await page.evaluate(() => (window as unknown as { refreshEvents: number }).refreshEvents),
      ).toBe(1);
      // Without a sidebar the bell sits alone at the footer's start; the other tools form one group.
      const bell = bar.getByRole("button", { name: "Notifications", exact: true });
      const actions = bar.locator(
        'nav button:visible, [data-usage-guide="terminal-toggle"], button[aria-label="Conversation tools"]',
      );
      await expect(actions).toHaveCount(5);
      const bellBox = await bell.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const icon = button.querySelector("svg")!.getBoundingClientRect();
        return { x: box.x, width: box.width, height: box.height, iconWidth: icon.width };
      });
      expect(bellBox).toMatchObject({ width: 28, height: 28, iconWidth: 14 });
      const boxes = await actions.evaluateAll((buttons) =>
        buttons
          .map((button) => {
            const box = button.getBoundingClientRect();
            const icon = button.querySelector("svg")!.getBoundingClientRect();
            return {
              x: box.x,
              width: box.width,
              height: box.height,
              iconWidth: icon.width,
              iconHeight: icon.height,
            };
          })
          .sort((a, b) => a.x - b.x),
      );
      for (const [index, box] of boxes.entries()) {
        expect(box.width).toBe(28);
        expect(box.height).toBe(28);
        expect(box.iconWidth).toBe(14);
        expect(box.iconHeight).toBe(14);
        if (index > 0) expect(box.x - boxes[index - 1].x - boxes[index - 1].width).toBe(4);
      }
      expect(bellBox.x).toBeLessThan(boxes[0].x);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: `temp/verification/2026-11-15-workspace-footer/footer-${theme}-${width}.png`,
      });
      await bar.getByRole("button", { name: "Claude Code usage details", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Claude Code usage details", exact: true });
      await expect(
        dialog.getByRole("button", { name: "Refresh usage", exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Refresh usage", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Refresh usage", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: `temp/verification/2026-11-15-workspace-footer/details-${theme}-${width}.png`,
      });
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`model panel compaction and agent order ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      await page.goto(`/tests/browser/chat/composer-extras.html?chat-layout&theme=${theme}`);
      await page.locator("[data-composer-model-controls] button[aria-haspopup]").first().click();
      const panel = page.locator("[data-model-panel]");
      const slider = panel.getByRole("slider", { name: "Auto-compact window", exact: true });
      await slider.press("Home");
      await expect(slider).toHaveAttribute("aria-valuetext", "Default: 200K");
      await slider.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "250K");
      await slider.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "300K");
      await expect(page.getByTestId("choice")).toContainText('"autoCompactWindow":"300000"');
      await slider.blur();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `temp/verification/model-panel-fix/settings-${theme}-${width}.png`,
      });
      await panel.getByRole("tab", { name: "Agents", exact: true }).click();
      expect(
        await panel
          .locator("[data-model-settings] [data-setting-id]")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-setting-id"))),
      ).toEqual([
        "crossAdvisor",
        "imageModels",
        "subagentPolicy",
        "crossSubagents",
        "crossSubagentMaxEffort",
      ]);
      const images = panel.locator('[data-setting-id="imageModels"]');
      await images.locator("[data-model-setting-add]").click();
      await panel.getByRole("option", { name: /Nano Banana/ }).click();
      await panel.getByRole("option", { name: /Codex ImageGen/ }).click();
      await panel.getByRole("button", { name: "Done", exact: true }).click();
      await expect(images).toContainText("Nano Banana");
      await expect(images).toContainText("Codex ImageGen");
      expect(
        await images
          .locator("[data-clamped]")
          .evaluateAll((labels) => labels.map((label) => getComputedStyle(label).maskImage)),
      ).toEqual(["none", "none"]);
      await expect(images.getByRole("button", { name: /^Remove / })).toHaveCount(2);
      await expect(images).toBeInViewport();
      await page.screenshot({
        path: `temp/verification/model-panel-fix/agents-${theme}-${width}.png`,
      });
      const effort = panel.locator('[data-setting-id="crossSubagentMaxEffort"]');
      await effort.scrollIntoViewIfNeeded();
      await effort.getByRole("radio", { name: "High", exact: true }).click();
      await expect(effort.getByRole("radio", { name: "High", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(effort.getByRole("switch")).toHaveAttribute("aria-checked", "false");
      await expect(page.getByTestId("choice")).toContainText('"crossSubagentMaxEffort":"high"');
      await page.screenshot({
        path: `temp/verification/model-panel-fix/effort-${theme}-${width}.png`,
      });
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`model panel worst realistic identities ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "tr"));
      await page.goto(
        `/tests/browser/chat/composer-extras.html?accounts=8&data=worst&theme=${theme}`,
      );
      const trigger = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
      await trigger.click();
      const panel = page.locator("[data-model-panel]");
      await expect(panel).toBeVisible();
      for (const zoom of [1, 2]) {
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
        await expect
          .poll(() =>
            panel.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              return (
                bounds.left >= -1 &&
                bounds.right <= innerWidth + 1 &&
                bounds.top >= -1 &&
                bounds.bottom <= innerHeight + 1
              );
            }),
          )
          .toBe(true);
        const firstModel = panel.getByRole("option").first();
        await firstModel.scrollIntoViewIfNeeded();
        await expect(firstModel).toBeInViewport();
        await page.screenshot({
          path: `temp/verification/2026-11-13-ui-coherence/models/${theme}-${width}-${zoom}x.png`,
        });
        const selectedEffort = panel
          .locator('[data-setting-id="effort"] [role="radio"][aria-checked="true"]')
          .first();
        await selectedEffort.scrollIntoViewIfNeeded();
        await expect(selectedEffort).toBeInViewport();
        await selectedEffort.click();
        await page.screenshot({
          path: `temp/verification/2026-11-13-ui-coherence/models/settings-${theme}-${width}-${zoom}x.png`,
        });
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
        document.documentElement.dir = "rtl";
      });
      await expect(panel).toBeInViewport();
      await page.screenshot({
        path: `temp/verification/2026-11-13-ui-coherence/models/${theme}-${width}-rtl.png`,
      });
      await page.evaluate(() => {
        document.documentElement.dir = "ltr";
      });
      await panel.locator("[data-model-settings] [role=tab]").nth(1).click();
      const selectedModels = panel.locator('[data-setting-id="crossSubagents"]');
      await selectedModels.scrollIntoViewIfNeeded();
      const ceiling = panel.locator('[data-setting-id="crossSubagentMaxEffort"]');
      await ceiling.scrollIntoViewIfNeeded();
      await expect(ceiling.getByRole("switch")).toBeInViewport();
      expect(
        await ceiling.evaluate((element) => {
          const heading = element.firstElementChild!.getBoundingClientRect();
          const bounds = element.closest("[data-model-panel]")!.getBoundingClientRect();
          return heading.top >= bounds.top && heading.bottom <= bounds.bottom;
        }),
      ).toBe(true);
      await expect(selectedModels.getByRole("button", { name: /kaldır$|^Remove/ })).toHaveCount(3);
      await page.screenshot({
        path: `temp/verification/2026-11-13-ui-coherence/models/agents-${theme}-${width}.png`,
      });
      await panel.locator("[data-model-account-menu]").click();
      const accounts = panel.locator("[data-model-account-list]");
      await expect(accounts).toBeVisible();
      await expect(accounts.getByRole("radio")).toHaveCount(8);
      await page.screenshot({
        path: `temp/verification/2026-11-13-ui-coherence/models/accounts-${theme}-${width}.png`,
      });
    });

    test(`quota recovery retains long draft ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      const editor = page.getByRole("textbox", { name: "Message", exact: true });
      const notice = page.locator("[data-usage-limit]");
      const switchModel = notice.getByRole("button", { name: "Switch model", exact: true });
      const switchAccount = notice.getByRole("button", { name: "Switch account", exact: true });
      const cancel = notice.getByRole("button", { name: "Cancel auto-resume", exact: true });
      const dismiss = notice.getByRole("button", {
        name: "Dismiss usage limit notice",
        exact: true,
      });
      for (const zoom of [1, 2]) {
        await page.goto(
          `/tests/browser/chat/composer-extras.html?accounts=8&account-usage&data=worst&quota-stress&theme=${theme}`,
        );
        const draft = await editor.inputValue();
        expect(draft.length).toBeGreaterThan(1000);
        await page.evaluate((value) => {
          document.documentElement.style.zoom = String(value);
        }, zoom);
        await page.screenshot({
          path: `temp/verification/usage-limit-recovery/notice-${theme}-${width}-${zoom}x.png`,
        });
        await switchModel.scrollIntoViewIfNeeded();
        await expect(switchModel).toBeInViewport();
        await expect(switchAccount).toBeInViewport();
        await expect(cancel).toBeInViewport();
        await expect(dismiss).toBeInViewport();
        if (width === 1280 && zoom === 1) {
          const copyTop = (await notice
            .getByText("Usage limit reached", { exact: true })
            .boundingBox())!;
          const copyBottom = (await notice.getByText(/^Resets /).boundingBox())!;
          const copyCenter = (copyTop.y + copyBottom.y + copyBottom.height) / 2;
          for (const control of [switchModel, switchAccount, cancel, dismiss]) {
            const bounds = (await control.boundingBox())!;
            expect(Math.abs(bounds.y + bounds.height / 2 - copyCenter)).toBeLessThan(2);
          }
        }
        expect(
          await notice.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return [...element.querySelectorAll("button")].every((button) => {
              const rect = button.getBoundingClientRect();
              return (
                rect.left >= bounds.left &&
                rect.right <= bounds.right &&
                rect.top >= bounds.top &&
                rect.bottom <= bounds.bottom
              );
            });
          }),
        ).toBe(true);
        const panel = page.locator("[data-model-panel]");
        if (zoom === 1) {
          await cancel.click();
          await expect(notice.getByRole("button", { name: "Resume at reset" })).toBeVisible();
          await switchAccount.click();
          const accounts = page.getByRole("menuitemradio");
          await expect(accounts).toHaveCount(8);
          await expect(panel).toHaveCount(0);
          await page.screenshot({
            path: `temp/verification/usage-limit-recovery/accounts-${theme}-${width}.png`,
          });
          await accounts.nth(1).click();
        } else {
          await switchModel.click();
          await expect(panel).toBeVisible();
          await page.screenshot({
            path: `temp/verification/usage-limit-recovery/models-${theme}-${width}.png`,
          });
          await panel.getByRole("option", { name: /^Claude Opus 4\.7$/ }).click();
        }
        await expect(panel).toHaveCount(0);
        await expect(notice).toContainText("Ready to continue");
        await expect(cancel).toHaveCount(0);
        await expect(switchModel).toHaveCount(0);
        await expect(switchAccount).toHaveCount(0);
        const resume = notice.getByRole("button", { name: "Continue", exact: true });
        await expect(resume).toBeInViewport();
        await expect(page.getByTestId("quota-resumes")).toHaveText("0");
        await expect(editor).toHaveValue(draft);
        await page.screenshot({
          path: `temp/verification/usage-limit-recovery/continue-${theme}-${width}-${zoom}x.png`,
        });
        await resume.click();
        await expect(page.getByTestId("quota-resumes")).toHaveText("1");
        await expect(notice).toHaveCount(0);
        await expect(editor).toHaveValue(draft);
      }
    });
  }
}

/** Hover hints are the shared Tooltip (no native title): a label line plus shortcut key caps.
 *  A `null` label means the control already shows it in full, so the hint keeps only the key caps. */
async function expectHint(
  page: Page,
  target: Locator,
  label: string | RegExp | null,
  keys: (string | RegExp)[] | RegExp | null,
) {
  await target.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  if (label !== null) await expect(hint).toContainText(label);
  if (keys === null) await expect(hint.locator("kbd")).toHaveCount(0);
  else if (Array.isArray(keys)) await expect(hint.locator("kbd")).toHaveText(keys);
  else await expect(hint).toContainText(keys);
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCount(0);
}

test("model search windows large catalogs while narrowing and navigating", async ({ page }) => {
  await initializeChatLayout(page);
  await page.goto(
    "/tests/browser/chat/composer-extras.html?chat-layout&large-model-catalog&accounts=4",
  );
  await page
    .locator('[data-composer-model-controls] button[aria-haspopup="dialog"]')
    .first()
    .click();
  const panel = page.getByRole("dialog", { name: "Model and settings" });
  const search = panel.getByRole("combobox", { name: "Search models" });
  const options = panel.getByRole("listbox", { name: "Models" }).getByRole("option");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await search.fill("");
    await expect(options.first()).toBeVisible();
    await expect.poll(() => options.count()).toBeLessThan(50);
    await search.fill("Catalog 1");
    await expect.poll(() => options.count()).toBeLessThan(50);
    await options.first().press("End");
    await expect(panel.locator('[role="option"][aria-posinset="111"]')).toBeInViewport();
    await search.fill("Catalog 199");
    await expect(options).toHaveCount(1);
    await expect(options).toContainText("Catalog 199");
    await search.fill("");
    await options.first().press("End");
    await panel.locator("[data-model-account-menu]").click();
    await expect(panel.getByRole("radio", { name: /^work/ })).toBeInViewport();
    await panel.getByRole("radio", { name: /^work/ }).click();
  }
});

test("model panel accepts semantic click and Enter/Space activation", async ({ page }) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout");
  const trigger = page
    .locator('[data-composer-model-controls] button[aria-haspopup="dialog"]')
    .first();
  const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  for (const activation of ["click", "Enter", "Space"]) {
    await trigger.focus();
    if (activation === "click")
      await trigger.evaluate((element: HTMLButtonElement) => element.click());
    else await trigger.press(activation);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("combobox", { name: "Search models" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeFocused();
  }
});

test("composer attachment submission stays local and keeps Stop available", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await page.evaluate(() => {
    const fixture = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: unknown) => Promise<unknown>;
      };
      finishComposerPaste?: () => void;
    };
    const original = fixture.__TAURI_INTERNALS__.invoke;
    fixture.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "clipboard_file_paths") return [];
      // Pasted images are saved before they join the draft; the isolated path stands in.
      if (command === "write_attachment")
        return `C:/isolated-fixture/${(args as { name: string }).name}`;
      if (command === "clipboard_image") {
        await new Promise<void>((resolve) => {
          fixture.finishComposerPaste = resolve;
        });
        return Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oS0AAAAASUVORK5CYII=",
          ),
          (char) => char.charCodeAt(0),
        ).buffer;
      }
      return original(command, args);
    };
    document.querySelector("textarea")!.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { finishComposerPaste?: () => void }).finishComposerPaste),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const pending = page.locator('.composer-send-controls button[data-button-loading="true"]');
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(stop).toBeEnabled();
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await expect(pending).toBeInViewport();
    await expect(stop).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`composer-pending-390-${light ? "light" : "dark"}.png`),
    });
  }
  await stop.click();
  await expect(pending).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { finishComposerPaste: () => void }).finishComposerPaste(),
  );
  await expect(
    page.getByRole("button", {
      name: "Open clipboard-image.png",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toContainText(
    "Keep this chat draft",
  );
});

test("Steer explains a prolonged wait and preserves the paused queue at narrow widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  for (const light of [false, true]) {
    await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&delivery-progress");
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    const card = page.locator("[data-message-queue-card]");
    await card.getByRole("button", { name: "Steer", exact: true }).press("Enter");
    // Pending stages are a compact summary indicator; the notice is for outcomes only.
    const pending = card.locator("[data-delivery-pending]");
    const progress = page.locator("[data-delivery-progress]");
    await pending.hover();
    await page.clock.runFor(500);
    await expect(page.getByRole("tooltip")).toHaveText("Synchronizing the message queue…");
    await expect(pending.getByRole("status")).toHaveText("Synchronizing the message queue…");
    await expect(progress).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await page.clock.runFor(11_000);
    await expect(page.getByRole("tooltip")).toHaveText("Synchronizing the message queue…");
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      path: `temp/verification/2026-10-21-steer-investigation/${light ? "light" : "dark"}-320-waiting.png`,
    });
    await page.clock.runFor(1000);
    await expect(page.getByRole("tooltip")).toHaveText(
      "Sending the message. Waiting for provider confirmation…",
    );
    await page.clock.runFor(1000);
    await expect(progress).toHaveAttribute("data-delivery-progress", "rejected");
    // The outcome is a dismissible pane card, not part of the queue card.
    await expect(progress).toHaveAttribute("role", "alert");
    // It takes space in the pane flow (#283): an overlay would cover the transcript and Find.
    await expect(page.locator("[data-delivery-notice-slot]")).toHaveCSS("position", "static");
    await expect(
      progress.getByText("Queue paused: the last message was not accepted"),
    ).toBeVisible();
    await expect(
      progress.getByText(
        "The send was cancelled or rejected. The message remains queued and the queue is paused.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
    await expect(
      card
        .locator("[data-message-queue-rows]")
        .getByText("Queued task waiting for the current turn", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Remove queued message", exact: true }),
    ).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Steer", exact: true })).toBeEnabled();
  }
});

test("queue actions expose progress and recovery in both themes at narrow widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&queue-feedback");
  const card = page.locator("[data-message-queue-card]");
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.setViewportSize({ width: 390, height: 800 });
    const steer = card.getByRole("button", { name: "Steer", exact: true });
    await steer.focus();
    await steer.press("Enter");
    await expect(card.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    // The pending action is carried by the button label alone, without a feedback line.
    await expect(card.locator("[data-queue-feedback]")).toHaveCount(0);
    await expect(steer).toBeEnabled();
    await expect(card.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
    await expect(card.locator("[data-queue-feedback]")).toHaveCount(0);
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      card
        .locator("[data-message-queue-rows]")
        .getByText("Queued task waiting for the current turn", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Remove queued message", exact: true }),
    ).toHaveCount(1);
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(card.getByRole("button", { name: "Resuming…", exact: true })).toBeDisabled();
  // A resumed queue is shown by its state, not by an inferred acceptance line.
  await expect(card.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  await expect(card.locator("[data-queue-feedback]")).toHaveCount(0);
  await page.screenshot({
    path: "temp/verification/2026-10-20-git-reliability/queue-feedback.png",
  });
});

test("chat shortcut hints follow custom bindings and expose rewind at narrow widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&shortcuts");
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("");
  const rewind = page.getByRole("button", {
    name: "Rewind and edit",
    exact: true,
  });
  await expectHint(page, rewind, "Rewind and edit", ["Esc", "Esc"]);
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    for (const width of [320, 390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(rewind).toBeInViewport();
      await rewind.hover();
    }
  }
  await rewind.focus();
  await rewind.press("Enter");
  await expect(input).toHaveValue("Earlier message");
  await expect(rewind).toBeHidden();
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  const queue = page.getByRole("button", {
    name: "Queue message",
    exact: true,
  });
  await page.evaluate(() => {
    localStorage.setItem(
      "bycoda.keybindingOverrides",
      JSON.stringify({
        "Session: Stop Turn": { shortcut: "Control+Shift+KeyM" },
        "Composer: Queue Message": { disabled: true },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.keybindingOverrides" }));
  });
  await expectHint(page, stop, "Stop", /M.*Ctrl\s*C/);
  await expectHint(page, queue, "Queue message for when this turn finishes", null);
  await page.evaluate(() => {
    localStorage.removeItem("bycoda.keybindingOverrides");
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.keybindingOverrides" }));
  });
  await expectHint(page, stop, "Stop", ["Esc", "Ctrl", "C"]);
  await expectHint(page, queue, "Queue message", /Tab/);
});

test("custom context signal exposes completed TPS and compact and respects reduced motion", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&response-speed");
  const trigger = page.getByRole("button", {
    name: /^Context usage: 50%.*50.0 TPS/,
  });
  await expect(trigger).toHaveText("");
  await expect(trigger.locator(".context-signal")).toHaveAttribute("data-speed-fill", "0.75");
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await trigger.hover();
      // Hover previews the panel in the shared HoverCard (a click pins it as a dialog).
      const panel = page.locator('[data-hover-card][aria-label="Context usage"]');
      await expect(panel).toBeInViewport();
      // The card is the only hint: no second tooltip repeats its heading.
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(panel.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
      await expect(panel).not.toContainText("Speed scale");
      const speed = panel.getByRole("term").filter({ hasText: /^Response speed$/ });
      await expect(speed).toBeVisible();
      await expect(speed.locator("..").getByRole("definition")).toHaveText("50.0 TPS");
      await expect(
        panel.getByText("Average speed includes tools and waiting.", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("button", { name: "Compact now", exact: true })).toBeEnabled();
      await expect(trigger.locator(".context-signal")).toBeVisible();
      await trigger.screenshot({
        path: testInfo.outputPath(`signal-${light ? "light" : "dark"}-${width}.png`),
      });
      await page.screenshot({
        path: testInfo.outputPath(`context-tps-${light ? "light" : "dark"}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await page.mouse.move(0, 0);
      await expect(panel).toBeHidden();
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  const packet = trigger.locator(".context-speed-bolt");
  await expect(packet).toHaveCSS("animation-name", "context-speed-charge");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(packet).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await trigger.focus();
  await trigger.press("Enter");
  await page.getByRole("button", { name: "Compact now", exact: true }).click();
  await expect(page.getByTestId("compacted")).toHaveText("1");
});

test("composer blank space focuses the larger draft while controls remain operable", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout");
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const box = page.locator("[data-composer-box]");
  await input.fill("");
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await input.evaluate((node) => node.blur());
      await box.click({ position: { x: 2, y: 2 } });
      await expect(input).toBeFocused();
      const height = (await input.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(68);
      await page.keyboard.type("ready to write");
      await expect(input).toHaveValue("ready to write");
      await input.fill("");
      await input.fill("line\n".repeat(20));
      await input.fill("");
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(68);
    }
  }
  await box.getByRole("button", { name: "Add files or skills", exact: true }).click();
  await expect(page.locator("[data-composer-plus]")).toBeVisible();
});

test("reprompt previews, applies and reverses selected text in both themes", async ({ page }) => {
  await initializeChatLayout(page);
  await useTextActionProvider(page, "claude");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const light of [false, true]) {
    await page.goto("/tests/browser/chat/composer-extras.html?translation-selection");
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.setViewportSize({ width: light ? 390 : 1000, height: 800 });
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    const original = "Before selam after";
    await input.fill(original);
    await input.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(7, 12);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    });
    const action = page
      .getByRole("toolbar", { name: "Selected text actions" })
      .getByRole("button", { name: "Reprompt", exact: true });
    await action.focus();
    await action.press("Enter");
    const result = page.getByRole("dialog", { name: "Reprompt", exact: true });
    await expect(result).toContainText("Rewritten prompt");
    await expect(result).toContainText("Translated fixture text");
    await expect(input).toHaveValue(original);
    expect(await result.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await result.getByRole("button", { name: "Apply prompt", exact: true }).click();
    await expect(input).toHaveValue("Before Translated fixture text after");
    await input.press("ArrowUp");
    await expect(input).toHaveValue(original);
    await input.press("ArrowDown");
    await expect(input).toHaveValue("Before Translated fixture text after");
  }
});

test("Antigravity translates directly and only connected providers are listed", async ({
  page,
}) => {
  test.setTimeout(20_000);
  await initializeChatLayout(page);
  await useTextActionProvider(page, "antigravity");
  await page.goto(
    "/tests/browser/chat/composer-extras.html?translation-selection&antigravity-selection",
    { waitUntil: "domcontentloaded" },
  );
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("selam bugün nasılsın?");
  await input.press("Control+a");
  await page
    .getByRole("toolbar", { name: "Selected text actions" })
    .getByRole("button", { name: /Translate to English/ })
    .click();
  const result = page.getByRole("dialog", {
    name: "Translate to English",
    exact: true,
  });
  await expect(result).not.toContainText("Choose a translation model.");
  await expect(result).toContainText("Translated fixture text");
  await result.getByRole("button", { name: /Antigravity/ }).click();
  await expect(page.getByRole("dialog", { name: "Model and settings", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Claude Code", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Codex", exact: true })).toHaveCount(0);
  await page.getByRole("option").filter({ hasText: "Gemini 3.8 Flash" }).first().click();
  // The panel stays open after a pick and covers the dialog; Escape closes only the panel.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Model and settings", exact: true })).toHaveCount(
    0,
  );
  await expect(result).toBeVisible();
  await result.getByRole("button", { name: "Translate selected text", exact: true }).click();
  await expect(result).toContainText("Translated fixture text");
  await result.getByRole("button", { name: "Apply translation", exact: true }).click();
  await expect(input).toHaveValue("Translated fixture text");
  await expect(page.getByTestId("choice")).toContainText('"harness":"antigravity"');
});

test("translation selection actions stay on one row across themes and widths", async ({ page }) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const light of [false, true]) {
    for (const width of [1280, 800, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/composer-extras.html?translation-selection");
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      const input = page.getByRole("textbox", { name: "Message", exact: true });
      await input.fill("selam bugün nasılsın?");
      await input.press("Control+a");
      const toolbar = page.getByRole("toolbar", { name: "Selected text actions" });
      await expect(
        toolbar.getByRole("button", { name: "Translate to Chinese", exact: true }),
      ).toBeAttached();
      const bounds = await toolbar.getByRole("button").evaluateAll((buttons) =>
        buttons.map((button) => ({
          top: button.getBoundingClientRect().top,
          bottom: button.getBoundingClientRect().bottom,
        })),
      );
      expect(
        Math.max(...bounds.map((box) => box.top)) - Math.min(...bounds.map((box) => box.top)),
      ).toBeLessThan(2);
      const popup = page.locator("[data-selection-menu]");
      if (width >= 800) {
        await expect
          .poll(() =>
            toolbar.evaluate(
              (element) => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth,
            ),
          )
          .toBe(true);
      }
      const box = (await popup.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await toolbar.getByRole("button", { name: "Translate to Chinese", exact: true }).focus();
      await expect(toolbar).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-04-selection-menu/${light ? "light" : "dark"}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(toolbar).toHaveCount(0);
    }
  }
});

test("translation selection menu opens above text and survives unavailable geometry", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?translation-selection", {
    waitUntil: "domcontentloaded",
  });
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "Selected text actions" });
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await input.fill("Hi, how are you today?");
    await input.press("Control+a");
    await expect(toolbar).toBeVisible();
    const field = (await input.boundingBox())!;
    const menu = (await toolbar.boundingBox())!;
    expect(menu.x).toBeLessThan(field.x + 180);
    expect(menu.y + menu.height).toBeLessThan(field.y + 22);
    await input.press("Escape");
    await expect(toolbar).toHaveCount(0);
    await input.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
    await expect(toolbar).toHaveCount(0);
  }
  // The app's scaled layout must still produce viewport coordinates.
  await page.setViewportSize({ width: 1000, height: 700 });
  await input.evaluate((element) => {
    element.parentElement!.style.zoom = "0.8";
  });
  await input.fill("Another selected message");
  await input.press("Control+a");
  await expect(toolbar).toBeVisible();
  await input.press("Escape");
  // Empty native range geometry must use a nearby fallback instead of hiding.
  await page.evaluate(() => {
    const original = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      if (this.startContainer.parentElement?.closest('[aria-hidden="true"]'))
        return [] as unknown as DOMRectList;
      return original.call(this);
    };
  });
  await input.click({ clickCount: 3 });
  await expect(toolbar).toBeVisible();
});

test("busy composer keeps Send, Queue and Stop visible with shortcut hints", async ({ page }) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&accounts");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  const queue = page.getByRole("button", {
    name: "Queue message",
    exact: true,
  });
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expectHint(page, send, null, ["Enter"]);
  await expectHint(page, queue, "Queue message", ["Shift", "Tab"]);
  await expectHint(page, stop, "Stop", ["Esc", "Ctrl", "C"]);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
      theme,
    );
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      // A narrow composer gives a draft's Queue and Send the room; Stop keeps its shortcut.
      const narrow = await page
        .locator(".composer-controls")
        .first()
        .evaluate(
          (node) =>
            getComputedStyle(node).getPropertyValue("--composer-settings-in-picker").trim() === "1",
        );
      const shown = narrow ? [queue, send] : [queue, send, stop];
      if (narrow) await expect(stop).toHaveCount(0);
      for (const control of shown) await expect(control).toBeInViewport();
      const bounds = await Promise.all(shown.map((control) => control.boundingBox()));
      for (let index = 1; index < bounds.length; index++)
        expect(bounds[index - 1]!.x + bounds[index - 1]!.width).toBeLessThanOrEqual(
          bounds[index]!.x,
        );
      const plus = await page
        .getByRole("button", { name: "Add files or skills", exact: true })
        .boundingBox();
      const context = await page.locator(".context-meter-summary").boundingBox();
      const last = bounds.at(-1)!;
      for (const box of [plus, context, ...bounds]) {
        expect(box).not.toBeNull();
        expect(Math.abs(box!.height - last.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.y - last.y)).toBeLessThanOrEqual(1);
      }
    }
  }
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(stop).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
});

/** Text actions follow the global default provider, not the conversation's, so the fixture pins it. */
async function useTextActionProvider(page: import("@playwright/test").Page, harness: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("bycoda.lastModel", JSON.stringify({ harness: value, model: "" }));
  }, harness);
}

async function initializeChatLayout(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Math.random = () => 0;
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        convertFileSrc: (path: string) => path,
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (
            new URLSearchParams(location.search).has("picker-root-consumers") &&
            command === "plugin:window|is_maximized"
          )
            return false;
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
}

test("hints reveal with one quiet fade and remain complete when motion is reduced", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&accounts&hint-motion");
  const hint = page.locator(".composer-tips-text");
  await expect(hint).toHaveCount(0);
  await page.locator(".composer-tips-icon").click();
  await expect(hint).toBeVisible();
  const fullText = await hint.getAttribute("aria-label");
  expect((await hint.innerText()).replaceAll(" ", " ")).toBe(fullText);
  // The next tip replaces the text with a single fade, never per-character 3D pieces.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".composer-tips-icon").click();
  const revealing = await hint.evaluate((root) =>
    root
      .getAnimations({ subtree: true })
      .map((animation) => (animation as CSSAnimation).animationName),
  );
  expect(revealing).toEqual(["composer-tip-reveal"]);
  await expect(hint.locator(".composer-tip-fold-piece")).toHaveCount(0);
  await expect(hint.locator("[data-tip-fold]")).toHaveCount(1);
  expect(
    await hint.evaluate((root) =>
      getComputedStyle(root.querySelector("[data-tip-fold]")!).transform.startsWith("matrix3d("),
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("hint-fade.png"),
    animations: "allow",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nextText = await hint.getAttribute("aria-label");
  expect(nextText).not.toBe(fullText);
  expect((await hint.innerText()).replaceAll(" ", " ")).toBe(nextText);
  expect(await hint.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.locator(".composer-tips-cursor")).toHaveCount(0);
});

for (const variant of ["", "&remote", "&project-picker"]) {
  test(`chat context remains at the end of its row ${variant || "local"}`, async ({ page }) => {
    await initializeChatLayout(page);
    await page.goto(`/tests/browser/chat/composer-extras.html?chat-layout&accounts${variant}`);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    const context = page.getByRole("button", { name: /^Context usage/ });
    await expect(context).toBeVisible();
    for (const width of [320, 420, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      // The meter closes the trailing cluster of the toolbar row, right before Send/Stop.
      expect(
        await context.evaluate((button) => {
          const box = button.closest("[data-composer-box]")!.getBoundingClientRect();
          const meter = button.getBoundingClientRect();
          const actions = [
            ...button.closest(".composer-send-controls")!.querySelectorAll("button"),
          ].filter((candidate) => candidate !== button);
          const last = actions[actions.length - 1]!.getBoundingClientRect();
          return (
            meter.left >= box.left &&
            meter.right <= last.left + 1 &&
            last.right <= box.right &&
            Math.abs(meter.top + meter.height / 2 - (last.top + last.height / 2)) < 8
          );
        }),
      ).toBe(true);
      await context.click();
      const dialog = page.getByRole("dialog", {
        name: "Context usage",
        exact: true,
      });
      await expect(dialog).toBeInViewport();
      await expect(page.getByRole("button", { name: "Compact now" })).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(context).toBeFocused();
    }
    await context.click();
    await page.getByRole("button", { name: "Compact now" }).click();
    await expect(page.getByTestId("compacted")).toHaveText("1");
    await expect(input).toHaveValue("Keep this chat draft");
    await expect(page.getByRole("button", { name: "Social Media", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
    await context.click();
    await expect(page.getByRole("button", { name: "Compact now" })).toBeDisabled();
    await page.keyboard.press("Escape");
  });
}

test("chat tips open on demand and preserve controls in narrow and scaled panels", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&accounts&workspace-footer");
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const hint = page.locator(".composer-tips-icon");
  const tipPanel = page.getByRole("dialog", { name: "Chat tips", exact: true });
  const folders = page.getByRole("button", {
    name: "Folders for this session",
    exact: true,
  });
  const footer = page.locator("[data-composer-workspace]");
  const controls = footer.locator("[data-composer-workspace-controls]");
  const checkout = controls.getByLabel("Workspace Current checkout", {
    exact: true,
  });
  const branch = controls.getByRole("button", {
    name: "Branch main",
    exact: true,
  });
  await expect(hint).toHaveText("Tip");
  await expect(hint).toHaveAccessibleName("Tip");
  await expect(hint).toHaveAttribute("aria-expanded", "false");
  await hint.hover();
  await hint.focus();
  await expect(tipPanel).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(tipPanel).toBeVisible();
  await expect(hint).toHaveText("Next tip");
  await page.mouse.move(0, 0);
  await input.focus();
  await expect(tipPanel).toBeVisible();
  await input.click();
  await expect(tipPanel).toHaveCount(0);
  await expect(hint).toHaveText("Tip");
  await expect(footer.locator(":scope > [data-composer-tips]")).toHaveCount(1);
  // In the context row the tip is the last, quietest item.
  expect(
    await footer.evaluate((element) =>
      [...element.children]
        .filter((child) => !child.classList.contains("basis-full"))
        .at(-1)
        ?.hasAttribute("data-composer-tips"),
    ),
  ).toBe(true);
  await expect(checkout).toBeVisible();
  await expect(branch).toBeVisible();
  expect(
    await controls.evaluate((element) => {
      const checkout = element.querySelector('[aria-label="Workspace Current checkout"]')!;
      const branch = element.querySelector('[aria-label="Branch main"]')!;
      const directories = element.querySelector("[data-composer-directories]")!;
      return (
        !!(checkout.compareDocumentPosition(branch) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(branch.compareDocumentPosition(directories) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await input.focus();
      await page.mouse.move(0, 0);
      await expect(tipPanel).toHaveCount(0);
      await expect(input).toBeInViewport();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
      await expect(folders).toBeInViewport();
      await expect(checkout).toBeInViewport();
      await expect(branch).toBeInViewport();
      expect(
        await folders.evaluate(
          (button) => !!button.closest("[data-composer-workspace] [data-composer-directories]"),
        ),
      ).toBe(true);
      await hint.hover();
      await expect(tipPanel).toHaveCount(0);
      await hint.click();
      await expect(tipPanel).toBeInViewport();
      await expect(hint).toHaveText("Next tip");
      await expect(hint).toHaveAccessibleName("Next tip");
      await expect(hint).toHaveAttribute("aria-expanded", "true");
      // The control's name ("Next tip") carries the affordance; the tipPanel holds only the tip.
      expect((await tipPanel.innerText()).trim().length).toBeGreaterThan(20);
      const previous = await tipPanel.innerText();
      await hint.click();
      await expect(tipPanel).not.toHaveText(previous!);
      const next = await tipPanel.innerText();
      await hint.click();
      await expect(tipPanel).not.toHaveText(next!);
      if (theme === "dark" && width === 1024) {
        await page.screenshot({
          path: testInfo.outputPath("chat-tip-open.png"),
          animations: "disabled",
        });
      }
      await page.keyboard.press("Escape");
      await expect(tipPanel).toHaveCount(0);
      await expect(hint).toHaveText("Tip");
      await expect(hint).toHaveAttribute("aria-expanded", "false");
      await hint.hover();
      await hint.focus();
      await expect(tipPanel).toHaveCount(0);
      await expect(input).toHaveValue("Keep this chat draft");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`chat-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  for (const zoom of [1.25, 1.5]) {
    await page.locator("main").evaluate((main, scale) => {
      main.style.inlineSize = "420px";
      main.style.zoom = String(scale);
    }, zoom);
    await hint.click();
    await expect(tipPanel).toBeInViewport();
    await expect(folders).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("composer access keeps the icon button size when opened", async ({ page }) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&workspace-footer");
  const access = page.locator("[data-access-picker-trigger]");
  await access.click();
  await page.getByRole("option", { name: /^Full access / }).click();
  const label = access.locator(":scope > span:not([aria-hidden])");
  const chevron = access.locator(":scope > svg");
  await expectHint(page, access, /^Full access$/, null);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("Keep this draft");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("theme-light", value === "light");
    }, theme);
    for (const width of [458, 520, 800, 1280]) {
      await page.setViewportSize({ width: width < 560 ? 1280 : width, height: 800 });
      await page.locator("main").evaluate((main, size) => {
        main.style.inlineSize = `${size}px`;
      }, width);
      await expect(access).toHaveAccessibleName("Full access");
      await expect(access.locator(":scope > span[aria-hidden]")).toBeVisible();
      await expect(label).toBeHidden();
      await expect(chevron).toBeHidden();
      await expect(access).toHaveCSS("border-top-width", "0px");
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `temp/verification/composer-access/${theme}-${width}-closed.png`,
        animations: "disabled",
      });
      const model = page
        .locator('[data-composer-model-controls] button[aria-haspopup="dialog"]')
        .first();
      const modelBounds = (await model.boundingBox())!;
      const accessBounds = (await access.boundingBox())!;
      expect(
        Math.abs(modelBounds.y + modelBounds.height / 2 - accessBounds.y - accessBounds.height / 2),
      ).toBeLessThan(2);
      await expect(input).toHaveValue("Keep this draft");
      await expect(access).toBeInViewport();
      if (width >= 800) {
        await access.click();
        await expect(access).toHaveAttribute("aria-expanded", "true");
        await expect(label).toBeHidden();
        await expect(chevron).toBeHidden();
        await expect(access).toHaveCSS("border-top-width", "0px");
        expect(await access.boundingBox()).toEqual(accessBounds);
        await expect(page.getByRole("option", { name: /^Full access / })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await page.screenshot({
          path: `temp/verification/composer-access/${theme}-${width}-open.png`,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
      }
    }
  }
  await page.locator("main").evaluate((main) => {
    main.style.inlineSize = "458px";
  });
  await access.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: /^Supervised / }).click();
  await expect(access).toHaveAccessibleName("Supervised");
  await expect(label).toBeHidden();
  await expect(input).toHaveValue("Keep this draft");
});

test("chat busy actions explain steering and queuing without losing the draft", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&accounts");
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toContainText("Steer");
  await page.getByRole("button", { name: "Use queue", exact: true }).click();
  await expect(send).toContainText("Steer");
  await page.getByRole("button", { name: "Use steer", exact: true }).click();
  await expect(send).toContainText("Steer");
  await input.fill("/plan Review this change");
  await expect(send).toContainText("Queue message");
  await input.fill("Keep my work");
  await expect(send).toContainText("Steer");
  await expectHint(page, send, null, ["Enter"]);
  await expectHint(
    page,
    page.getByRole("button", { name: "Queue message", exact: true }),
    "Queue message",
    ["Shift", "Tab"],
  );
  await expectHint(page, page.getByRole("button", { name: "Stop", exact: true }), "Stop", [
    "Esc",
    "Ctrl",
    "C",
  ]);
  for (const width of [320, 420, 1000]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(send).toBeInViewport();
    // The composer collapses controls from a resize observer, a frame after the viewport changes,
    // so the width is read until it settles instead of once.
    await expect
      .poll(() =>
        page
          .locator("[data-composer-box]")
          .evaluate((box) => box.scrollWidth <= box.clientWidth + 1),
      )
      .toBe(true);
  }
  await expect(page.locator("[data-activity-dock]")).toBeVisible();
  // The summary row never paints a patch over the dock it sits in: it is transparent (or matches).
  const dockBackground = await page
    .locator("[data-activity-dock]")
    .evaluate((dock) => getComputedStyle(dock).backgroundColor);
  expect(["rgba(0, 0, 0, 0)", "transparent", dockBackground]).toContain(
    await page
      .locator(".activity-dock-summary")
      .evaluate((summary) => getComputedStyle(summary).backgroundColor),
  );
  await page.setViewportSize({ width: 420, height: 800 });
  await page.screenshot({
    path: testInfo.outputPath("chat-working.png"),
    animations: "disabled",
  });
  await input.fill("");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await input.fill("Keep my work");
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await expect(stop).toBeEnabled();
  await expect(input).toHaveValue("Keep my work");
  await stop.click();
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  // The fixture transcript is at its end, so the finished turn has nothing unseen to report:
  // the dock leaves while the "done" state stays covered by ActivityDock.test.ts.
  await expect(page.locator("[data-activity-dock]")).toHaveCount(0);
  await input.fill("My next request");
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await expect(input).toHaveValue("My next request");
  await expect(input).toBeDisabled();
});

for (const renderer of ["auto", "shader-failure", "context-loss"] as const) {
  test(`welcome crew stays transparent with ${renderer}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1059, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("bycoda.language", "en");
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          metadata: {
            currentWebview: { label: "fixture" },
            currentWindow: { label: "fixture" },
          },
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string) => {
            if (command === "plugin:event|listen") return 1;
            if (command === "plugin:event|unlisten") return;
            throw new Error(`No native host in composer fixture: ${command}`);
          },
        },
      });
      if (mode !== "auto") {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof getContext>) {
          const context = getContext.apply(this, args);
          if (args[0] === "webgl" && context) {
            const gl = context as WebGLRenderingContext;
            if (mode === "shader-failure") gl.getProgramParameter = () => false;
            else gl.isContextLost = () => true;
          }
          return context;
        } as typeof getContext;
      }
    }, renderer);
    await page.goto("/tests/browser/chat/composer-extras.html?welcome&crew");
    const canvas = page.locator(".bycoda-empty .crew-scene canvas:not(.crew-scene__still)");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        canvas.evaluate((surface: HTMLCanvasElement) => {
          const context = surface.getContext("2d");
          if (!context) return false;
          const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
          let painted = 0;
          let transparent = 0;
          for (let index = 3; index < pixels.length; index += 400) {
            if (pixels[index] === 0) transparent++;
            else painted++;
          }
          return pixels[3] === 0 && painted > 0 && transparent > painted;
        }),
      )
      .toBe(true);
    const containedLabels = await page.locator(".crew-scene").evaluate((scene) => {
      const bottom = scene.getBoundingClientRect().bottom;
      return [...scene.querySelectorAll(".crew-scene__label")].every(
        (label) => label.getBoundingClientRect().bottom <= bottom + 1,
      );
    });
    expect(containedLabels).toBe(true);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Keep my Wallet draft");
    await expect(input).toHaveValue("Keep my Wallet draft");
    await expect(input).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`welcome-crew-${renderer}.png`),
      fullPage: true,
    });
  });
}

test("welcome and working labels stay readable in narrow panels and both themes", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
  await page.goto("/tests/browser/chat/composer-extras.html");
  const label = page.getByRole("status").filter({ hasText: "Chat composer · provider options" });
  await expect(label).toBeVisible();
  await expect(label.getByText("Chat composer · provider options", { exact: true })).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(label).toHaveCSS("animation-name", /working-signal/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(label).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await label.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgba(0, 0, 0, 0)");
  await page.goto("/tests/browser/chat/composer-extras.html?footer");
  await page.setViewportSize({ width: 320, height: 800 });
  const footer = page.locator('footer[aria-label="Provider usage"]');
  const terminal = footer.getByRole("button", { name: /New Terminal/ });
  await expect(terminal).toBeInViewport();
  for (const button of [
    terminal,
    footer.getByRole("button", { name: "Conversation tools", exact: true }),
  ]) {
    const box = await button.boundingBox();
    expect(box?.width).toBe(28);
    expect(box?.height).toBe(28);
    await expect(button.locator("svg")).toBeVisible();
  }
  await expect(
    footer.getByRole("button", { name: "Conversation tools", exact: true }),
  ).toBeInViewport();
  expect(await footer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await footer.locator("[data-provider-usage]").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(terminal).toBeInViewport();
  await terminal.click();
  await expect(page.getByTestId("terminal-opened")).toHaveText("true");
  await page.screenshot({ path: testInfo.outputPath("footer-320.png") });
  await page.goto("/tests/browser/chat/composer-extras.html?welcome");
  const title = page.getByRole("heading", { level: 2 });
  await expect(title).toContainText("a-long-project-name");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1100, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`welcome-${theme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.locator("main").evaluate((el) => {
    el.style.inlineSize = "420px";
  });
  expect(
    await page.locator(".bycoda-empty").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("welcome-split-panel.png"),
  });
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`projectless session entry ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`/tests/browser/chat/composer-extras.html?welcome&no-project&theme=${theme}`);
      const project = page.getByRole("button", { name: "Open a project", exact: true });
      const guide = page.getByRole("button", { name: "Guide", exact: true });
      await expect(project).toBeInViewport();
      await expect(guide).toBeInViewport();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
      await page.screenshot({ path: `temp/verification/new-window-entry/${theme}-${width}.png` });

      await page.evaluate(() => {
        window.addEventListener("bycoda:guide-action", (event) => {
          document.body.dataset.guideAction = (event as CustomEvent<string>).detail;
        });
        window.addEventListener("bycoda:open-usage-guide", () => {
          document.body.dataset.guideOpened = "true";
        });
      });
      await project.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-guide-action", "open-project");
      await guide.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-guide-opened", "true");
    });
  }
}

test("composer shows the account name when it fits and keeps narrow controls aligned", async ({
  page,
}) => {
  await initializeChatLayout(page);
  for (const theme of ["dark", "light"]) {
    for (const width of [420, 320, 800, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts&workspace-footer&theme=${theme}${width === 320 ? "&long-account" : ""}`,
      );
      const box = page.locator("[data-composer-box]");
      const trigger = box.locator("[data-composer-model-controls] button[aria-haspopup]").first();
      const access = box.locator("[data-access-picker-trigger]");
      const mode = box.locator("[data-composer-mode-trigger]");
      const add = box.getByRole("button", { name: "Add files or skills" });
      const send = box.getByRole("button", { name: "Send", exact: true });
      const selectWork = width === 420 || width === 800;
      if (selectWork) {
        await trigger.click();
        const picker = page.getByRole("dialog", { name: "Model and settings", exact: true });
        await picker.getByRole("radio", { name: /^work\b/ }).click();
        if (width === 800) {
          const selected = picker.getByRole("option", { selected: true }).locator("..");
          const indicator = await selected.evaluate((row) => {
            const style = getComputedStyle(row, "::before");
            return { width: style.inlineSize, color: style.backgroundColor };
          });
          expect(indicator.width).toBe("2px");
          expect(indicator.color).not.toBe("rgba(0, 0, 0, 0)");
          await picker.screenshot({
            path: `temp/verification/composer-account-layout/picker-${theme}-800.png`,
          });
        }
        await page.keyboard.press("Escape");
        await expect(picker).toHaveCount(0);
      }
      const name = selectWork ? "work" : "personal";
      await expect(trigger.locator("[data-model-trigger-name]")).toHaveText("Sonnet 5");
      const accountName = trigger.locator("[data-model-account]");
      if (width <= 420) await expect(accountName).toBeHidden();
      else {
        await expect(accountName).toBeVisible();
        await expect(accountName).toHaveText(name);
      }
      await expect(trigger).toHaveAccessibleName(new RegExp(`Account: ${name}`));
      const icon = trigger.locator("[data-model-provider-icon]");
      const number = icon.locator("[data-model-account-number]");
      await expect(number).toHaveText(selectWork ? "2" : "1");
      const iconBounds = (await icon.boundingBox())!;
      const numberBounds = (await number.boundingBox())!;
      expect(numberBounds.x + numberBounds.width / 2).toBeGreaterThan(
        iconBounds.x + iconBounds.width,
      );
      expect(numberBounds.y).toBeLessThan(iconBounds.y);
      const model = (await trigger.boundingBox())!;
      const modelCenter = model.y + model.height / 2;
      if (width === 320) {
        await expect(access).toHaveCount(0);
        await expect(mode).toHaveCount(0);
      } else {
        for (const control of [access, mode]) {
          const bounds = (await control.boundingBox())!;
          expect(bounds.y + bounds.height / 2).toBeCloseTo(modelCenter, 0);
        }
      }
      await expect(send).toBeInViewport();
      await expect(add).toBeInViewport();
      if (width <= 420) {
        const addBounds = (await add.boundingBox())!;
        const sendBounds = (await send.boundingBox())!;
        expect(Math.abs(addBounds.y + addBounds.height / 2 - modelCenter)).toBeLessThanOrEqual(1);
        expect(Math.abs(sendBounds.y + sendBounds.height / 2 - modelCenter)).toBeLessThanOrEqual(1);
        expect(addBounds.x).toBeGreaterThanOrEqual(model.x + model.width);
      }
      expect(await box.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
        1,
      );
      await box.screenshot({
        path: `temp/verification/composer-account-layout/${theme}-${width}.png`,
      });
      if (width === 1280) {
        await page.locator("main").evaluate((node) => {
          node.style.inlineSize = "420px";
        });
        await expect(accountName).toBeHidden();
        await expect(trigger).toHaveAccessibleName(new RegExp(`Account: ${name}`));
      }
    }
  }
});

test("narrow composer keeps Add and Send on the model row when text is wider than the fixture font", async ({
  page,
}) => {
  await initializeChatLayout(page);
  for (const width of [320, 360, 420]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(
      `/tests/browser/chat/composer-extras.html?chat-layout&accounts&workspace-footer&theme=dark${width === 320 ? "&long-account" : ""}`,
    );
    // Wider glyphs on every platform, as a Linux system font renders the same labels.
    await page.addStyleTag({ content: "[data-composer-box] { letter-spacing: 0.08em; }" });
    const box = page.locator("[data-composer-box]");
    const trigger = box.locator("[data-composer-model-controls] button[aria-haspopup]").first();
    await expect(trigger.locator("[data-model-trigger-name]")).toHaveText("Sonnet 5");
    const add = box.getByRole("button", { name: "Add files or skills" });
    const send = box.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeInViewport();
    const centers = async () =>
      Promise.all(
        [trigger, add, send].map(async (item) => {
          const bounds = (await item.boundingBox())!;
          return bounds.y + bounds.height / 2;
        }),
      );
    await expect
      .poll(async () => {
        const [model, addY, sendY] = await centers();
        return Math.max(Math.abs(addY - model), Math.abs(sendY - model));
      })
      .toBeLessThanOrEqual(1);
    // One row: the model name gives way before Send does.
    const rows = await box.locator(".composer-controls").evaluate((row) => row.clientHeight);
    expect(rows).toBeLessThanOrEqual(40);
    expect(await box.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      1,
    );
  }
});

test("a long model name truncates without hiding or overlapping any narrow composer control", async ({
  page,
}) => {
  await initializeChatLayout(page);
  const longName = "Claude Sonnet research model with a deliberately long descriptive name";
  for (const width of [390, 360, 320, 260]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(
      "/tests/browser/chat/composer-extras.html?chat-layout&accounts&workspace-footer&theme=dark",
    );
    const box = page.locator("[data-composer-box]");
    const trigger = box.locator("[data-composer-model-controls] button[aria-haspopup]").first();
    await expect(trigger.locator("[data-model-trigger-name]")).toHaveText("Sonnet 5");
    await trigger
      .locator("[data-model-trigger-name]")
      .evaluate((node, text) => void (node.textContent = text), longName);
    const toolbarMode = box.locator("[data-composer-mode-trigger]");
    const toolbarAccess = box.locator("[data-access-picker-trigger]");
    const inToolbar = (await toolbarMode.count()) > 0;
    const controls = [
      trigger,
      ...(inToolbar ? [toolbarAccess, toolbarMode] : []),
      box.getByRole("button", { name: "Add files or skills" }),
      box.getByRole("button", { name: "Send", exact: true }),
    ];
    for (const control of controls) await expect(control).toBeInViewport({ ratio: 1 });
    const geometry = await Promise.all(controls.map((control) => control.boundingBox()));
    for (const [index, bounds] of geometry.entries()) {
      expect(
        bounds!.width,
        `control ${index} keeps a hit target at ${width}px`,
      ).toBeGreaterThanOrEqual(24);
      for (const other of geometry.slice(index + 1)) {
        const apart =
          bounds!.x + bounds!.width <= other!.x + 0.5 ||
          other!.x + other!.width <= bounds!.x + 0.5 ||
          bounds!.y + bounds!.height <= other!.y + 0.5 ||
          other!.y + other!.height <= bounds!.y + 0.5;
        expect(apart, `controls do not overlap at ${width}px`).toBe(true);
      }
    }
    // Every control receives the pointer at its own centre, not a neighbour's glyph.
    for (const control of controls) {
      expect(
        await control.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          );
          return hit === node || node.contains(hit);
        }),
      ).toBe(true);
    }
    // The name gives way, and Mode opens through a real click.
    expect(
      await trigger
        .locator("[data-model-trigger-name]")
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    const panel = page.getByRole("dialog", { name: "Model and settings" });
    if (!inToolbar) await trigger.click();
    const mode = inToolbar ? toolbarMode : panel.getByRole("button", { name: "Mode", exact: true });
    await mode.click();
    await expect(page.getByRole("menu", { name: "Mode", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    if (!inToolbar) await page.keyboard.press("Escape");
    expect(await box.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      1,
    );
    if (width >= 320) {
      const centers = geometry.map((bounds) => bounds!.y + bounds!.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    }
  }
});

test("model picker names and selects accounts and session shows its active agent", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?accounts");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  await expect(main).toHaveAccessibleName(/Account: personal/);
  await main.click();
  const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  await expect(panel).toBeVisible();
  // Two accounts stay in view above a single copy of the model list.
  const account = panel.getByRole("radiogroup", { name: "Account", exact: true });
  const personal = account.getByRole("radio", { name: /^personal\b/ });
  const work = account.getByRole("radio", { name: /^work\b/ });
  await expect(personal).toBeVisible();
  await expect(work).toBeVisible();
  await expect(personal).toBeChecked();
  const opus = panel.getByRole("option", { name: "Claude Opus 5.5", exact: true });
  await expect(opus).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("account-model-picker.png"),
    animations: "disabled",
  });
  const personalRow = (await personal.boundingBox())!;
  const workRow = (await work.boundingBox())!;
  expect(workRow.y).toBeGreaterThanOrEqual(personalRow.y + personalRow.height);
  expect(workRow.x).toBeCloseTo(personalRow.x);
  expect(workRow.width).toBeCloseTo(personalRow.width);
  await opus.click();
  await expect(panel).toBeVisible();
  await work.click();
  await expect(work).toBeChecked();
  await expect(main).toContainText("Opus 5.5");
  await expect(main).toHaveAccessibleName(/Account: work/);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator("[data-session-agent]")).toContainText(
    "Claude Code · Claude Opus 5.5 work",
  );
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await expect(page.locator("[data-session-agent]")).toHaveAttribute(
    "aria-label",
    /^Running agent:/,
  );
  const tips = page.locator(".composer-tips-icon");
  await tips.click();
  await expect(page.getByRole("dialog", { name: "Chat tips", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Chat tips", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-session-agent]")).toHaveAttribute(
    "aria-label",
    /^Running agent:/,
  );
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
  await page.screenshot({
    path: testInfo.outputPath("session-running-account.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator("[data-session-agent]")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("chat edits model settings from one panel at narrow and wide sizes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  const panel = page.getByRole("dialog", {
    name: "Model and settings",
    exact: true,
  });
  const settingsColumn = panel.locator("[data-model-settings]");
  // A setting's options: radio rows, segmented radios or subagent checkboxes.
  const setting = (name: string) =>
    settingsColumn.locator(
      `[role="radiogroup"][aria-label="${name}"], [role="group"][aria-label="${name}"]`,
    );
  const option = (name: string, label: string | RegExp) =>
    setting(name)
      .getByRole("radio", { name: label, exact: true })
      .or(setting(name).getByRole("checkbox", { name: label, exact: true }));
  // Delegation values are encoded refs inside the settings record.
  const delegation = async () => {
    const { settings } = JSON.parse((await page.getByTestId("choice").textContent()) ?? "{}");
    const decode = (value?: string) => (value ? JSON.parse(value) : null);
    return {
      advisor: decode(settings.crossAdvisor)?.model ?? null,
      subagents: ([] as { model: string }[])
        .concat(decode(settings.crossSubagents) ?? [])
        .map((ref) => ref.model),
    };
  };
  const agentsTab = panel.getByRole("tab", { name: /^Agents/ });
  const openPanel = async (tab?: "agents") => {
    if (!(await panel.isVisible())) await main.click();
    await expect(panel).toBeVisible();
    if (tab) await agentsTab.click();
  };
  const choose = async (name: string, label: string | RegExp, tab?: "agents") => {
    await openPanel(tab);
    await option(name, label).click();
    // Picking a setting keeps the panel open.
    await expect(panel).toBeVisible();
    await expect(option(name, label)).toHaveAttribute("aria-checked", "true");
  };
  await expect(main).toBeInViewport();
  await expect(main).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.getByRole("button", { name: "Extras", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  const advisor = settingsColumn.locator('[data-setting-id="crossAdvisor"]');
  const advisorField = advisor.locator("button[aria-haspopup=dialog]");
  // Advisor opens beside the models. The batch editor uses the browser column.
  const delegate = async (name: "Advisor" | "Subagents", label: RegExp) => {
    await openPanel("agents");
    const picker = panel.locator("[data-model-setting-picker]");
    if (name === "Advisor") await advisorField.click();
    else {
      // Automatic has no manual list yet. Custom opens the shared model picker.
      const custom = settingsColumn.getByRole("radio", { name: "Custom", exact: true });
      await custom.click();
    }
    await expect(picker).toBeVisible();
    const choice = picker.getByRole("option", { name: label });
    await choice.click();
    if (name === "Subagents")
      await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker).toHaveCount(0);
  };
  await delegate("Advisor", /^Claude Opus 5\.5\b/);
  await expect(advisor).toContainText("Claude Opus 5.5");
  await delegate("Subagents", /^Haiku 4\.5\b/);
  await expect(page.getByTestId("choice")).toContainText('"model":"claude:sonnet-5"');
  await expect
    .poll(delegation)
    .toEqual({ advisor: "claude:opus-5-5", subagents: ["claude:haiku-4.5"] });
  await expect(panel).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("chat-model-settings-320px.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await openPanel("agents");
  // Settings can be queued for the next turn while an agent is running.
  await expect(advisorField).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await openPanel("agents");
  const lockedRows = settingsColumn.locator(
    '[data-setting-id] [role="radio"], [data-setting-id] [role="checkbox"]',
  );
  await expect(lockedRows.first()).toBeDisabled();
  expect(
    await lockedRows.evaluateAll((rows) =>
      rows.every((row) => (row as HTMLButtonElement).disabled),
    ),
  ).toBe(true);
  // Keyboard activation must respect the same lock as pointer input: locked rows take no focus
  // and Enter/Space change nothing.
  const before = await page.getByTestId("choice").textContent();
  await agentsTab.focus();
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        // The scrollable chip list is a browser-focusable scroller, not a locked control.
        Boolean(
          document.activeElement?.matches(
            "button:not([aria-haspopup=dialog]), input, select, [role=radio], [role=checkbox]",
          ) && document.activeElement.closest("[data-model-settings] [data-setting-id]"),
        ),
      ),
    ).toBe(false);
  }
  await agentsTab.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("choice")).toHaveText(before ?? "");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();

  await page.getByRole("button", { name: "codex", exact: true }).click();
  await openPanel();
  // The panel reads top-down: Reasoning leads, then Service Tier.
  expect(
    await settingsColumn
      .locator('[data-setting-id] [role="radiogroup"]')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute("aria-label"))),
  ).toEqual(["Reasoning", "Service Tier"]);
  await expect(option("Reasoning", "Medium")).toHaveAttribute("aria-checked", "true");
  await expect(option("Service Tier", "Standard")).toHaveAttribute("aria-checked", "true");
  // Claude-only rows stay off Codex; the cross-provider delegation rows live on the Agents tab.
  await expect(setting("Subagent model policy")).toHaveCount(0);
  await expect(setting("Advisor")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-settings-320px.png"),
    animations: "disabled",
  });
  await agentsTab.click();
  await expect(advisorField).toBeVisible();
  await expect(setting("Subagent model policy")).toHaveCount(0);
  await panel.getByRole("tab", { name: "Settings", exact: true }).click();
  await choose("Reasoning", "High");
  await choose("Service Tier", "Fast");
  await page.keyboard.press("Escape");
  await expect(main).toContainText("High");
  await expect(page.getByTestId("choice")).toContainText('"serviceTier":"fast"');
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPanel();
  await choose("Service Tier", "Ultrafast");
  await expect(page.getByTestId("choice")).toContainText('"serviceTier":"ultrafast"');
  await expect(option("Service Tier", "Ultrafast")).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-ultrafast-dark.png"),
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.classList.add("theme-light"));
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-ultrafast-light.png"),
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.classList.remove("theme-light"));
  // Models and settings share one panel; its search drives the listbox, so it is a combobox.
  await expect(panel.getByRole("listbox", { name: "Models", exact: true })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Search models", exact: true })).toBeVisible();
  await expect(page.locator("[data-model-extras-entry]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "grok", exact: true }).click();
  await openPanel();
  await expect(setting("Reasoning")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "gemini", exact: true }).click();
  await openPanel();
  await expect(panel.getByRole("listbox", { name: "Models", exact: true })).toBeVisible();
  await expect(settingsColumn).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
});

test("model panel stays inside the viewport", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?accounts");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  await expect(main).toContainText("personal");
  await main.click();
  const panel = page.getByRole("dialog", {
    name: "Model and settings",
    exact: true,
  });
  await expect(panel).toHaveCSS("--layout-height", "460px");
  await expect.poll(async () => (await panel.boundingBox())?.height).toBeGreaterThanOrEqual(450);
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(460);
  for (const viewport of [
    { width: 661, height: 761 },
    { width: 320, height: 480 },
    { width: 1000, height: 800 },
    { width: 1280, height: 800 },
    { width: 800, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(panel).toBeInViewport();
    const help = panel.locator("[data-model-setting-help]");
    const helpHeight = (await help.boundingBox())!.height;
    await expect(help.getByRole("button", { name: "Model settings", exact: true })).toBeVisible();
    await expect(help.locator("[data-model-provider-settings]")).toBeVisible();
    const lineHeight = await help
      .locator("p")
      .evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
    expect(helpHeight).toBeLessThanOrEqual(lineHeight * 2 + 16);
    await help.hover();
    expect(Math.abs((await help.boundingBox())!.height - helpHeight)).toBeLessThanOrEqual(1);
    // The panel and its rail, model list and settings column all fit the viewport.
    await expect
      .poll(() =>
        panel.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const inside = (selector: string) => {
            const child = el.querySelector(selector);
            if (!child) return false;
            const rect = child.getBoundingClientRect();
            return rect.left >= box.left - 1 && rect.right <= box.right + 1;
          };
          return (
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight &&
            el.scrollWidth <= el.clientWidth + 1 &&
            inside('[role="tablist"]') &&
            inside('[role="listbox"]') &&
            inside("[data-model-settings]")
          );
        }),
      )
      .toBe(true);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
      }, theme === "light");
      await page.screenshot({
        path: testInfo.outputPath(`model-panel-fixed-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.screenshot({
    path: testInfo.outputPath("model-panel-fixed.png"),
    animations: "disabled",
  });
});

test("independent scalar model settings preserve the draft caret and sibling values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?scalar");
  const draft = page.getByRole("textbox", {
    name: "Scalar draft",
    exact: true,
  });
  await draft.focus();
  await draft.evaluate((node) => node.setSelectionRange(3, 8));
  const effort = page.getByRole("button", {
    name: /^(Effort|Reasoning): Medium$/,
  });
  await expect(effort).toHaveAttribute("aria-haspopup", "dialog");
  await effort.click();
  await expect(page.getByRole("listbox")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(draft).toBeFocused();
  expect(await draft.evaluate((node) => [node.selectionStart, node.selectionEnd])).toEqual([3, 8]);
  await expect(page.getByTestId("scalar-settings")).toContainText('"reasoningEffort":"high"');
  const tier = page.getByRole("button", {
    name: "Service Tier: Standard",
    exact: true,
  });
  await tier.click();
  await expect(page.getByRole("listbox")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("scalar-settings")).toContainText('"reasoningEffort":"high"');
  await expect(page.getByTestId("scalar-settings")).toContainText('"serviceTier":"ultrafast"');
  await expect(draft).toHaveValue("Preserve this draft");
  await expect(draft).toBeFocused();
});

test("external drop: the composer shows one mark and one badge that names the attach action", async ({
  page,
}) => {
  // A dropped image is saved through the native attachment store before it joins
  // the draft; only that write is stood in for, with an isolated path.
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string, args?: { name?: string }) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:event|unlisten") return;
          if (command === "write_attachment") return `C:/isolated-fixture/${args?.name}`;
          throw new Error(`No native host in composer fixture: ${command}`);
        },
      },
    });
  });
  await page.goto("/tests/browser/chat/composer-extras.html");
  const box = page.locator("[data-composer-box]").first();
  await expect(box).toBeVisible();

  // Dragging text is not a file drop: no mark, no badge.
  await textDrag(box, "dragover");
  await expect(dropBadge(page)).toHaveCount(0);
  await expect(dropMarks(page)).toHaveCount(0);

  await fileDrag(box, "dragover", files(3));
  await expect(box).toHaveAttribute("data-drop-indicator", "inside");
  await expect(dropMarks(page)).toHaveCount(1);
  await expect(dropBadge(page)).toHaveCount(1);
  await expect(dropBadge(page)).toHaveText("Attach 3 files");
  await expect(dropAnnouncer(page)).toHaveText("Attach 3 files");
  // The old in-box instruction is gone: the badge is the only sentence.
  await expect(box).not.toContainText("Drop files to attach");
  for (const light of [false, true]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    await page.screenshot({
      path: `temp/verification/vis-dnd-4/composer-attach-3-${light ? "light" : "dark"}.png`,
    });
  }

  // Every way a drag can end clears both.
  await page.keyboard.press("Escape");
  await expect(dropBadge(page)).toHaveCount(0);
  await expect(dropMarks(page)).toHaveCount(0);
  await fileDrag(box, "dragover", files(1));
  await expect(dropBadge(page)).toHaveText("Attach 1 file");
  await fileDrag(box, "dragleave", files(1), { x: 1, y: 1 });
  await expect(dropMarks(page)).toHaveCount(0);
  await fileDrag(box, "dragover", files(1));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(dropBadge(page)).toHaveCount(0);

  // Dropping attaches and clears the feedback.
  await fileDrag(box, "dragover", files(1));
  await fileDrag(box, "drop", [{ name: "dropped.png", type: "image/png" }]);
  await expect(dropBadge(page)).toHaveCount(0);
  await expect(dropMarks(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open dropped.png", exact: true })).toBeVisible();

  // More files than a draft can hold: the badge says how many will be kept.
  await fileDrag(box, "dragover", files(25));
  await expect(dropBadge(page)).toHaveText("Attach 19 of 25 files");
  await page.keyboard.press("Escape");
  await expect(dropBadge(page)).toHaveCount(0);
});

test("external drop: a composer that cannot take attachments says why instead of offering the drop", async ({
  page,
}) => {
  await page.goto("/tests/browser/chat/composer-extras.html?no-attachments");
  const box = page.locator("[data-composer-box]").first();
  await expect(box).toBeVisible();
  await fileDrag(box, "dragover", files(2));
  await expect(box).toHaveAttribute("data-drop-indicator", "blocked");
  await expect(dropBadge(page)).toHaveText("This provider does not support attachments");
  await expect(dropBadge(page)).toHaveAttribute("data-action", "blocked");
  for (const light of [false, true]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    await page.screenshot({
      path: `temp/verification/vis-dnd-4/composer-blocked-${light ? "light" : "dark"}.png`,
    });
  }
  await fileDrag(box, "dragleave", files(2), { x: 1, y: 1 });
  await expect(dropMarks(page)).toHaveCount(0);
});

test("model picker selects image models under Agents in both themes and widths", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await initializeChatLayout(page);
  for (const [width, scheme] of [
    [1280, "light"],
    [1280, "dark"],
    [800, "light"],
    [800, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/tests/browser/chat/composer-extras.html?chat-layout", {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      scheme === "light",
    );
    await page
      .getByRole("button", { name: /^Claude Code/ })
      .first()
      .click();
    const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: /^Agents/ }).click();
    const row = panel.locator('[data-setting-id="imageModels"]');
    await expect(row).toContainText("Image models");
    await expect(row).toContainText("Automatic");
    await row.locator("[data-model-setting-add]").click();
    const imageModel = panel.getByRole("option", { name: /Nano Banana/ });
    await imageModel.click();
    await expect(imageModel).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("choice")).toContainText('"imageModels":"[\\"antigravity');
    await page.screenshot({
      path: `temp/verification/image-models/picker-${width}-${scheme}.png`,
    });
  }
});

test("model picker aligns account rows and keeps quota readable in both themes and widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  for (const width of [1280, 800]) {
    for (const theme of ["light", "dark"]) {
      for (const count of [2, 3]) {
        await page.setViewportSize({ width, height: 850 });
        await page.goto(
          `/tests/browser/chat/composer-extras.html?chat-layout&accounts=${count}&account-usage&stale-usage&theme=${theme}`,
        );
        await page.locator("[data-composer-model-controls] button[aria-haspopup]").first().click();
        const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
        if (count === 3) {
          const trigger = panel.locator("[data-model-account-menu]");
          const account = trigger.getByText("personal", { exact: true });
          const quota = trigger.getByText("92% remaining", { exact: true });
          await expect(quota).toBeVisible();
          const accountBox = (await account.boundingBox())!;
          const quotaBox = (await quota.boundingBox())!;
          const triggerBox = (await trigger.boundingBox())!;
          expect(quotaBox.x).toBeGreaterThanOrEqual(accountBox.x + accountBox.width);
          expect(triggerBox.x + triggerBox.width - (quotaBox.x + quotaBox.width)).toBeLessThan(60);
          await panel.screenshot({
            path: `temp/verification/model-account-rows/header-${theme}-${width}.png`,
            animations: "disabled",
          });
          await trigger.click();
          await expect(trigger).toHaveAccessibleName("Accounts");
        }
        const rows = panel.locator("[data-model-account-list]").getByRole("radio");
        await expect(rows).toHaveCount(count);
        await expect(rows.first()).toBeChecked();
        await expect(rows.first()).toContainText("92% remaining");
        await expect(rows.nth(1)).toContainText("47% remaining");
        await expect(rows.nth(1).getByRole("meter")).toHaveAttribute("aria-valuenow", "47");
        await expect(rows.nth(1)).toContainText(/Refresh failed. Updated 2[45]m ago/);
        await expect(rows.last()).toBeInViewport();
        const first = (await rows.first().boundingBox())!;
        const last = (await rows.last().boundingBox())!;
        expect(last.y).toBeGreaterThanOrEqual(first.y + first.height);
        expect(last.x).toBeCloseTo(first.x);
        expect(last.width).toBeCloseTo(first.width);
        await panel.screenshot({
          path: `temp/verification/model-account-rows/${count}-${theme}-${width}.png`,
          animations: "disabled",
        });
        if (count === 2) {
          await panel
            .getByRole("listbox", { name: "Models" })
            .getByRole("option")
            .last()
            .scrollIntoViewIfNeeded();
          expect((await rows.first().boundingBox())!.y).toBeCloseTo(first.y);
          await rows.first().focus();
          await rows.first().press("ArrowDown");
          await expect(rows.nth(1)).toBeChecked();
          await expect(rows.nth(1)).toBeFocused();
        } else {
          await expect(rows.last()).toContainText("0% remaining");
        }
      }
    }
  }
});

test("remote model picker selects a Host account in both themes and widths", async ({ page }) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 800]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts&remote&remote-accounts&theme=${theme}`,
      );
      const trigger = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
      await trigger.click();
      const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
      await expect(panel.locator("[data-model-account-menu]")).toHaveAccessibleName("Accounts");
      await panel.locator("[data-model-account-menu]").click();
      const list = panel.locator("[data-model-account-list]");
      await expect(list.getByRole("radio")).toHaveCount(3);
      await expect(list.getByRole("radio", { name: /^Host default/ })).toHaveCount(0);
      await expect(list.getByRole("radio", { checked: true })).toHaveCount(0);
      await expect(list.getByRole("radio", { name: "work", exact: true })).toHaveCount(0);
      await panel.screenshot({
        path: `temp/verification/remote-provider-accounts/picker-${width}-${theme}.png`,
      });
      await list.getByRole("radio", { name: /^Mac work/ }).click();
      await expect(trigger).toHaveAccessibleName(/Account: Mac work/);
    }
  }
});

test("saved subagent rows show only model and account names", async ({ page }) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 800]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts=2&saved-subagents&theme=${theme}`,
      );
      await page
        .getByRole("button", { name: /^Claude Code/ })
        .first()
        .click();
      const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
      await panel.getByRole("tab", { name: "Agents", exact: true }).click();
      const selected = panel.getByRole("group", { name: "Subagents", exact: true });
      await expect(selected.getByText("Opus 5.5 · personal", { exact: true })).toBeVisible();
      await expect(selected.getByText("Sonnet 5.5 · work", { exact: true })).toBeVisible();
      await expect(selected.getByText("Beam Free", { exact: true })).toBeVisible();
      await expect(selected).not.toContainText(/Unavailable|Claude|OpenCode/);
      await panel.screenshot({
        path: `temp/verification/subagent-model-labels/selected-${width}-${theme}.png`,
      });
      await selected.getByRole("button", { name: "Add", exact: true }).click();
      const editor = panel.locator("[data-model-subagent-editor]");
      const retired = editor.getByRole("option", { name: /^Sonnet 5\.5,.*work/ });
      await expect(retired).toHaveText(/Sonnet 5\.5 · work/);
      await expect(retired).not.toContainText(/Unavailable|Claude/);
      await retired.scrollIntoViewIfNeeded();
      await panel.screenshot({
        path: `temp/verification/subagent-model-labels/picker-${width}-${theme}.png`,
      });
      await retired.click();
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(selected.getByText("Sonnet 5.5 · work", { exact: true })).toHaveCount(0);
    }
  }
});

test("model picker shows account identity and applies subagent picks as a batch", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 800]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts=3&theme=${theme}`,
      );
      await page
        .getByRole("button", { name: /^Claude Code/ })
        .first()
        .click();
      const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
      await expect(panel).toBeVisible();
      const opus = panel.getByRole("option", { name: "Claude Opus 5.5", exact: true });
      await opus.hover();
      await opus.locator("..").getByRole("button", { name: "Add to favorites" }).click();
      await panel.locator("[data-model-account-menu]").click();
      await expect(panel.locator("[data-model-account-list]")).toBeVisible();
      await expect(opus).toBeVisible();
      await panel.screenshot({
        path: `temp/verification/model-picker-rollout/accounts-${width}-${theme}.png`,
      });
      await panel.getByRole("radio", { name: /^work/ }).click();
      await panel.getByRole("tab", { name: "Favorites" }).click();
      const favorite = panel.getByRole("option", { name: /Opus 5\.5, Claude Code, work/ });
      await expect(favorite.locator("[data-model-account-number]")).toHaveText("2");
      await expect(favorite).not.toContainText("Claude Code");
      await panel.screenshot({
        path: `temp/verification/model-picker-rollout/favorites-${width}-${theme}.png`,
      });
      await panel.getByRole("tab", { name: "Agents", exact: true }).click();
      const advisor = panel.locator('[data-setting-id="crossAdvisor"]');
      const advisorHeading = advisor.locator("[data-setting-label]");
      const imageHeading = panel.locator('[data-setting-id="imageModels"] [data-setting-label]');
      await expect(advisorHeading).toHaveText("Advisor");
      await expect(imageHeading).toHaveText("Image models");
      expect((await advisorHeading.boundingBox())?.x).toBe((await imageHeading.boundingBox())?.x);
      await expect(advisor.getByText("Off", { exact: true })).toBeVisible();
      const addAdvisor = advisor.getByRole("button", { name: "Add · Advisor", exact: true });
      await expect(addAdvisor).not.toContainText("Advisor");
      await panel.screenshot({
        path: `temp/verification/advisor-row/off-${width}-${theme}.png`,
      });
      await addAdvisor.click();
      const advisorPicker = panel.locator('[data-model-setting-picker="crossAdvisor"]');
      const advisorChoice = advisorPicker.getByRole("option", { name: /^Claude Opus 5\.5/ });
      await expect(advisorChoice.locator("img, svg").first()).toBeVisible();
      await panel.screenshot({
        path: `temp/verification/model-picker-rollout/advisor-${width}-${theme}.png`,
      });
      await advisorChoice.click();
      await expect(advisor.locator("img").first()).toBeVisible();
      const editAdvisor = advisor.getByRole("button", { name: "Edit Advisor", exact: true });
      await expect(editAdvisor).toBeFocused();
      await expect(editAdvisor).toHaveText("");
      await editAdvisor.press("Enter");
      await expect(advisorPicker.getByRole("combobox", { name: "Search models" })).toBeFocused();
      await advisorPicker.getByRole("button", { name: "Back", exact: true }).click();
      await expect(editAdvisor).toBeFocused();
      await panel.getByRole("tab", { name: "Agents", exact: true }).focus();
      await panel.screenshot({
        path: `temp/verification/advisor-row/selected-${width}-${theme}.png`,
      });
      await panel.getByRole("radio", { name: "Custom", exact: true }).click();
      const editor = panel.locator("[data-model-subagent-editor]");
      const pickerOptions = editor.getByRole("option");
      await expect(editor.getByRole("combobox", { name: "Search models" })).toBeFocused();
      const filter = editor.getByRole("button", { name: /^Accounts:/ });
      await filter.click();
      const accounts = page.getByRole("listbox", { name: "Accounts", exact: true });
      await expect(accounts).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(accounts).toHaveCount(0);
      await expect(panel).toBeVisible();
      await filter.click();
      await accounts.getByRole("option", { name: "Claude Code · personal" }).click();
      await pickerOptions.first().click();
      await filter.click();
      await accounts.getByRole("option", { name: "Claude Code · work" }).click();
      const selectShown = editor.getByRole("button", { name: "Select all shown", exact: true });
      await expect(selectShown).toHaveText("");
      await expect(selectShown.locator("svg")).toBeVisible();
      const filterBounds = (await filter.boundingBox())!;
      const actionBounds = (await selectShown.boundingBox())!;
      expect(actionBounds.y).toBeLessThan(filterBounds.y + filterBounds.height);
      expect(actionBounds.x).toBeGreaterThanOrEqual(filterBounds.x + filterBounds.width);
      await expect(pickerOptions.first()).not.toContainText(" · work");
      await expect(pickerOptions.first().locator("[data-model-account-number]")).toHaveCount(0);
      await expect(editor.getByText("Claude Code · work", { exact: true })).toHaveCount(1);
      await panel.screenshot({
        path: `temp/verification/subagent-toolbar/filtered-${width}-${theme}.png`,
      });
      const search = editor.getByRole("combobox", { name: "Search models" });
      await search.fill("Opus 5.5");
      await expect(pickerOptions).toHaveCount(1);
      await selectShown.press("Space");
      await expect(editor.getByRole("status")).toHaveText("2 selected");
      const clearShown = editor.getByRole("button", { name: "Clear shown selection", exact: true });
      await clearShown.press("Space");
      await expect(editor.getByRole("status")).toHaveText("1 selected");
      await selectShown.click();
      await search.clear();
      await expect(editor.getByText("2 selected")).toBeVisible();
      await expect(page.getByTestId("choice")).not.toContainText('"crossSubagents":"[');
      await panel.screenshot({
        path: `temp/verification/model-picker-rollout/bulk-${width}-${theme}.png`,
      });
      await editor.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page.getByTestId("choice")).toContainText('"crossSubagents":"[');
    }
  }
});

test("queue row icons and saved account presentation", async ({ page }) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"]) {
    for (const width of [1280, 800]) {
      for (const state of ["one", "busy"]) {
        await page.setViewportSize({ width, height: 850 });
        await page.goto(
          `/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=${state}&theme=${theme}`,
        );
        const card = page.locator("[data-message-queue-card]");
        const handles = card.locator("[data-queue-handle]");
        await expect(handles).toHaveCount(state === "one" ? 1 : 2);
        if (state === "one") await expect(handles.first()).toBeDisabled();
        else await expect(handles.first()).toBeEnabled();
        await expect(card.locator("[data-queue-target]").first()).toContainText(" · personal");
        await expect(card.locator("[data-queue-target]").first()).not.toContainText("Claude Code");
        const remove = card
          .getByRole("button", { name: "Remove queued message", exact: true })
          .first();
        await expect(remove).toHaveText("");
        await expect(remove).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.mouse.move(0, 0);
        await card.screenshot({
          path: `temp/verification/2026-11-11-queue-row/${theme}-${width}-${state}.png`,
        });
      }
    }
  }
});

test("replaces Steer with Send again on the unconfirmed queue row", async ({ page }) => {
  await initializeChatLayout(page);
  for (const theme of ["dark", "light"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=unknown&theme=${theme}`,
      );
      const card = page.locator("[data-message-queue-card]");
      const review = card.locator('[data-delivery-progress="unknown"]');
      const retry = review.getByRole("button", { name: "Send again", exact: true });
      await expect(retry).toBeVisible();
      await expect(retry).toHaveAttribute("data-button-tone", "warning");
      await expect(retry).toBeEnabled();
      await expect(card.getByRole("button", { name: "Steer", exact: true })).toHaveCount(1);
      await expect(card.getByRole("button", { name: "Remove queued message" })).toHaveCount(2);
      await expect(card.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
      await card.screenshot({
        animations: "disabled",
        path: `temp/verification/queue-steer-sync/review-${theme}-${width}.png`,
      });
    }
  }
});

test("queue removal offers inline Undo without a confirmation", async ({ page }) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=one");
  const card = page.locator("[data-message-queue-card]");
  await card.getByRole("button", { name: "Remove queued message", exact: true }).click();
  await expect(card.locator("[data-queue-handle]")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Confirm delete" })).toHaveCount(0);
  await expect(card.locator("[data-queue-removal]")).toContainText("Message removed");
  await card.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card.locator("[data-queue-handle]")).toHaveCount(1);
  await expect(card.locator("[data-queue-removal]")).toHaveCount(0);
});

for (const theme of ["light", "dark"])
  for (const width of [320, 800, 1280])
    test(`model settings responsive divider ${theme} ${width}`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem("bycoda.language", "en");
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/chat/composer-extras.html?theme=${theme}`);
      await page.locator("[data-composer-model-controls] button[aria-haspopup]").first().click();
      const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
      const column = panel.locator("[data-model-settings]");
      await expect(column).toBeVisible();
      const border = await column.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          left: style.borderLeftWidth,
          top: style.borderTopWidth,
          container: node.closest('[class*="@container/model-panel"]')?.getBoundingClientRect()
            .width,
        };
      });
      console.log("MODEL_DIVIDER", width, JSON.stringify(border));
      expect(border.left).toBe(width === 320 ? "0px" : "1px");
      expect(border.top).toBe(width === 320 ? "1px" : "0px");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/model-divider-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`activity dock transparency fallback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        "/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=active&queue-background",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const dock = page.locator("[data-activity-dock]");
      const queue = page.locator("[data-message-queue-card]");
      await expect(dock).toBeVisible();
      await expect(queue).toBeVisible();
      for (const mode of ["glass", "no-blur", "streaming", "forced-colors"] as const) {
        await page.emulateMedia({ forcedColors: mode === "forced-colors" ? "active" : "none" });
        await page.evaluate((state) => {
          document.documentElement.toggleAttribute("data-performance-no-blur", state === "no-blur");
          document
            .querySelector("[data-composer]")!
            .parentElement!.toggleAttribute("data-session-streaming", state === "streaming");
          if (state === "streaming")
            document
              .querySelector("[data-composer]")!
              .parentElement!.setAttribute("data-session-streaming", "true");
        }, mode);
        const values = await Promise.all(
          [dock, queue].map((loc) =>
            loc.evaluate((node) => {
              const style = getComputedStyle(node);
              const probe = document.createElement("span");
              probe.style.background = "var(--ui-composer-surface)";
              node.appendChild(probe);
              const opaque = getComputedStyle(probe).backgroundColor;
              probe.style.background = "var(--ui-activity-dock-glass)";
              const glass = getComputedStyle(probe).backgroundColor;
              probe.remove();
              return {
                background: style.backgroundColor,
                shadow: style.boxShadow,
                filter: style.backdropFilter,
                opaque,
                glass,
              };
            }),
          ),
        );
        for (const value of values) {
          expect(value.background).toBe(mode === "glass" ? value.glass : value.opaque);
          if (mode !== "glass") {
            expect(value.shadow).toBe("none");
            expect(value.filter).toBe("none");
          }
        }
        await page.screenshot({
          animations: "disabled",
          path: `temp/verification/feature-controls/activity-dock-${mode}-${theme}-${width}.png`,
        });
      }
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`queue card top corners ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        "/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=active",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const card = page.locator("[data-message-queue-card]");
      await expect(card).toBeVisible();
      const corners = await card.evaluate((node) => {
        const s = getComputedStyle(node);
        return [
          s.borderTopLeftRadius,
          s.borderTopRightRadius,
          s.borderBottomLeftRadius,
          s.borderBottomRightRadius,
        ];
      });
      expect(corners).toEqual(["12px", "12px", "0px", "0px"]);
      await expect(card.locator("[data-queue-handle]")).toHaveCount(2);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/queue-corners-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`delegation and extras surfaces ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/chat/composer-extras.html?surfaceProbes&theme=${theme}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const marker = page.locator('[data-probe="extras"] [data-surface-radius="pill"]').first();
      const count = page.locator('[data-extras-trigger] [data-surface-radius="sm"]');
      const account = page.locator('[data-probe="delegation"] [data-model-account-number]');
      const help = page.locator("[data-model-setting-help]");
      await expect(marker).toBeVisible();
      await expect(count).toBeVisible();
      await expect(account).toBeVisible();
      await expect(account).toHaveText("2");
      expect(
        await account.evaluate((node) =>
          getComputedStyle(node).getPropertyValue("--badge-identity").trim(),
        ),
      ).toBe("#b55272");
      const computed = await Promise.all(
        [marker, count].map((loc) =>
          loc.evaluate((node) => {
            const s = getComputedStyle(node);
            return { bg: s.backgroundColor };
          }),
        ),
      );
      const expected = await page.evaluate(() => {
        const probe = document.createElement("span");
        document.body.appendChild(probe);
        const background = (value: string) => {
          probe.style.background = value;
          return getComputedStyle(probe).backgroundColor;
        };
        const accent = background("var(--color-accent)");
        const selection = background("var(--color-selection)");
        probe.remove();
        return { accent, selection };
      });
      expect(computed[0]!.bg).toBe(expected.accent);
      expect(computed[1]!.bg).toBe(expected.selection);
      const helpBorder = await help.evaluate((node) => {
        const style = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.borderTop = "1px solid var(--ui-frosted-divider)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return { width: style.borderTopWidth, color: style.borderTopColor, expected };
      });
      expect(helpBorder.width).toBe("1px");
      expect(helpBorder.color).toBe(helpBorder.expected);
      console.log("SURFACE_PROBES", theme, JSON.stringify(computed));
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/model-surfaces-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared lifted queue appearance ${theme} ${width}`, async ({ page }) => {
      await initializeChatLayout(page);
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/chat/composer-extras.html?chat-layout&accounts&queue-state=busy&theme=${theme}`,
      );
      const row = page.locator("[data-message-queue-card] .reorder-item").first();
      const handle = page.locator('[data-message-queue-card] [data-queue-handle="queued"]');
      await handle.focus();
      const before = await row.boundingBox();
      // Seed only the controller's visual state; keyboard reorder below exercises actual behavior.
      await row.evaluate((node) => node.setAttribute("data-dragging", ""));
      const actual = await row.evaluate((node) => {
        const s = getComputedStyle(node),
          probe = document.createElement("span");
        probe.style.background = "var(--ui-surface)";
        probe.style.boxShadow = "var(--shadow-lg)";
        probe.style.borderRadius = "var(--ui-radius-row)";
        node.appendChild(probe);
        const p = getComputedStyle(probe);
        const result = {
          background: s.backgroundColor,
          shadow: s.boxShadow,
          radius: s.borderRadius,
          expectedBackground: p.backgroundColor,
          expectedShadow: p.boxShadow,
          expectedRadius: p.borderRadius,
        };
        probe.remove();
        return result;
      });
      expect(actual.background).toBe(actual.expectedBackground);
      expect(actual.shadow).toBe(actual.expectedShadow);
      expect(actual.radius).toBe(actual.expectedRadius);
      expect(await row.boundingBox()).toEqual(before);
      await handle.evaluate((node) => node.blur());
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/session-interactions/queue-${theme}-${width}.png`,
      });
      await row.evaluate((node) => node.removeAttribute("data-dragging"));
      await handle.focus();
      await handle.press("Alt+ArrowDown");
      await expect(handle).toBeFocused();
      await expect(
        page.locator("[data-message-queue-card] [data-queue-handle]").last(),
      ).toHaveAttribute("data-queue-handle", "queued");
      await expect(page.locator("[data-message-queue-card] .reorder-item")).toHaveCount(2);
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared Btw tab frame preserves draft ${theme} ${width}`, async ({ page }) => {
      await initializeChatLayout(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/composer-extras.html?btw-interaction&theme=${theme}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Open side questions" }).click();
      const sheet = page.getByRole("dialog", { name: "By-the-way conversations" });
      const draft = sheet.getByRole("textbox").first();
      await expect(draft).toHaveValue("Unsent side question");
      await draft.fill("Retain exact unsent draft");
      const tabs = sheet.getByRole("tab");
      await expect(tabs).toHaveCount(2);
      const host = tabs.last().locator("..");
      await expect(host).toHaveCSS("border-radius", "6px");
      await tabs.first().click();
      await tabs.last().click();
      await expect(draft).toHaveValue("Retain exact unsent draft");
      await page.screenshot({
        path: `temp/verification/session-interactions/btw-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`picker composition keeps editor and search activation ${theme} ${width}`, async ({
      page,
    }) => {
      await initializeChatLayout(page);
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/chat/composer-extras.html?picker-root-consumers");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const editor = page.getByRole("textbox", { name: "External picker editor" });
      // A loaded runner can move focus after the first call (mount effects), so retry until held.
      await expect(async () => {
        await editor.focus();
        await expect(editor).toBeFocused({ timeout: 1000 });
      }).toPass();
      const skills = page.getByRole("listbox", { name: "Commands and skills" });
      await expect(skills.getByRole("option")).toHaveCount(2);
      await skills.getByRole("option").first().click();
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue("Exact unsent editor draft");
      await expect(page.getByLabel("Picker activation")).not.toHaveText("");
      await page
        .locator("[data-root-skills]")
        .screenshot({ path: `temp/verification/picker-roots/skills-${theme}-${width}.png` });
      const chats = page.getByRole("listbox", { name: "Chat search results" });
      await expect(chats.getByRole("option")).toHaveCount(2);
      await chats.getByRole("option").last().click();
      await expect(page.getByLabel("Picker activation")).toHaveText("fixture-chat-b");
      await page
        .locator("[data-root-chat]")
        .screenshot({ path: `temp/verification/picker-roots/chat-${theme}-${width}.png` });
      const search = page.getByRole("combobox", { name: "Search", exact: true });
      await expect(search).toHaveValue("visual");
      await search.focus();
      await search.press("ArrowDown");
      const results = page.getByRole("listbox", { name: "Search results", exact: true });
      await expect(results.getByRole("option")).toHaveCount(1);
      expect(await search.getAttribute("aria-controls")).toBe(await results.getAttribute("id"));
      await page
        .locator("[data-root-search]")
        .screenshot({ path: `temp/verification/picker-roots/search-${theme}-${width}.png` });
      await search.press("Enter");
      await expect(page.getByLabel("Picker activation")).toHaveText("/fixture/visual-project");
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`search content disclosure geometry ${theme} ${width}`, async ({ page }) => {
      await initializeChatLayout(page);
      await page.setViewportSize({ width, height: 1200 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        "/tests/browser/chat/composer-extras.html?picker-root-consumers&search-surfaces",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const list = page.getByRole("listbox", { name: "Chat search results", exact: true });
      const match = list.locator(".app-search-match");
      const excerpt = match.locator(".app-search-match-excerpt");
      await expect(match).toHaveCSS("margin-inline-start", "22px");
      await expect(list.locator(".app-search-more")).toHaveCSS("margin-inline-start", "42px");
      await page.mouse.move(width - 1, 1199);
      const line = await excerpt.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
      expect(
        await excerpt.evaluate((node) => parseFloat(getComputedStyle(node).maxBlockSize)),
      ).toBeCloseTo(line, 1);
      const collapsed = (await excerpt.boundingBox())!.height;
      await match.hover();
      await expect
        .poll(() => excerpt.evaluate((node) => parseFloat(getComputedStyle(node).maxBlockSize)))
        .toBeCloseTo(line * 6, 1);
      expect((await excerpt.boundingBox())!.height).toBeGreaterThan(collapsed);
      await page.mouse.move(width - 1, 1199);
      await match.focus();
      await expect
        .poll(() => excerpt.evaluate((node) => parseFloat(getComputedStyle(node).maxBlockSize)))
        .toBeCloseTo(line * 6, 1);
      const title = list.locator(".app-search-result-title").first();
      await list.getByRole("option").first().hover();
      await expect(title).toHaveCSS("white-space", "normal");
      await expect(list.locator(".app-search-project").last()).toHaveCSS(
        "border-block-start-width",
        "1px",
      );
      await expect(list.locator(".app-search-conversation").nth(1)).toHaveCSS(
        "border-block-start-width",
        "1px",
      );
      await page.screenshot({
        path: `temp/verification/search-skills-notes/search-${theme}-${width}.png`,
      });
      await match.click();
      await expect(page.getByLabel("Picker activation")).toHaveText("fixture-chat-a");
    });
  }
for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`draft Markdown formats in one editor (${theme}, ${width}px)`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/chat/composer-extras.html?chat-layout&theme=${theme}`);
      const draft = page.getByRole("textbox", { name: "Message", exact: true });
      await draft.fill("Plain draft");
      await expect(draft).toHaveAttribute("data-composer-plain", "true");
      const source = "## Plan\n\n- **First step**\n- `pnpm test`";
      await draft.fill(source);
      const overlay = page.locator(".composer-highlight");
      await expect(overlay.locator('[data-draft-markdown="heading"]')).toContainText("Plan");
      const emphasis = overlay.locator('[data-draft-markdown="strong"]');
      await expect(emphasis).toContainText("First step");
      await expect(overlay.locator('[data-draft-markdown="code"]')).toContainText("pnpm test");
      await expect(page.getByRole("button", { name: "Markdown preview", exact: true })).toHaveCount(
        0,
      );
      await expect(page.locator("[data-composer-markdown-preview]")).toHaveCount(0);
      await expect(draft).toBeFocused();
      const headerMark = overlay.locator(
        '[data-draft-markdown="heading"] [data-draft-markdown="mark"]',
      );
      await expect(headerMark).toHaveCSS("color", "rgba(0, 0, 0, 0)");
      await draft.evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(1, 1));
      await expect(headerMark).toHaveAttribute("data-editing-mark", "");
      await draft.evaluate((field: HTMLTextAreaElement) =>
        field.setSelectionRange(field.value.length, field.value.length),
      );
      await draft.press("End");
      await draft.press("Backspace");
      await expect(overlay.locator('[data-draft-markdown="code"]')).toHaveCount(0);
      await draft.press("`");
      await expect(overlay.locator('[data-draft-markdown="code"]')).toHaveCount(1);
      await expect(draft).toHaveValue(source);
      if (browserName === "chromium") {
        await page.screenshot({
          animations: "disabled",
          path: `temp/verification/composer-inline-markdown/${theme}-${width}.png`,
        });
      }
    });

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`long plain paste becomes a downloadable sent text card at ${width}px in ${theme}`, async ({
      page,
      context,
      browserName,
    }) => {
      await initializeChatLayout(page);
      const source =
        "First line: Izmir \u0130zmir\n" + "A detailed line of clipboard text.\n".repeat(3400);
      const realClipboard = browserName === "chromium";
      if (realClipboard) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const bytes = Buffer.from(
        realClipboard && process.platform === "win32" ? source.replaceAll("\n", "\r\n") : source,
      );
      const saved: Buffer[] = [];
      const copies: { name: string; data: Buffer }[] = [];
      const write = Promise.withResolvers<void>();
      await page.exposeFunction("writePastedFixture", async (encoded: string) => {
        saved.push(Buffer.from(encoded, "base64"));
        await write.promise;
      });
      await page.exposeFunction(
        "savePastedFixture",
        ({ name, data }: { name: string; data: string }) => {
          copies.push({ name, data: Buffer.from(data, "base64") });
        },
      );
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&pasted-text");
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("theme-light", theme === "light");
        const fixture = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: unknown) => Promise<unknown>;
          };
          writePastedFixture: (data: string) => Promise<void>;
          savePastedFixture: (input: { name: string; data: string }) => Promise<void>;
        };
        const original = fixture.__TAURI_INTERNALS__.invoke;
        let pastedData = "";
        fixture.__TAURI_INTERNALS__.invoke = async (command, args) => {
          if (command === "session_set_draft") return null;
          if (command === "write_attachment") {
            pastedData = (args as { data: string }).data;
            await fixture.writePastedFixture(pastedData);
            return "/isolated-fixture/Pasted text.txt";
          }
          if (command === "read_binary_file") return pastedData;
          if (command === "save_file_copy") {
            await fixture.savePastedFixture(args as { name: string; data: string });
            return true;
          }
          return original(command, args);
        };
      }, theme);
      const field = page.getByRole("textbox", { name: "Message", exact: true });
      await field.fill("");
      await pastePlainText(field, source, realClipboard);
      const draftCard = page.locator('[data-attachment-name="Pasted text.txt"]');
      try {
        await expect.poll(() => saved.length).toBe(1);
        await expect(field).toHaveValue("");
        await expect(draftCard).toHaveCount(0);
      } finally {
        write.resolve();
      }
      await expect(draftCard).toBeVisible({ timeout: 3500 });
      await expect(draftCard).toContainText(/\d+ KB/);
      await expect(draftCard.getByRole("button", { name: "Remove Pasted text" })).toBeVisible();
      expect(saved[0].equals(bytes)).toBe(true);
      expect(
        await field.evaluate(
          (element) => (element as HTMLTextAreaElement).value ?? element.textContent,
        ),
      ).toBe("");
      await page.screenshot({
        path: `temp/verification/pasted-text-direct/draft-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const sent = page.locator("[data-prompt-anchor=pasted-fixture]");
      await expect(sent.getByText("Pasted text", { exact: true })).toBeVisible();
      await expect(sent).not.toContainText("First line");
      const download = sent.getByRole("button", { name: "Save Pasted text" });
      await expect(download).toBeVisible();
      await page.screenshot({
        path: `temp/verification/pasted-text-direct/sent-${theme}-${width}.png`,
      });
      await sent.getByRole("button", { name: "Open Pasted text" }).click();
      await expect(page.getByRole("dialog").getByText(/^First line:/)).toBeVisible();
      await page.keyboard.press("Escape");
      await download.click();
      await expect.poll(() => copies.map(({ name }) => name)).toEqual(["Pasted text.txt"]);
      expect(copies[0].data.equals(bytes)).toBe(true);
      await page.goto(
        "/tests/browser/chat/composer-extras.html?chat-layout&pasted-text&queue-state=one",
      );
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("theme-light", theme === "light");
        const ipc = (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        const original = ipc.invoke;
        ipc.invoke = (command, args) =>
          command === "write_attachment"
            ? Promise.resolve("/isolated-fixture/Pasted text.txt")
            : original(command, args);
      }, theme);
      await page.getByRole("button", { name: "Edit queued message", exact: true }).click();
      const queue = page.getByRole("dialog", { name: "Edit queued message" });
      const queuedField = queue.getByRole("textbox", { name: "Queued message text" });
      await queuedField.fill("");
      await pastePlainText(queuedField, source, realClipboard);
      await expect(queue.getByText("Pasted text", { exact: true })).toBeVisible();
      await expect(queuedField).toHaveValue("");
      await page.screenshot({
        path: `temp/verification/pasted-text-direct/queue-${theme}-${width}.png`,
      });
    });
  }
}

for (const theme of ["dark", "light"] as const) {
  test(`queued message editor works like the chat composer in ${theme}`, async ({ page }) => {
    await initializeChatLayout(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&queue-state=one");
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle("theme-light", theme === "light");
      const ipc = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const original = ipc.invoke;
      ipc.invoke = (command, args) =>
        command === "write_attachment"
          ? Promise.resolve("/isolated-fixture/shot.png")
          : original(command, args);
    }, theme);
    await expect(page.getByText("Sends when the current turn finishes")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit queued message", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit queued message" });
    const field = dialog.getByRole("textbox", { name: "Queued message text" });
    await field.evaluate((element) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        ),
        (char) => char.charCodeAt(0),
      );
      const clipboardData = new DataTransfer();
      clipboardData.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    });
    const inline = dialog.locator("[data-composer-inline-input]");
    await expect(inline.locator("[data-inline-reference]")).toBeVisible();
    await expect(dialog.locator("textarea")).toBeHidden();
    await page.screenshot({ path: `temp/verification/queue-edit/inline-${theme}.png` });

    await dialog.getByRole("button", { name: "Add files or skills", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /Upload file/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Skills/ })).toBeVisible();
    await page.screenshot({ path: `temp/verification/queue-edit/add-menu-${theme}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: /Upload file/ })).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await inline.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" /");
    await expect(page.locator("[data-skill-picker]")).toBeVisible();
    await page.screenshot({ path: `temp/verification/queue-edit/skills-${theme}.png` });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-skill-picker]")).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog.getByText("Discard your changes?")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Discard", exact: true })).toBeVisible();
    await page.screenshot({ path: `temp/verification/queue-edit/discard-${theme}.png` });
  });
}

async function pastePlainText(field: Locator, text: string, realClipboard = false) {
  if (realClipboard) {
    await field.evaluate((_, value) => navigator.clipboard.writeText(value), text);
    await field.press("ControlOrMeta+v");
    return;
  }
  await field.evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  }, text);
}

test("a long plain paste keeps the existing draft when saving fails", async ({ page }) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout");
  await page.evaluate(() => {
    const fixture = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
    };
    const original = fixture.__TAURI_INTERNALS__.invoke;
    fixture.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "write_attachment") throw new Error("Fixture cannot save the paste");
      return original(command, args);
    };
  });
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  const text = "Clipboard text ".repeat(600);
  await field.fill("Existing draft");
  await pastePlainText(field, text);
  await expect(page.getByText(/Fixture cannot save the paste/)).toBeVisible();
  expect(
    await field.evaluate(
      (element) => (element as HTMLTextAreaElement).value ?? element.textContent,
    ),
  ).toBe("Existing draft");
  await expect(page.locator("[data-pasted-text-attachment]")).toHaveCount(0);
});
