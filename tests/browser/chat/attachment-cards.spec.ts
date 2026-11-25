import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/2026-11-04-chat-thumbnails";

test("native composer displays the full URL without blank space inside the link", async ({
  page,
}) => {
  const evidence = "temp/verification/composer-link-spacing";
  await mkdir(evidence, { recursive: true });
  const address =
    "http://localhost:3000/dashboard/user/user-authorization-operations?view=permissions";
  const draft = `${address} üzerinden`;
  for (const theme of ["dark", "light"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/chat/attachment-cards.html?references&theme=${theme}`);
      const section = page.getByRole("region", { name: "Reference tokens" });
      const field = section.getByRole("textbox", { name: "Reference token message" });
      await field.fill(draft);
      await field.blur();
      const token = section.locator("[data-composer-link-token]");
      await expect(token).toBeVisible();
      await section.screenshot({ path: `${evidence}/${theme}-${width}.png` });
      const layout = await token.evaluate((link) => {
        const source = document.createTreeWalker(link, NodeFilter.SHOW_TEXT).nextNode()!;
        const url = document.createRange();
        url.selectNodeContents(source);
        const cursor = document.createTreeWalker(
          link.closest("[data-reference-overlay]")!,
          NodeFilter.SHOW_TEXT,
        );
        cursor.currentNode = source;
        let next = cursor.nextNode();
        while (next && !next.textContent?.includes("üzerinden")) next = cursor.nextNode();
        if (!next) throw new Error("Missing text after the link");
        const word = document.createRange();
        word.setStart(next, next.textContent!.indexOf("üzerinden"));
        word.setEnd(next, next.textContent!.length);
        const urlEnd = url.getBoundingClientRect().right;
        return {
          text: source.textContent,
          color: getComputedStyle(source.parentElement!).color,
          gap: word.getBoundingClientRect().left - urlEnd,
        };
      });
      expect(layout.text).toBe(address);
      expect(layout.color).not.toBe("rgba(0, 0, 0, 0)");
      expect(layout.gap).toBeGreaterThan(0);
      expect(layout.gap).toBeLessThan(8);
      await expect(field).toHaveValue(draft);
    }
  }
});

test("inline draft references open and keep a shared baseline", async ({ page }) => {
  await page.goto("/tests/browser/chat/attachment-cards.html?references&opener");
  const section = page.getByRole("region", { name: "Reference tokens", exact: true });
  const field = section.getByRole("textbox", { name: "Reference token message" });
  const draft =
    "Review /frontend-design /group-interface-design [image1] and https://example.com/design";
  await field.fill(draft);
  const skill = section.getByRole("button", { name: "frontend-design", exact: true });
  const group = section.getByRole("button", { name: "Design interfaces", exact: true });
  await expect(skill).toBeVisible({ timeout: 2000 });
  await expect(group).toHaveCSS("cursor", "pointer");
  expect((await skill.boundingBox())?.y).toBe((await group.boundingBox())?.y);
  await skill.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "frontend-design" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(skill).toBeFocused();
  await group.click();
  await expect(page.getByRole("dialog", { name: "Design interfaces" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(group).toBeFocused();
  const image = section
    .locator("[data-composer-reference-actions]")
    .getByRole("button", { name: /Open mountain-reference/ });
  await image.click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  const link = section.getByRole("link", { name: "https://example.com/design" });
  await expect(link).toHaveCSS("cursor", "pointer");
  await link.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-opened-url",
    "https://example.com/design",
  );
  await expect(field).toHaveValue(draft);

  const named =
    "Before[Image: fixture.png; ref=image_image] [file2] [Image: lost.png; ref=image_other]";
  await field.fill(named);
  await image.click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await section.getByRole("button", { name: "Open usage.csv" }).click();
  await expect(page.getByRole("dialog").getByText("composer")).toBeVisible();
  await page.keyboard.press("Escape");
  await section.getByRole("button", { name: "lost.png", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue(named);

  const longUrl = `https://example.org/${"very-long-path/".repeat(15)}?keep=1`;
  await field.fill(`Review [site](${longUrl}) afterwards`);
  const longLink = section.getByRole("link", { name: longUrl });
  await expect(longLink).toHaveAttribute("href", longUrl);
  await longLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-opened-url", longUrl);
  await field.fill("/group-interface-design");
  await field.press("Home");
  await field.pressSequentially("Review");
  await expect(field).toHaveValue("Review /group-interface-design");
  await expect(group).toBeVisible();
  await field.press("Control+z");
  await expect(field).not.toHaveValue("Review /group-interface-design");
  await expect(group).toBeVisible();
});

test("reference token icons preserve editable text in both themes and widths", async ({ page }) => {
  const evidence = "temp/verification/composer-inline-actions";
  await mkdir(evidence, { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(`/tests/browser/chat/attachment-cards.html?references&theme=${theme}`, {
        waitUntil: "domcontentloaded",
      });
      const section = page.getByRole("region", { name: "Reference tokens", exact: true });
      const field = section.getByRole("textbox", { name: "Reference token message" });
      const raw = await field.inputValue();
      expect(raw).toContain("/frontend-design and $frontend-design before /unknown");
      expect(raw).toContain("[Image\u00a01\u00a0·");
      expect(raw).toContain("@jira:PFDEV-1196");
      const overlay = section.locator("[data-reference-overlay]");
      // The visible skill names use icons while the textarea keeps the raw invocation.
      await expect(
        overlay.locator("[data-composer-skill-token] [data-draft-token-label]"),
      ).toHaveText(["frontend-design", "frontend-design"]);
      await expect(overlay.locator("[data-composer-skill-token] svg")).toHaveCount(2);
      await expect(overlay.locator("[data-composer-attachment-kind] svg")).toHaveCount(3);
      await expect(overlay.locator("[data-mcp-tag] svg")).toHaveCount(1);
      await expect(overlay.locator("[data-work-item-mention] svg")).toHaveCount(3);
      await expect(overlay.locator("[data-composer-link-token]")).toHaveCount(4);
      const transcript = section.locator("[data-reference-transcript]");
      await expect(transcript.locator("[data-skill-token] svg")).toHaveCount(2);
      await expect(transcript.locator("[data-work-item-mention] svg")).toHaveCount(3);
      await field.fill(`${raw}\nKeep raw references intact.`);
      await expect(field).toHaveValue(`${raw}\nKeep raw references intact.`);
      await field.fill(raw);
      await field.blur();
      await expect(field).toHaveValue(raw);
      await field.fill("$frontend-design [image1]");
      const skill = overlay.locator("[data-composer-skill-token]");
      const attachment = overlay.locator("[data-composer-attachment-kind]");
      const skillBox = await skill.boundingBox();
      const attachmentBox = await attachment.boundingBox();
      expect(skillBox).not.toBeNull();
      expect(attachmentBox).not.toBeNull();
      expect(attachmentBox!.x - (skillBox!.x + skillBox!.width)).toBeGreaterThan(2);
      const iconBox = await attachment.locator("svg").boundingBox();
      expect(iconBox).not.toBeNull();
      expect(iconBox!.x).toBeGreaterThanOrEqual(attachmentBox!.x + 1);
      expect(iconBox!.x + iconBox!.width).toBeLessThan(attachmentBox!.x + attachmentBox!.width - 1);
      await page.screenshot({
        path: `${evidence}/tokens-${theme}-${width}.png`,
        fullPage: true,
      });
      await field.fill(raw);
      const dimensions = await section.evaluate((element) => ({
        section: element.scrollWidth <= element.clientWidth,
        document: document.documentElement.scrollWidth <= window.innerWidth,
        editor:
          element.querySelector("textarea")!.scrollWidth <=
          element.querySelector("textarea")!.clientWidth,
      }));
      expect(dimensions).toEqual({ section: true, document: true, editor: true });
      await page.screenshot({ path: `${evidence}/fixture-${theme}-${width}.png`, fullPage: true });
      await field.fill(
        "Review /frontend-design /group-interface-design [image1] and https://example.com/design",
      );
      const group = section.getByRole("button", { name: "Design interfaces", exact: true });
      await group.click();
      await expect(page.getByRole("dialog", { name: "Design interfaces" })).toBeVisible();
      await page.screenshot({
        path: `${evidence}/group-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  }
});

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
      const read = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          background: style.backgroundColor,
          borderWidth: style.borderTopWidth,
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
        // Surface's attachment variant uses a 14% kind-ink wash and no kind-colored frame.
        probe.style.cssText = `color:var(${role});background:color-mix(in srgb,var(${role}) 14%,transparent)`;
        card.parentElement!.append(probe);
        const expectedCard = read(probe);
        // DraftToken's face paints the background over the hidden source text.
        probe.style.background = `color-mix(in oklch,var(${role}) 12%,transparent)`;
        const expectedHighlight = read(probe);
        probe.remove();
        const composerToken = document.querySelector(
          `[aria-label="Composer"] [data-composer-attachment-kind="${kind}"] > [aria-hidden="true"]`,
        )!;
        const transcriptToken = document.querySelector(
          `[aria-label="Message"] span[data-attachment-kind="${kind}"]`,
        )!;
        // File cards wrap the name instead of truncating it; it is the card's inherited-tone medium text.
        const name = card.querySelector('[data-tone="inherit"][data-weight="medium"]');
        return {
          kind,
          expectedCard,
          expectedHighlight,
          card: read(card),
          composer: read(composerToken),
          transcript: read(transcriptToken),
          ...(name ? { name: read(name) } : {}),
        };
      });
    });
    for (const tone of tones) {
      expect(tone.card.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.card.background, tone.kind).toBe(tone.expectedCard.background);
      expect(tone.card.borderWidth, tone.kind).toBe("0px");
      if (tone.kind !== "image") expect(tone.name?.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.composer.color, tone.kind).toBe(tone.expectedCard.color);
      expect(tone.composer.background, tone.kind).toBe(tone.expectedHighlight.background);
      expect(tone.composer.shadow, tone.kind).toBe("none");
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
  await composer.getByRole("button", { name: /^Insert \[Image\s1\s·/ }).click();
  await expect(message).toBeFocused();
  const token = /^Review (\[Image\u00a01\u00a0·[^\]]+\]) this$/.exec(
    await message.inputValue(),
  )?.[1];
  expect(token).toBeDefined();
  expect(await message.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(
    "Review ".length + token!.length + 1,
  );
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

test("real Composer shows pasted files in cards and inline and renumbers removal", async ({
  page,
}) => {
  await mkdir(captures, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    const storedFiles = new Map<string, string>();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) =>
          document.documentElement.setAttribute("data-copied-path", text),
        write: async ([item]: ClipboardItem[]) => {
          const bitmap = await createImageBitmap(await item.getType("image/png"));
          document.documentElement.setAttribute(
            "data-copied-image",
            `${bitmap.width}x${bitmap.height}`,
          );
          bitmap.close();
        },
      },
    });
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (
          command: string,
          args: { name?: string; data?: string; path?: string } = {},
        ) => {
          if (command === "plugin:event|listen") return 1;
          if (command === "write_attachment") {
            const path = `/fixture/.attachments/${args.name}`;
            storedFiles.set(path, args.data ?? "");
            return path;
          }
          if (command === "read_binary_file" || command === "read_file_base64")
            return storedFiles.get(args.path ?? "");
          if (command === "save_file_copy") {
            document.documentElement.setAttribute("data-saved-image", args.name ?? "");
            return true;
          }
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
        const makeImage = (name: string, type: string, size: number, color: string) => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d")!;
          context.fillStyle = color;
          context.fillRect(0, 0, size, size);
          const bytes = Uint8Array.from(atob(canvas.toDataURL(type).split(",")[1]), (char) =>
            char.charCodeAt(0),
          );
          return new File([bytes], name, { type });
        };
        const clipboardData = new DataTransfer();
        clipboardData.items.add(makeImage("first-reference.png", "image/png", 1, "steelblue"));
        clipboardData.items.add(makeImage("second-reference.jpg", "image/jpeg", 2, "seagreen"));
        clipboardData.items.add(
          new File(["# Notes\nRetain all draft text."], "implementation-notes.md", {
            type: "text/markdown",
          }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
        );
      });
      const editor = page.locator("[data-composer-inline-input]");
      const references = editor.locator('[data-inline-reference="attachment"]');
      await expect(references).toHaveCount(3);
      const cards = page.locator("[data-composer] [data-attachment-chip]");
      await expect(cards).toHaveCount(3);
      const firstImageCard = cards.filter({
        has: page.getByRole("button", { name: "Open first-reference.png full screen" }),
      });
      await expect(firstImageCard.getByRole("button")).toHaveCount(2);
      await page.mouse.move(0, 0);
      for (const card of await cards.all()) {
        const remove = card.getByRole("button", { name: /^Remove / });
        await expect(remove).toHaveCSS("opacity", "0");
      }
      for (const card of await cards.all()) {
        await card.hover();
        await expect(card.getByRole("button", { name: /^Remove / })).toHaveCSS("opacity", "1");
      }
      await firstImageCard.click({ button: "right" });
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "Copy image" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Save image" })).toBeVisible();
      await menu.screenshot({ path: `${captures}/card-menu-${theme}-${width}.png` });
      await menu.getByRole("menuitem", { name: "Copy full path" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-copied-path",
        "/fixture/.attachments/first-reference.png",
      );
      await firstImageCard.click({ button: "right" });
      await menu.getByRole("menuitem", { name: "Copy relative path" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-copied-path",
        ".attachments/first-reference.png",
      );
      await firstImageCard
        .getByRole("button", { name: "Open first-reference.png full screen" })
        .click();
      await expect(page.getByRole("dialog").locator("img")).toBeVisible();
      await page.getByRole("dialog").locator("img").click({ button: "right" });
      await expect(menu.getByRole("menuitem", { name: "Copy image" })).toBeVisible();
      await menu.screenshot({ path: `${captures}/preview-menu-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").locator("img").click({ button: "right" });
      await menu.getByRole("menuitem", { name: "Copy image" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-copied-image", "1x1");
      await page.getByRole("dialog").locator("img").click({ button: "right" });
      await menu.getByRole("menuitem", { name: "Save image" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-saved-image", "first-reference.png");
      await page.keyboard.press("Escape");
      // The underlying field keeps the plain-text draft the Host receives.
      const draft = page.locator("[data-composer] textarea");
      await expect(draft).toHaveValue(
        /^Review references and retain this existing draft\. \[Image\u00a01\u00a0·[^\]]+\] \[Image\u00a02\u00a0·[^\]]+\] \[File\u00a01\u00a0·[^\]]+\]$/,
      );
      await expect(
        editor.locator('[data-inline-reference][data-attachment-kind="image"]'),
      ).toHaveCount(2);
      await expect(
        editor.locator('[data-inline-reference][data-attachment-kind="markdown"]'),
      ).toHaveCount(1);
      await firstImageCard.hover();
      await page
        .locator("[data-composer-box]")
        .screenshot({ path: `${captures}/real-composer-${theme}-${width}.png` });
      if (theme === "dark") {
        await firstImageCard.getByRole("button", { name: "Remove first-reference.png" }).click();
      } else {
        await firstImageCard.click({ button: "right" });
        await menu.getByRole("menuitem", { name: "Remove first-reference.png" }).click();
      }
      await expect(cards).toHaveCount(2);
      await expect(references).toHaveCount(2);
      await expect(draft).toHaveValue(
        /^Review references and retain this existing draft\. \[Image\u00a01\u00a0·[^\]]+\] \[File\u00a01\u00a0·[^\]]+\]$/,
      );
      const remainingImage = editor.locator(
        '[data-inline-reference][data-attachment-kind="image"]',
      );
      await expect(remainingImage).toHaveCount(1);
      await expect(remainingImage).toHaveAccessibleName("Open second-reference.jpg");
      await remainingImage.click();
      await expect(page.getByRole("dialog").locator("img")).toBeVisible();
      await page.getByRole("dialog").locator("img").click({ button: "right" });
      await menu.getByRole("menuitem", { name: "Copy image" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-copied-image", "2x2");
      await page.keyboard.press("Escape");
      await expect(remainingImage).toBeFocused();
    }
});
