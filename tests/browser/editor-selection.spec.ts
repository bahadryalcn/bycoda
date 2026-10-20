import { expect, test } from "@playwright/test";

for (const mode of ["file", "inline", "split"]) {
  test(`readability preserves drafts and visible structure in ${mode}`, async ({ page }, info) => {
    await page.goto(`/tests/browser/editor-selection.html?readability=code&search=${mode}`);
    const editors = page.locator(".cm-editor");
    await expect(editors).toHaveCount(mode === "split" ? 2 : 1);
    for (const editor of await editors.all()) {
      await expect(editor.locator(".cm-commentAnnotation").first()).toContainText("TODO");
      await expect(editor.locator(".cm-indentBand-0").first()).toBeVisible();
      await expect(editor.locator(".cm-rainbowBracket-0").first()).toBeVisible();
      await expect(editor.locator(".cm-content")).not.toHaveCSS("background-image", "none");
      await expect(
        editor.locator('[class*="cm-rainbowBracket-"]').filter({ hasText: "not a bracket" }),
      ).toHaveCount(0);
    }
    const content = editors.last().locator(".cm-content");
    await content.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// unsaved draft");
    for (const light of [false, true]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        light,
      );
      const band = editors.last().locator(".cm-indentBand-0").first();
      await expect(band).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(content).toContainText("// unsaved draft");
      const alert = editors.last().locator(".cm-readability-error").first();
      const alertText = alert.locator("span").first();
      const expectedColor = await alert.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ui-code-error)";
        element.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      await expect((await alertText.count()) ? alertText : alert).toHaveCSS("color", expectedColor);
      await editors
        .last()
        .screenshot({ path: info.outputPath(`${mode}-${light ? "light" : "dark"}.png`) });
    }
  });
}

