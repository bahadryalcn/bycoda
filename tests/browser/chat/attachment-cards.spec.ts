import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/2026-11-04-chat-thumbnails";

test("attachment cards and inline references retain kind tones and the selected accent", async ({
  page,
}) => {
  const evidence = "temp/verification/2026-11-07-attachment-accent";
  await mkdir(evidence, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 1400 });
  for (const theme of ["light", "dark"]) {
    await page.goto(`/tests/browser/chat/attachment-cards.html?theme=${theme}`, {
      waitUntil: "domcontentloaded",
    });
    const composer = page.getByRole("region", { name: "Composer", exact: true });
    await expect(composer.locator("[data-attachment-chip]")).toHaveCount(10);
    const tones = await page.evaluate(() => {
      document.documentElement.style.setProperty("--user-accent-color", "#7c3aed");
      const read = (element: Element, pseudo?: string) => {
        const style = getComputedStyle(element, pseudo);
        return {
          color: style.color,
          background: style.backgroundColor,
          border: style.borderTopColor,
          shadow: style.boxShadow,
        };
      };
      return [
        ["image", "--ui-tone-success-fg"],
        ["audio", "--ui-tone-warning-fg"],
        ["markdown", "--ui-tone-accent-fg"],
      ].map(([kind, role]) => {
        const card = document.querySelector(
          `[aria-label="Composer"] [data-attachment-chip][data-attachment-kind="${kind}"]`,
        )!;
        const probe = document.createElement("span");
        probe.style.cssText = `color:var(${role});background:color-mix(in srgb,var(${role}) 8%,var(--ui-surface));border:1px solid color-mix(in srgb,var(${role}) 40%,var(--color-stroke))`;
        card.parentElement!.append(probe);
        const expectedCard = read(probe);
        probe.style.background = `color-mix(in srgb,var(${role}) 10%,transparent)`;
        probe.style.boxShadow = `inset 0 0 0 1px color-mix(in srgb,var(${role}) 45%,transparent)`;
        const expectedHighlight = read(probe);
        probe.remove();
        const composerToken = document.querySelector(
          `[aria-label="Composer"] [data-composer-attachment-kind="${kind}"]`,
        )!;
        const transcriptToken = document.querySelector(
          `[aria-label="Message"] span[title][data-attachment-kind="${kind}"]`,
        )!;
        const name = [...card.querySelectorAll("span")].find(
          (element) =>
            element.childElementCount === 0 && element.textContent === card.getAttribute("title"),
        );
        return {
          kind,
          expectedCard,
          expectedHighlight,
          card: read(card),
          composer: read(composerToken),
          highlight: read(composerToken, "::before"),
          transcript: read(transcriptToken),
          ...(name ? { name: read(name) } : {}),
        };
      });
    });
    for (const tone of tones) {
      expect(tone.card.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.card.background, tone.kind).toBe(tone.expectedCard.background);
      expect(tone.card.border, tone.kind).toBe(tone.expectedCard.border);
      if (tone.kind !== "image") expect(tone.name?.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.composer.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.highlight.background, tone.kind).toBe(tone.expectedHighlight.background);
      expect(tone.highlight.shadow, tone.kind).toBe(tone.expectedHighlight.shadow);
      expect(tone.transcript.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.transcript.background, tone.kind).toBe("rgba(0, 0, 0, 0)");
      expect(tone.transcript.shadow, tone.kind).toBe("none");
    }
    await page.screenshot({ path: `${evidence}/${theme}-1280.png`, fullPage: true });
  }
});

