import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/attachment-cards";

test("attachment surfaces retain native caret, insertion and removal", async ({ page }) => {
  await page.goto("/tests/browser/attachment-cards.html");
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
  await page.goto("/tests/browser/attachment-cards.html");
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

test("broken thumbnail falls back to image identity", async ({ page }) => {
  await page.goto("/tests/browser/attachment-cards.html?broken");
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
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/attachment-cards.html?theme=${theme}`);
      await expect(page.getByRole("heading", { name: "Attachments", exact: true })).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Composer", exact: true })
          .locator("[data-attachment-kind]"),
      ).toHaveCount(10);
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
      await page.goto("/tests/browser/composer-extras.html?chat-layout");
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
      await expect(page.locator('[data-attachment-kind="image"]')).toContainText(
        "second-reference.png",
      );
      await message.focus();
      await message.press("Home");
      await page
        .getByRole("button", { name: "Insert [image1] into the message", exact: true })
        .click();
      await expect(message).toBeFocused();
      expect(await message.inputValue()).toContain("[image1]");
    }
});
