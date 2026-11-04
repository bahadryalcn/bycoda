import { test, expect, type Locator, type Page } from "@playwright/test";
import { dropAnnouncer, dropBadge, dropMarks, fileDrag, files, textDrag } from "./external-drop";

/** Hover hints are the shared Tooltip (no native title): a label line plus shortcut key caps. */
async function expectHint(
  page: Page,
  target: Locator,
  label: string | RegExp,
  keys: (string | RegExp)[] | RegExp | null,
) {
  await target.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(label);
  if (keys === null) await expect(hint.locator("kbd")).toHaveCount(0);
  else if (Array.isArray(keys)) await expect(hint.locator("kbd")).toHaveText(keys);
  else await expect(hint).toContainText(keys);
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCount(0);
}

test("composer attachment submission stays local and keeps Stop available", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/composer-extras.html?chat-layout");
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
    await page.goto("/tests/browser/composer-extras.html?chat-layout&delivery-progress");
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    const card = page.locator("[data-message-queue-card]");
    await card.getByRole("button", { name: "Steer", exact: true }).press("Enter");
    const progress = page.locator("[data-delivery-progress]");
    await expect(progress).toContainText("Synchronizing the message queue");
    await expect(card.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await page.clock.runFor(11_000);
    await expect(progress).toContainText("11s elapsed");
    await expect(progress).toContainText("you do not need to write it again");
    expect(await progress.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-21-steer-investigation/${light ? "light" : "dark"}-320-waiting.png`,
    });
    await page.clock.runFor(1000);
    await expect(progress).toContainText("Waiting for provider confirmation");
    await page.clock.runFor(1000);
    await expect(progress).toHaveAttribute("data-delivery-progress", "rejected");
    await expect(card.getByRole("alert")).toHaveText(
      "The send was cancelled or rejected. The message remains queued and the queue is paused.",
    );
    await expect(card.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
    await expect(
      card.getByText("Queued task waiting for the current turn", { exact: true }),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Remove", exact: true })).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Steer", exact: true })).toBeEnabled();
  }
});

test("queue actions expose progress and recovery in both themes at narrow widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/composer-extras.html?chat-layout&queue-feedback");
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
    await expect(card.locator("[data-queue-feedback]")).toHaveText("Waiting for confirmation…");
    await expect(card.getByRole("alert")).toContainText("It remains queued");
    await expect(steer).toBeEnabled();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(card.getByRole("button", { name: "Resuming…", exact: true })).toBeDisabled();
  await expect(card.locator("[data-queue-feedback]")).toContainText("when this turn finishes");
  await page.screenshot({
    path: "temp/verification/2026-10-20-git-reliability/queue-feedback.png",
  });
});

test("chat shortcut hints follow custom bindings and expose rewind at narrow widths", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/composer-extras.html?chat-layout&shortcuts");
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
  await page.goto("/tests/browser/composer-extras.html?chat-layout&response-speed");
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
  await page.goto("/tests/browser/composer-extras.html?chat-layout");
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
    await page.goto("/tests/browser/composer-extras.html?translation-selection");
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
    "/tests/browser/composer-extras.html?translation-selection&antigravity-selection",
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
  await page.getByRole("menuitem", { name: /^Model/ }).click();
  await expect(page.getByRole("tab", { name: "Claude Code", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Codex", exact: true })).toHaveCount(0);
  await page.getByRole("option").filter({ hasText: "Gemini 3.8 Flash" }).first().click();
  await result.getByRole("button", { name: "Translate selected text", exact: true }).click();
  await expect(result).toContainText("Translated fixture text");
  await result.getByRole("button", { name: "Apply translation", exact: true }).click();
  await expect(input).toHaveValue("Translated fixture text");
  await expect(page.getByTestId("choice")).toContainText('"harness":"antigravity"');
});

test("translation selection menu opens above text and survives unavailable geometry", async ({
  page,
}) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/composer-extras.html?translation-selection", {
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
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  const queue = page.getByRole("button", {
    name: "Queue message",
    exact: true,
  });
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expectHint(page, send, "Steer", ["Enter"]);
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
}

test("hints reveal with one quiet fade and remain complete when motion is reduced", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts&hint-motion");
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
    await page.goto(`/tests/browser/composer-extras.html?chat-layout&accounts${variant}`);
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
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts&workspace-footer");
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

test("chat busy actions explain steering and queuing without losing the draft", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts");
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
  await expectHint(page, send, "Steer", ["Enter"]);
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
    await page.goto("/tests/browser/composer-extras.html?welcome&crew");
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
  await page.goto("/tests/browser/composer-extras.html");
  const label = page.locator(".shimmer-text").first();
  await expect(label).toHaveCSS("animation-name", "none");
  expect(await label.evaluate((el) => getComputedStyle(el).color)).not.toBe("rgba(0, 0, 0, 0)");
  await page.goto("/tests/browser/composer-extras.html?footer");
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
  await page.goto("/tests/browser/composer-extras.html?welcome");
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
  await page.goto("/tests/browser/composer-extras.html?accounts");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  await expect(main).toContainText("personal");
  await main.click();
  await page.getByRole("menuitem", { name: /^Model / }).click();
  const work = page.getByRole("option", { name: /Opus 5.5 work/ });
  await expect(work).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-model-picker.png"),
    animations: "disabled",
  });
  await work.click();
  await expect(main).toContainText("Opus 5.5 work");
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

test("chat edits model settings from one menu at narrow and wide sizes", async ({
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
  await page.goto("/tests/browser/composer-extras.html");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  const menu = page.getByRole("menu", {
    name: "Model and settings",
    exact: true,
  });
  const row = (name: string) =>
    menu.getByRole("menuitem").filter({ has: page.getByText(name, { exact: true }) });
  const choose = async (name: string, option: string) => {
    await main.click();
    // Hovering a row opens its flyout; at narrow widths the flyout may cover the row itself,
    // so only click the row when hovering did not open it.
    await row(name).hover();
    const flyout = page.getByRole("menu", { name, exact: true });
    await flyout.waitFor({ timeout: 1000 }).catch(() => row(name).click());
    await flyout.getByRole("menuitemradio", { name: option, exact: true }).click();
  };
  await expect(main).toBeInViewport();
  await expect(page.getByRole("button", { name: "Extras", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await choose("Advisor", "Claude Opus 5.5");
  await choose("Subagent model", "Claude Haiku 4.5");
  await expect(page.getByTestId("choice")).toContainText('"model":"claude:sonnet-5"');
  await expect(page.getByTestId("choice")).toContainText('"advisor":"claude-opus-5-5"');
  await expect(page.getByTestId("choice")).toContainText('"subagentModel":"claude-haiku-4-5"');
  await main.click();
  await expect(menu).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("chat-model-settings-320px.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await main.click();
  // Settings can be queued for the next turn while an agent is running.
  await expect(row("Advisor")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle busy", exact: true }).click();
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await main.click();
  await expect(row("Advisor")).toBeDisabled();
  // Keyboard activation must respect the same lock as pointer input.
  await menu.press("ArrowRight");
  await menu.press("Enter");
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();

  await page.getByRole("button", { name: "codex", exact: true }).click();
  await main.click();
  // Stable order (modelPickerData SETTING_ORDER): Fast/Service Tier, Reasoning, then Model.
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Service TierStandard",
    "ReasoningMedium",
    "ModelGPT-5.4",
  ]);
  await expect(row("Advisor")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-settings-320px.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await choose("Reasoning", "High");
  await choose("Service Tier", "Fast");
  await expect(main).toContainText("High");
  await expect(page.getByTestId("choice")).toContainText('"serviceTier":"fast"');
  await page.setViewportSize({ width: 1000, height: 800 });
  await main.click();
  await page.screenshot({
    path: testInfo.outputPath("chat-codex-settings-wide.png"),
    animations: "disabled",
  });
  await row("Model").click();
  // The shared popover search drives the model listbox, so it is a combobox.
  await expect(page.getByRole("combobox", { name: "Search models", exact: true })).toBeVisible();
  await expect(page.locator("[data-model-extras-entry]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "grok", exact: true }).click();
  await main.click();
  await expect(row("Reasoning")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "gemini", exact: true }).click();
  await main.click();
  await expect(row("Model")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
});

test("model menu stays inside its frame and viewport", async ({ page }, testInfo) => {
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
  await page.goto("/tests/browser/composer-extras.html?accounts");
  const main = page.locator("[data-composer-model-controls] button[aria-haspopup]").first();
  await expect(main).toContainText("personal");
  await main.click();
  await page.getByRole("menuitem", { name: /^Model / }).click();
  for (const viewport of [
    { width: 661, height: 761 },
    { width: 320, height: 480 },
    { width: 1000, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const menu = page.getByRole("menu", {
      name: "Model and settings",
      exact: true,
    });
    await expect(menu).toBeInViewport();
    await expect
      .poll(() =>
        menu.evaluate((el) => {
          const content = el.getBoundingClientRect();
          const frame = el.parentElement!.getBoundingClientRect();
          return content.right <= frame.right && el.scrollWidth <= el.clientWidth + 1;
        }),
      )
      .toBe(true);
    const flyout = page.getByRole("dialog", { name: "Models", exact: true });
    await expect
      .poll(() =>
        flyout.evaluate((el) => {
          const frame = el.parentElement!.getBoundingClientRect();
          const tabs = el.querySelectorAll('[role="tab"]').length;
          const preferredHeight = Math.max(tabs * 32 + (tabs - 1) * 4 + 12, 300) + 2;
          const controls = document
            .querySelector(".model-controls-menu")!
            .parentElement!.getBoundingClientRect();
          return (
            frame.top >= 7 &&
            frame.bottom <= innerHeight - 7 &&
            frame.height <= preferredHeight + 1 &&
            // The flyout overlaps its row by 4px, inside the menu's 5px inset.
            (innerWidth < 661 ||
              (frame.left >= controls.right - 10 && frame.left <= controls.right))
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`model-menu-fixed-${viewport.width}.png`),
      animations: "disabled",
    });
  }
  await page.screenshot({
    path: testInfo.outputPath("model-menu-fixed.png"),
    animations: "disabled",
  });
});

test("independent scalar model settings preserve the draft caret and sibling values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/composer-extras.html?scalar");
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
  await page.goto("/tests/browser/composer-extras.html");
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
  await page.goto("/tests/browser/composer-extras.html?no-attachments");
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