test("expired blob previews recover from their owning Host", async ({ page }) => {
  const evidence = "temp/verification/2026-11-06-image-preview";
  await mkdir(evidence, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/chat/attachment-cards.html?recover&theme=${theme}`);
    const region = page.getByRole("region", { name: "Message", exact: true });
    const trigger = region.getByRole("button", {
      name: "Open mountain-reference-for-the-new-project.png full screen",
      exact: true,
    });
    await expect(trigger.locator("img")).toBeVisible();
    await trigger
      .locator("img")
      .evaluate((image: HTMLImageElement) => URL.revokeObjectURL(image.src));
    await trigger.click();
    const dialog = page.getByRole("dialog");
    // The first broken carried URL reloads once from the owning Host's reader, without an error.
    await expect(dialog.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => dialog.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBe(400);
    await page.screenshot({ path: `${evidence}/${theme}-recovered.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("attachment surfaces retain native caret, insertion and removal", async ({ page }) => {
  await page.goto("/tests/browser/chat/attachment-cards.html");
  const composer = page.getByRole("region", { name: "Composer", exact: true });
  const message = composer.getByRole("textbox", { name: "Composer message" });
  await message.fill("Review this");
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 7));
  await composer
    .getByRole("button", { name: "Insert [image1] into the message", exact: true })
    .click();
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("Review [image1] this");
  expect(await message.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(16);
  await composer
    .getByRole("button", { name: "Remove mountain-reference-for-the-new-project.png", exact: true })
    .click();
  await expect(composer.locator('[data-attachment-kind="image"]')).toHaveCount(0);
  await expect(message).toHaveValue("Review this");
  await expect(composer.locator('[data-attachment-kind="pdf"]')).toHaveCount(2);
});

test("image preview opens and Escape returns focus", async ({ page }) => {
  await page.goto("/tests/browser/chat/attachment-cards.html");
  const composer = page.getByRole("region", { name: "Composer", exact: true });
  const image = composer.getByRole("button", {
    name: "Open mountain-reference-for-the-new-project.png full screen",
    exact: true,
  });
  await image.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(image).toBeFocused();
});

test("persisted message images show thumbnails before opening and retain them after Escape", async ({
  page,
}) => {
  await page.goto("/tests/browser/chat/attachment-cards.html");
  const message = page.getByRole("region", { name: "Message", exact: true });
  const trigger = message.getByRole("button", {
    name: "Open saved-mountain-reference.svg full screen",
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  const thumbnail = trigger.locator("img");
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await expect
    .poll(() => thumbnail.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(400);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const source = await thumbnail.getAttribute("src");
  await trigger.click();
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src", source!);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute("src", source!);
});

test("broken thumbnail falls back to image identity", async ({ page }) => {
  await page.goto("/tests/browser/chat/attachment-cards.html?broken");
  const composer = page.getByRole("region", { name: "Composer", exact: true });
  const image = composer.locator('[data-attachment-kind="image"]');
  await expect(image.locator("img")).toHaveCount(0);
  await expect(image.locator("svg").first()).toBeVisible();
  const preview = image.getByRole("button", {
    name: "Open mountain-reference-for-the-new-project.png full screen",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "mountain-reference-for-the-new-project.png",
  );
  await expect(page.getByRole("tooltip")).toContainText("237 KB");
});

test("attachment card themes and widths", async ({ page }) => {
  await mkdir(captures, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"])
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto(`/tests/browser/chat/attachment-cards.html?theme=${theme}`);
      await expect(page.getByRole("heading", { name: "Attachments", exact: true })).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Composer", exact: true })
          .locator("[data-attachment-chip]"),
      ).toHaveCount(10);
      const persistedThumbnail = page
        .getByRole("region", { name: "Message", exact: true })
        .getByRole("button", { name: "Open saved-mountain-reference.svg full screen", exact: true })
        .locator("img");
      await expect(persistedThumbnail).toBeVisible();
      await expect
        .poll(() =>
          persistedThumbnail.evaluate((element: HTMLImageElement) => element.naturalWidth),
        )
        .toBe(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${captures}/${theme}-${width}.png`, fullPage: true });
    }
});

test("real Composer accepts pasted files, decorates native tokens and renumbers removal", async ({
  page,
}) => {
  await mkdir(captures, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string, args: { name?: string } = {}) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "write_attachment") return `C:\\isolated-fixture\\${args.name}`;
          if (command === "clipboard_file_paths") return [];
          return undefined;
        },
      },
    });
  });
  for (const theme of ["dark", "light"])
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/tests/browser/chat/composer-extras.html?chat-layout");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const message = page.getByRole("textbox", { name: "Message", exact: true });
      await message.fill("Review references and retain this existing draft.");
      await message.press("End");
      await message.evaluate((element) => {
        const png = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6oS0AAAAASUVORK5CYII=",
          ),
          (char) => char.charCodeAt(0),
        );
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([png], "first-reference.png", { type: "image/png" }));
        clipboardData.items.add(new File([png], "second-reference.png", { type: "image/png" }));
        clipboardData.items.add(
          new File(["# Notes\nRetain all draft text."], "implementation-notes.md", {
            type: "text/markdown",
          }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
        );
      });
      await expect(page.locator("[data-attachment-chip]")).toHaveCount(3);
      await expect(message).toHaveValue(
        "Review references and retain this existing draft. [image1] [image2] [file1]",
      );
      await expect(page.locator('[data-composer-attachment-kind="image"]')).toHaveCount(2);
      await expect(page.locator('[data-composer-attachment-kind="markdown"]')).toHaveCount(1);
      const geometry = await message.evaluate((element: HTMLTextAreaElement) => {
        const overlay = element.parentElement!.querySelector(".composer-highlight")!;
        const inputBox = element.getBoundingClientRect();
        const overlayBox = overlay.getBoundingClientRect();
        const inputStyle = getComputedStyle(element);
        const overlayStyle = getComputedStyle(overlay);
        return {
          width: inputBox.width,
          overlayWidth: overlayBox.width,
          x: inputBox.x,
          overlayX: overlayBox.x,
          font: inputStyle.font,
          overlayFont: overlayStyle.font,
          inputHeight: element.scrollHeight,
          overlayHeight: overlay.scrollHeight,
        };
      });
      expect(geometry.overlayWidth).toBe(geometry.width);
      expect(geometry.overlayX).toBe(geometry.x);
      expect(geometry.overlayFont).toBe(geometry.font);
      expect(Math.abs(geometry.overlayHeight - geometry.inputHeight)).toBeLessThanOrEqual(1);
      await page
        .locator("[data-composer-box]")
        .screenshot({ path: `${captures}/real-composer-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Remove first-reference.png", exact: true }).click();
      await expect(page.locator("[data-attachment-chip]")).toHaveCount(2);
      await expect(message).toHaveValue(
        "Review references and retain this existing draft. [image1] [file1]",
      );
      const remainingImage = page.locator('[data-attachment-chip="image"]');
      await expect(remainingImage).toHaveCount(1);
      const preview = remainingImage.getByRole("button", {
        name: "Open second-reference.png full screen",
        exact: true,
      });
      await expect(preview).toBeVisible();
      await preview.hover();
      await expect(page.getByRole("tooltip")).toContainText("image1 · second-reference.png");
      await expect(page.getByRole("tooltip")).toContainText(/\b\d+ B\b/);
      await message.focus();
      await message.press("Home");
      await page
        .getByRole("button", { name: "Insert [image1] into the message", exact: true })
        .click();
      await expect(message).toBeFocused();
      expect(await message.inputValue()).toContain("[image1]");
    }
});
