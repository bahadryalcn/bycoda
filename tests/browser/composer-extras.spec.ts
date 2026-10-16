import { test, expect } from "@playwright/test";

test("Antigravity translates directly and only connected providers are listed", async ({
  page,
}) => {
  test.setTimeout(20_000);
  await initializeChatLayout(page);
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
  const result = page.getByRole("dialog", { name: "Translate to English", exact: true });
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
  const queue = page.getByRole("button", { name: "Queue message", exact: true });
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(send).toHaveAttribute("title", "Steer (Enter)");
  await expect(queue).toHaveAttribute("title", /Shift\+Tab/);
  await expect(stop).toHaveAttribute("title", "Stop (Esc)");
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
    }
  }
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(stop).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this chat draft",
  );
});

async function initializeChatLayout(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Math.random = () => 0;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
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

test("hints unfold in 3D and remain complete when motion is reduced", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts&hint-motion");
  const hint = page.locator(".composer-tips-text");
  await expect(hint).toBeVisible();
  const fullText = await hint.getAttribute("aria-label");
  expect((await hint.innerText()).replaceAll("\u00a0", " ")).toBe(fullText);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const folding = await hint.evaluate((root) => {
    const pieces = [...root.querySelectorAll<HTMLElement>(".composer-tip-fold-piece")];
    for (const piece of pieces) {
      for (const animation of piece.getAnimations()) {
        animation.pause();
        animation.currentTime = 80;
      }
    }
    return pieces.some((piece) => {
      const transform = getComputedStyle(piece).transform;
      return transform.startsWith("matrix3d(");
    });
  });
  expect(folding).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("hint-folding.png"), animations: "allow" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await hint.innerText()).replaceAll("\u00a0", " ")).toBe(fullText);
  expect(await hint.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  expect(
    await hint
      .locator(".composer-tip-fold-piece")
      .first()
      .evaluate((piece) => getComputedStyle(piece).transform),
  ).toBe("none");
  await expect(page.locator(".composer-tips-cursor")).toHaveCount(0);
});

for (const variant of ["", "&remote", "&project-picker"]) {
  test(`chat context remains at the end of its row ${variant || "local"}`, async ({ page }) => {
    await initializeChatLayout(page);
    await page.goto(`/tests/browser/composer-extras.html?chat-layout&accounts${variant}`);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    const context = page.getByRole("button", { name: /Open context actions/ });
    await expect(context).toBeVisible();
    for (const width of [320, 420, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      expect(
        await context.evaluate((button) => {
          const box = button.closest("[data-composer-box]")!.getBoundingClientRect();
          return Math.abs(box.right - button.getBoundingClientRect().right - 13) < 3;
        }),
      ).toBe(true);
      await context.click();
      const dialog = page.getByRole("dialog", { name: "Context usage", exact: true });
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

test("chat metadata keeps hints muted and preserves controls in narrow and scaled panels", async ({
  page,
}, testInfo) => {
  await initializeChatLayout(page);
  await page.goto("/tests/browser/composer-extras.html?chat-layout&accounts&long-account");
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  const hint = page.locator(".composer-tips-icon");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [320, 420, 640, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(hint).toBeInViewport();
      await expect(input).toBeInViewport();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
      const styles = await page.locator("[data-composer-box]").evaluate((box) => {
        const agent = getComputedStyle(document.querySelector("[data-session-agent]")!);
        const label = getComputedStyle(box.querySelector(".composer-tips-icon")!);
        const copy = getComputedStyle(box.querySelector(".composer-tips-text")!);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          const linear = [r, g, b]
            .map((c) => c / 255)
            .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const text = luminance(agent.color);
        const hintText = luminance(copy.color);
        const background = luminance(getComputedStyle(box).backgroundColor);
        return {
          colors: [agent.color, label.color, copy.color],
          sizes: [agent.fontSize, label.fontSize, copy.fontSize],
          opacity: [agent.opacity, label.opacity, copy.opacity],
          contrast: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
          hintContrast:
            (Math.max(hintText, background) + 0.05) / (Math.min(hintText, background) + 0.05),
          contained: box.scrollWidth <= box.clientWidth + 1,
        };
      });
      expect(styles.colors[1]).toBe(styles.colors[2]);
      expect(styles.colors[2]).not.toBe(styles.colors[0]);
      expect(styles.sizes).toEqual(["12px", "11px", "11px"]);
      expect(styles.opacity).toEqual(["1", "1", "1"]);
      expect(styles.contrast).toBeGreaterThanOrEqual(4.5);
      expect(styles.hintContrast).toBeLessThan(styles.contrast);
      expect(styles.contained).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.locator(".composer-tips-copy")).toBeVisible();
      await expect(page.locator("[data-composer] [data-session-agent]")).toHaveCount(0);
      await expect(page.locator("[data-session-header] [data-session-agent]")).toBeVisible();
      await hint.click();
      const dialog = page.getByRole("dialog", { name: "Chat tips", exact: true });
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-composer-tips] [title]")).toHaveCount(0);
      await expect(input).toHaveValue("Keep this chat draft");
      await page.screenshot({
        path: testInfo.outputPath(`chat-${theme}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const zoom of [1.25, 1.5]) {
    await page.locator("main").evaluate((main, scale) => {
      main.style.inlineSize = "420px";
      main.style.zoom = String(scale);
      main.style.minBlockSize = `${900 / scale}px`;
    }, zoom);
    await expect(input).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
    expect(
      await page
        .locator("[data-composer-box]")
        .evaluate((box) => box.scrollWidth <= box.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`chat-split-${zoom}.png`),
      animations: "disabled",
    });
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
  await expect(send).toHaveAttribute("title", "Steer (Enter)");
  await expect(page.getByRole("button", { name: "Queue message", exact: true })).toHaveAttribute(
    "title",
    /Shift\+Tab/,
  );
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveAttribute(
    "title",
    "Stop (Esc)",
  );
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
  await expect(page.locator(".activity-dock-summary")).toHaveCSS(
    "background-color",
    await page
      .locator("[data-composer-box]")
      .evaluate((box) => getComputedStyle(box).backgroundColor),
  );
  await page.setViewportSize({ width: 420, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("chat-working.png"), animations: "disabled" });
  await input.fill("");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await input.fill("Keep my work");
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await expect(stop).toBeEnabled();
  await expect(input).toHaveValue("Keep my work");
  await stop.click();
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  await expect(page.locator("[data-activity-dock]")).toHaveAttribute("data-activity-dock", "done");
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
      await page.screenshot({ path: testInfo.outputPath(`welcome-${theme}-${width}.png`) });
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
  await page.screenshot({ path: testInfo.outputPath("welcome-split-panel.png") });
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
    await row(name).click();
    await page.getByRole("menuitemradio", { name: option, exact: true }).click();
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
  await expect(menu.getByRole("menuitem")).toHaveText([
    "ReasoningMedium",
    "Service TierStandard",
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
  await expect(page.getByRole("textbox", { name: "Search models", exact: true })).toBeVisible();
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
    const menu = page.getByRole("menu", { name: "Model and settings", exact: true });
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