test("CSS color previews and variable completion work with unsaved declarations", async ({
  page,
}) => {
  await page.goto("/tests/browser/editor-selection.html?readability=css");
  const editor = page.locator(".cm-editor");
  await expect(editor.locator(".cm-colorSwatch")).toHaveCount(3);
  await expect(editor.locator('.cm-colorSwatch[title="#aabbcc"]')).toHaveCSS(
    "background-color",
    "rgb(170, 187, 204)",
  );
  const line = editor.locator(".cm-line").filter({ hasText: "color: var(--br)" });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+Space");
  await expect(editor.getByRole("option").filter({ hasText: "--brand" })).toHaveCount(1);
  await expect(editor.getByRole("option").filter({ hasText: "--brand" })).toBeVisible();
  // This is a deliberate CodeMirror interaction guard, rather than a network
  // or render wait: acceptance/navigation is disabled for 75ms after opening.
  await page.waitForTimeout(100);
  await page.keyboard.press("ArrowDown");
  await expect(editor.getByRole("option").filter({ hasText: "--brand" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(editor.locator(".cm-content")).toContainText("var(--brand)");
});

test("embedded CSS excludes HTML examples and matching tags remain interactive", async ({
  page,
}) => {
  await page.goto("/tests/browser/editor-selection.html?readability=html");
  const editor = page.locator(".cm-editor");
  await editor.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(editor.locator(".cm-matchingBracket")).toHaveText(["div", "div"]);
  const line = editor.locator(".cm-line").filter({ hasText: "color: var(--re)" });
  await line.click();
  await page.keyboard.press("Home");
  // The caret is between the e and ) in var(--re).
  for (let i = 0; i < 19; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+Space");
  await expect(editor.getByRole("option").filter({ hasText: "--real" })).toHaveCount(1);
  await expect(editor.getByRole("option").filter({ hasText: /--fake|--outside/ })).toHaveCount(0);
});

test("split originals stay read-only and edited text supports undo", async ({ page }) => {
  await page.goto("/tests/browser/editor-selection.html?readability=code&search=split");
  const editors = page.locator(".cm-editor");
  await expect(editors).toHaveCount(2);
  const original = editors.first().locator(".cm-content");
  const text = await original.textContent();
  await original.click();
  await page.keyboard.type("SHOULD_NOT_CHANGE");
  await expect(original).toHaveText(text!);
  const current = editors.last().locator(".cm-content");
  await current.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// undo this");
  await expect(current).toContainText("// undo this");
  await page.keyboard.press("Control+z");
  await expect(current).not.toContainText("// undo this");
  await expect(original).toHaveText(text!);
});

test("readability follows long-file scrolling in narrow reduced-motion layouts", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/tests/browser/editor-selection.html?readability=large");
  const editor = page.locator(".cm-editor");
  await editor.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await expect(editor.locator(".cm-content")).toContainText("block299");
  await expect(editor.locator(".cm-commentAnnotation").last()).toHaveText("TODO:");
  await expect(editor.locator(".cm-indentBand").last()).toBeVisible();
  await expect(editor.locator(".cm-rainbowBracket-1").last()).toBeVisible();
  await page.keyboard.press("Control+Home");
  await expect(editor.locator(".cm-content")).toContainText("block0");
  await expect(editor.locator(".cm-commentAnnotation").first()).toHaveText("TODO:");
});

test("output severity and asynchronous inline errors are visible", async ({ page }) => {
  await page.goto("/tests/browser/editor-selection.html?readability=log");
  await expect(page.locator(".cm-logLine-error")).toContainText("ERROR");
  await expect(page.locator(".cm-logLine-warning")).toContainText("WARN");
  await page.goto("/tests/browser/editor-selection.html");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("const broken = ;");
  await expect(page.locator(".cm-diagnosticLabel")).toContainText("error:");
});

test("code themes update open editors without replacing unsaved text", async ({ page }) => {
  await page.goto("/tests/browser/editor-selection.html");
  const content = page.locator(".cm-content").last();
  await content.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// unsaved draft");
  const keyword = content
    .locator("span")
    .filter({ hasText: /^const$/ })
    .first();
  await expect(keyword).toHaveCSS("color", "rgb(255, 123, 114)");
  await page.evaluate(() => {
    document.documentElement.dataset.codeTheme = "dracula";
  });
  await expect(keyword).toHaveCSS("color", "rgb(255, 121, 198)");
  await expect(content).toContainText("// unsaved draft");
  await page.evaluate(() => {
    document.documentElement.classList.add("theme-light");
    document.documentElement.style.setProperty("--appearance-code-size", "16px");
  });
  await expect(keyword).toHaveCSS("color", "rgb(207, 34, 46)");
  await expect(page.locator(".cm-editor").last()).toHaveCSS("font-size", "16px");
  await expect(content).toContainText("// unsaved draft");
});

for (const mode of ["file", "inline", "split"]) {
  test(`find stays readable and visible while scrolling ${mode}`, async ({ page }, info) => {
    await page.goto(`/tests/browser/editor-selection.html?search=${mode}`);
    const editor = page.locator(".cm-editor").last();
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+f");
    const find = editor.getByRole("textbox", { name: "Find", exact: true });
    await find.fill("value");
    await expect(editor.locator(".cm-find-count")).toContainText("300");
    await find.press("Control+h");
    const replace = editor.getByRole("textbox", { name: "Replace", exact: true });
    await expect(replace).toBeFocused();
    await expect(editor.getByRole("button", { name: "Replace all", exact: true })).toBeVisible();

    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 700 });
      for (const light of [false, true]) {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          light,
        );
        const minimumWidth = mode === "split" && width === 390 ? 60 : 100;
        await expect
          .poll(async () => (await find.boundingBox())?.width ?? 0)
          .toBeGreaterThan(minimumWidth);
        const panel = editor.locator(".cm-find");
        const bounds = await panel.boundingBox();
        expect(bounds!.width).toBeLessThanOrEqual(520);
        await expect(panel.getByRole("button", { name: "Toggle Replace" })).toBeInViewport();
        for (const control of await panel.locator("input, button, .cm-find-count").all()) {
          if (!(await control.isVisible())) continue;
          const box = (await control.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
          expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        }
      }
    }

    await page.setViewportSize({ width: mode === "split" ? 768 : 390, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scroller =
      mode === "split" ? page.locator(".cm-mergeView") : editor.locator(".cm-scroller");
    await scroller.evaluate((node) => {
      node.scrollTop = 1500;
    });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    await expect
      .poll(async () => {
        const panel = (await editor.locator(".cm-find").boundingBox())!;
        const area = (await (mode === "split" ? scroller : editor).boundingBox())!;
        return panel.y >= area.y - 1 && panel.y + panel.height <= area.y + area.height;
      })
      .toBe(true);
    await expect(find).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`find-${mode}.png`) });
    await find.press("Enter");
    await expect(editor.locator(".cm-find-count")).toContainText("2 of 300");
    await editor.getByRole("button", { name: "Toggle Replace" }).click();
    await expect(replace).toBeHidden();
    await editor.getByRole("button", { name: "Toggle Replace" }).press("Enter");
    await expect(editor.getByRole("textbox", { name: "Replace", exact: true })).toBeVisible();
    await find.press("Escape");
    await expect(find).toHaveCount(0);
  });
}

