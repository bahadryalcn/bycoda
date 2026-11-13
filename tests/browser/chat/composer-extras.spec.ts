import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  dropAnnouncer,
  dropBadge,
  dropMarks,
  fileDrag,
  files,
  textDrag,
} from "../support/external-drop";

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
      name: "Remove clipboard-image.png",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    /Keep this chat draft/,
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
    await expect(pending).toHaveAttribute("title", "Synchronizing the message queue…");
    await expect(pending.getByRole("status")).toHaveText("Synchronizing the message queue…");
    await expect(progress).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await page.clock.runFor(11_000);
    await expect(pending).toHaveAttribute("title", "Synchronizing the message queue…");
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      path: `temp/verification/2026-10-21-steer-investigation/${light ? "light" : "dark"}-320-waiting.png`,
    });
    await page.clock.runFor(1000);
    await expect(pending).toHaveAttribute(
      "title",
      "Sending the message. Waiting for provider confirmation…",
    );
    await page.clock.runFor(1000);
    await expect(progress).toHaveAttribute("data-delivery-progress", "rejected");
    await expect(card.getByRole("alert")).toHaveText(
      "The send was cancelled or rejected. The message remains queued and the queue is paused.",
    );
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
      await expect(panel).toContainText("50.0 TPS");
      await expect(panel).not.toContainText("Speed scale");
      const info = panel.getByRole("button", {
        name: "Response speed",
        exact: true,
      });
      await expect(info).toHaveAttribute("aria-expanded", "false");
      await info.click();
      await expect(info).toHaveAttribute("aria-expanded", "true");
      await expect(panel).toContainText("Average over the full turn");
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
      for (const control of [send, queue, stop]) await expect(control).toBeInViewport();
      const bounds = await Promise.all([queue, send, stop].map((control) => control.boundingBox()));
      expect(bounds[0]!.x + bounds[0]!.width).toBeLessThanOrEqual(bounds[1]!.x);
      expect(bounds[1]!.x + bounds[1]!.width).toBeLessThanOrEqual(bounds[2]!.x);
      const plus = await page
        .getByRole("button", { name: "Add files or skills", exact: true })
        .boundingBox();
      const context = await page.locator(".context-meter-summary").boundingBox();
      for (const box of [plus, context, ...bounds]) {
        expect(box).not.toBeNull();
        expect(Math.abs(box!.height - bounds[2]!.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.y - bounds[2]!.y)).toBeLessThanOrEqual(1);
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
  const tooltip = page.getByRole("tooltip");
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
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(tooltip).toBeVisible();
  await expect(hint).toHaveText("Next tip");
  await page.mouse.move(0, 0);
  await input.focus();
  await expect(tooltip).toBeVisible();
  await input.click();
  await expect(tooltip).toHaveCount(0);
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
      await expect(tooltip).toHaveCount(0);
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
      await expect(tooltip).toHaveCount(0);
      await hint.click();
      await expect(tooltip).toBeInViewport();
      await expect(hint).toHaveText("Next tip");
      await expect(hint).toHaveAccessibleName("Next tip");
      await expect(hint).toHaveAttribute("aria-expanded", "true");
      // The control's name ("Next tip") carries the affordance; the tooltip holds only the tip.
      expect((await tooltip.innerText()).trim().length).toBeGreaterThan(20);
      const previous = await tooltip.innerText();
      await hint.click();
      await expect(tooltip).not.toHaveText(previous!);
      const next = await tooltip.innerText();
      await hint.click();
      await expect(tooltip).not.toHaveText(next!);
      if (theme === "dark" && width === 1024) {
        await page.screenshot({
          path: testInfo.outputPath("chat-tip-open.png"),
          animations: "disabled",
        });
      }
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      await expect(hint).toHaveText("Tip");
      await expect(hint).toHaveAttribute("aria-expanded", "false");
      await hint.hover();
      await hint.focus();
      await expect(tooltip).toHaveCount(0);
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
    await expect(tooltip).toBeInViewport();
    await expect(folders).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("access label collapses before narrow composer controls wrap", async ({ page }) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/browser/chat/composer-extras.html?chat-layout&workspace-footer");
  const access = page.locator("[data-access-picker-trigger]");
  await access.click();
  await page.getByRole("option", { name: /^Full access / }).click();
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
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `temp/verification/composer-narrow/${theme}-${width}.png`,
        animations: "disabled",
      });
      const label = access.locator(":scope > span:not([aria-hidden])");
      if (width < 560) await expect(label).toBeHidden();
      else await expect(label).toBeVisible();
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
    }
  }
  await page.locator("main").evaluate((main) => {
    main.style.inlineSize = "458px";
  });
  await expect(access.locator(":scope > span:not([aria-hidden])")).toBeHidden();
  await access.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: /^Full access / })).toBeVisible();
  await page.keyboard.press("Escape");
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
    expect(
      await page
        .locator("[data-composer-box]")
        .evaluate((box) => box.scrollWidth <= box.clientWidth + 1),
    ).toBe(true);
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
    const canvas = page.locator(".bycoda-empty .crew-scene canvas");
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
  const label = page.getByRole("status", { name: "Chat composer · provider options" });
  await expect(label.locator("[data-size]")).toHaveCSS("animation-name", "none");
  await expect(label).toHaveCSS("animation-name", "none");
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
  const title = page.getByRole("heading", { level: 1 });
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
  await expect(main).toContainText("personal");
  await main.click();
  const panel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  await expect(panel).toBeVisible();
  // Two accounts: a segmented control in the list header names both; each model is listed once.
  const account = panel.getByRole("radiogroup", { name: "Account", exact: true });
  await expect(account.getByRole("radio")).toHaveText(["personal", "work"]);
  await expect(account.getByRole("radio", { name: "personal", exact: true })).toBeChecked();
  const opus = panel.getByRole("option", { name: /^Claude Opus 5\.5, / });
  await expect(opus).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("account-model-picker.png"),
    animations: "disabled",
  });
  await opus.click();
  await expect(panel).toBeVisible();
  await account.getByRole("radio", { name: "work", exact: true }).click();
  await expect(account.getByRole("radio", { name: "work", exact: true })).toBeChecked();
  await expect(main).toContainText("Opus 5.5 work");
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
  await expect(page.getByRole("dialog", { name: "Chat tips", exact: true })).toHaveCount(0);
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
  const advisorField = settingsColumn.getByRole("button", { name: /^Advisor\b/ });
  // Advisor and Subagents open a picker in the settings column; the provider heading carries
  // the "Claude Code · " prefix, so options are named by model alone.
  const delegate = async (name: "Advisor" | "Subagents", label: RegExp) => {
    await openPanel("agents");
    const picker = settingsColumn.locator("[data-model-setting-picker]");
    if (name === "Advisor") await advisorField.click();
    else {
      // Pointer hover swaps the help strip's height, so the clipped Add row shifts under the
      // cursor; keyboard activation does not depend on a stable hit target.
      const add = setting(name).getByRole("button", { name: "Add", exact: true });
      await add.focus();
      await add.press("Enter");
    }
    await expect(picker).toBeVisible();
    const choice = picker
      .getByRole("radio", { name: label })
      .or(picker.getByRole("checkbox", { name: label }));
    await choice.click();
    if (name === "Subagents")
      await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(picker).toHaveCount(0);
  };
  await delegate("Advisor", /^Claude Opus 5\.5\b/);
  await expect(advisorField).toContainText("Claude Opus 5.5");
  await delegate("Subagents", /^Claude Haiku 4\.5\b/);
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
          document.activeElement?.matches("button, input, select, [role=radio], [role=checkbox]") &&
          document.activeElement.closest("[data-model-settings] [data-setting-id]"),
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
      .locator('[data-setting-id] > [role="radiogroup"]')
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
  await page.setViewportSize({ width: 1000, height: 800 });
  await openPanel();
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-settings-wide.png"),
    animations: "disabled",
  });
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
    const { helpText, settingsButton } = await help.evaluate((element) => {
      const text = element.querySelector("p")?.getBoundingClientRect();
      const button = element
        .querySelector("[data-model-provider-settings]")
        ?.getBoundingClientRect();
      return {
        helpText: text ? { y: text.y, height: text.height } : null,
        settingsButton: button ? { y: button.y, height: button.height } : null,
      };
    });
    expect(helpText).not.toBeNull();
    expect(settingsButton).not.toBeNull();
    expect(
      Math.abs(settingsButton!.y + settingsButton!.height / 2 - (helpText!.y + 8)),
    ).toBeLessThanOrEqual(8);
    const helpHeight = await help.evaluate((element) => {
      const strip = getComputedStyle(element);
      const textHeight = element.querySelector("p")!.getBoundingClientRect().height;
      return (
        textHeight +
        parseFloat(strip.paddingTop) +
        parseFloat(strip.paddingBottom) +
        parseFloat(strip.borderTopWidth)
      );
    });
    if (viewport.width >= 800) {
      const lineHeight = await help
        .locator("p")
        .evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect(helpText!.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
    }
    // The trailing icon button can be slightly taller than a single text line.
    expect(Math.abs((await help.boundingBox())!.height - helpHeight)).toBeLessThanOrEqual(3);
    await help.hover();
    expect(Math.abs((await help.boundingBox())!.height - helpHeight)).toBeLessThanOrEqual(3);
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
  const effort = page.getByRole("combobox", {
    name: /^(Effort|Reasoning): Medium$/,
  });
  await effort.click();
  await effort.press("End");
  await effort.press("Enter");
  await expect(draft).toBeFocused();
  expect(await draft.evaluate((node) => [node.selectionStart, node.selectionEnd])).toEqual([3, 8]);
  await expect(page.getByTestId("scalar-settings")).toContainText('"reasoningEffort":"high"');
  const tier = page.getByRole("combobox", {
    name: "Service Tier: Standard",
    exact: true,
  });
  await tier.click();
  await tier.press("End");
  await tier.press("Enter");
  await expect(page.getByTestId("scalar-settings")).toContainText('"reasoningEffort":"high"');
  await expect(page.getByTestId("scalar-settings")).toContainText('"serviceTier":"fast"');
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
  await expect(page.getByRole("button", { name: /^Remove dropped\.png/ })).toBeVisible();

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
    await panel.getByRole("checkbox", { name: /Nano Banana/ }).click();
    await expect(page.getByTestId("choice")).toContainText('"imageModels":"[\\"antigravity');
    await page.screenshot({
      path: `temp/verification/image-models/picker-${width}-${scheme}.png`,
    });
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
      const ring = page.locator('[data-probe="delegation"] [data-surface-radius="pill"]').first();
      const help = page.locator("[data-model-setting-help]");
      await expect(marker).toBeVisible();
      await expect(count).toBeVisible();
      await expect(ring).toBeVisible();
      const computed = await Promise.all(
        [marker, count, ring].map((loc) =>
          loc.evaluate((node) => {
            const s = getComputedStyle(node);
            return { bg: s.backgroundColor, shadow: s.boxShadow };
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
        const base = background("var(--color-background-base)");
        probe.remove();
        return { accent, selection, base };
      });
      expect(computed[0]!.bg).toBe(expected.accent);
      expect(computed[1]!.bg).toBe(expected.selection);
      expect(computed[2]!.shadow).toContain(`${expected.base} 0px 0px 0px 2px`);
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
      await editor.focus();
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