test("Ctrl+H opens replacement directly and both replacement actions edit the document", async ({
  page,
}) => {
  await page.goto("/tests/browser/editor-selection.html?search=file");
  const editor = page.locator(".cm-editor");
  await editor.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+h");
  const find = editor.getByRole("textbox", { name: "Find", exact: true });
  const replace = editor.getByRole("textbox", { name: "Replace", exact: true });
  await expect(replace).toBeFocused();
  await find.fill("value");
  await replace.fill("item");
  await editor.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor.locator(".cm-find-count")).toContainText("299");
  await editor.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor.locator(".cm-find-count")).toHaveText("No results");
  await replace.press("Escape");
  await page.keyboard.press("Control+Home");
  await expect(editor.locator(".cm-content")).toContainText("const item0");
});

test("selected code has a clickable chat action, shortcut and dismiss behavior", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/editor-selection.html", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".cm-content");
  const toolbar = page.getByRole("toolbar", { name: "Selected code actions" });
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(toolbar).toContainText("Ctrl+L");
  // The action and shortcut remain on one row, as in the editor reference.
  await expect(toolbar.getByRole("button")).toHaveCSS("white-space", "nowrap");
  await page.screenshot({ path: info.outputPath("selected-code-chat-action.png") });
  await toolbar.getByRole("button").click();
  await expect(page.getByRole("textbox", { name: "Chat draft" })).toHaveValue(
    "Explain this code\n\n@src/value.ts (lines 1-2)\n\n",
  );
  await expect(toolbar).toHaveCount(0);
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Control+l");
  await expect(page.getByRole("textbox", { name: "Chat draft" })).toHaveValue(
    "Explain this code\n\n@src/value.ts (lines 1-2)\n\n@src/value.ts (line 1)\n\n",
  );
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const mode of ["file", "inline", "split"]) {
  test(`Ctrl+wheel zooms the visible code in ${mode} editors`, async ({ page }) => {
    await page.goto(`/tests/browser/editor-selection.html?search=${mode}`);
    const editors = page.locator(".cm-editor");
    const content = editors.last().locator(".cm-content");
    await expect(content).toBeVisible();
    const sizes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".cm-editor .cm-content, .cm-editor .cm-gutters")].map(
          (node) => getComputedStyle(node).fontSize,
        ),
      );
    expect(new Set(await sizes())).toEqual(new Set(["13px"]));
    const box = (await content.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => new Set(await sizes())).toEqual(new Set(["15px"]));
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });
}
