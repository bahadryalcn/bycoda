import { expect, test } from "@playwright/test";

test("native draft save reporting never marks edits made during an older disk write as saved", async ({
  page,
}) => {
  await page.goto("/tests/browser/file-save.html?native-draft&hold-write");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  const editor = page.locator(".cm-content:visible");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Older saved edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as { fileSaveFixture: { releaseWrite: unknown } }).fileSaveFixture
            .releaseWrite,
      ),
    )
    .toBe(true);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Newer unsaved edit");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              fileSaveFixture: { nativeDraft: { payload: { text: string } } | null };
            }
          ).fileSaveFixture.nativeDraft?.payload.text,
      ),
    )
    .toContain("Newer unsaved edit");
  await page.evaluate(() => {
    const fixture = (
      window as unknown as { fileSaveFixture: { holdWrites: boolean; releaseWrite: () => void } }
    ).fileSaveFixture;
    fixture.holdWrites = false;
    fixture.releaseWrite();
  });
  await expect(page.getByLabel("Disk writes")).toContainText("1: ");
  await expect(page.getByLabel("Disk writes")).not.toContainText("Newer unsaved edit");
  await expect(page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ })).toHaveAttribute(
    "title",
    /Unsaved changes/,
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fileSaveFixture: { nativeDraft: { metadata: { state: string } } } })
          .fileSaveFixture.nativeDraft.metadata.state,
    ),
  ).toBe("retained");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Disk writes")).toContainText("2: ");
  await expect(page.getByLabel("Disk writes")).toContainText("Newer unsaved edit");
});

test("native draft fixture retains actual source edits and retries storage without writing the file", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/file-save.html?native-draft&draft-error");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  const editor = page.locator(".cm-content:visible");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Recovery-only edit");
  await expect(page.getByRole("alert")).toContainText("Draft recovery copy could not be confirmed");
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 800 });
    for (const light of [false, true]) {
      await page.evaluate((light) => {
        (
          window as unknown as { fileSaveFixture: { setTheme: (light: boolean) => void } }
        ).fileSaveFixture.setTheme(light);
      }, light);
      await page.screenshot({
        path: info.outputPath(`draft-error-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
    }
  }
  await expect(page.getByLabel("Disk writes")).toHaveText("0");
  await page.evaluate(() => {
    (window as unknown as { fileSaveFixture: { failDrafts: boolean } }).fileSaveFixture.failDrafts =
      false;
  });
  await page.getByRole("button", { name: "Retry draft copy", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              fileSaveFixture: { nativeDraft: { payload: { text: string } } | null };
            }
          ).fileSaveFixture.nativeDraft?.payload.text,
      ),
    )
    .toContain("Recovery-only edit");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Disk writes")).toHaveText("0");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Disk writes")).toContainText("1: ");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { fileSaveFixture: { draftReports: unknown[] } }).fileSaveFixture
            .draftReports.length,
      ),
    )
    .toBe(1);
});

for (const width of [1280, 800]) {
  for (const light of [false, true]) {
    test(`native draft initialization preserves disk and restores dirty text ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/file-save.html?native-draft&restore-draft${light ? "&light" : ""}`,
      );
      await expect(page.getByRole("button", { name: "Restore draft", exact: true })).toBeVisible();
      await expect(page.getByLabel("Disk writes")).toHaveText("0");
      await page.screenshot({
        path: info.outputPath(`draft-choice-${width}-${light ? "light" : "dark"}.png`),
      });
      await page.getByRole("button", { name: "Restore draft", exact: true }).click();
      await expect(page.locator(".cm-content:visible")).toContainText("Saved recovery text");
      await expect(page.locator("footer [role=status]")).toContainText("Unsaved changes");
      await expect(
        page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
      ).toHaveAttribute("title", /Unsaved changes/);
      await expect(page.getByLabel("Disk writes")).toHaveText("0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`draft-restored-${width}-${light ? "light" : "dark"}.png`),
      });
      // Observe a full autosave window: recovery requires a reviewed manual save.
      await page.waitForTimeout(1100);
      await expect(page.getByLabel("Disk writes")).toHaveText("0");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByLabel("Disk writes")).toContainText("1: # Recovered notes");
      await expect(page.locator("footer [role=status]")).toHaveText("Saved");
    });
  }
}

test("same-name file tabs keep independent drafts and expose their full path from the keyboard", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/file-save.html?same-name");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  const first = page.locator('[role="tab"][title^="/fixture/notes.md"]');
  const second = page.locator('[role="tab"][title^="/fixture/archive/notes.md"]');
  const editor = page.locator(".cm-content:visible");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("First unsaved draft");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(editor).toContainText("Archived text");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Second unsaved draft");
  await second.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fileSaveFixture: { copiedText: string } }).fileSaveFixture
          .copiedText,
    ),
  ).toBe("/fixture/archive/notes.md");
  await second.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(editor).toContainText("First unsaved draft");
  await expect(editor).not.toContainText("Second unsaved draft");
  await expect(first).toHaveAttribute("title", /Unsaved changes/);
  await expect(second).toHaveAttribute("title", /Unsaved changes/);
  await page.getByRole("button", { name: "Save", exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel("Disk writes")).toContainText("First unsaved draft");
  await expect(first).not.toHaveAttribute("title", /Unsaved changes/);
  await expect(second).toHaveAttribute("title", /Unsaved changes/);
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(editor).toContainText("Second unsaved draft");
  await page.screenshot({ path: info.outputPath("same-name-drafts-390.png") });
});

for (const light of [false, true]) {
  test(`long save failure stays readable and retry preserves the draft in ${light ? "light" : "dark"}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/tests/browser/file-save.html?save-error${light ? "&light" : ""}`);
    await page.getByRole("tab", { name: "Source", exact: true }).click();
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("Keep my failed draft");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    const failure = page.locator("footer [role=status]");
    const message = await page.evaluate(
      () => (window as unknown as { fileSaveFixture: { error: string } }).fileSaveFixture.error,
    );
    await expect(failure).toHaveText(`Save failed: ${message}`);
    await expect(failure).toBeInViewport();
    expect(
      await failure.evaluate(
        (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(editor).toContainText("Keep my failed draft");
    await expect(
      page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
    ).toHaveAttribute("title", /Unsaved changes/);
    await expect(page.getByLabel("Disk writes")).toHaveText("0");
    await page.screenshot({
      path: info.outputPath(`save-error-${light ? "light" : "dark"}-320.png`),
    });
    await page.evaluate(() => {
      (
        window as unknown as { fileSaveFixture: { failWrites: boolean } }
      ).fileSaveFixture.failWrites = false;
    });
    await save.click();
    await expect(failure).toHaveText("Saved");
    await expect(page.getByLabel("Disk writes")).toContainText("1: ");
    await expect(page.getByLabel("Disk writes")).toContainText("Keep my failed draft");
    await expect(editor).toContainText("Keep my failed draft");
    await expect(
      page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
    ).not.toHaveAttribute("title", /Unsaved changes/);
  });
}

test("save works from editor, Explorer and preview without taking over chat", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/file-save.html");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const source = page.getByRole("tab", { name: "Source", exact: true });
  const preview = page.getByRole("tab", { name: "Preview", exact: true });
  await source.click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("First edit");
  await expect(page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ })).toHaveAttribute(
    "title",
    /Unsaved changes/,
  );
  await expect(
    page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
  ).toHaveAccessibleName("notes.md Unsaved changes");
  await expect(page.locator("footer [role=status]")).toContainText("Unsaved changes");
  await page.keyboard.press("Control+s");
  const writes = page.getByLabel("Disk writes");
  await expect(writes).toContainText("1: ");
  await expect(writes).toContainText("First edit");
  await expect(
    page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
  ).not.toHaveAttribute("title", /Unsaved changes/);
  await page.keyboard.type(" second");
  await page.locator("button[data-explorer-root]").click();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("2: ");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" third");
  await preview.click();
  await expect(page.locator("[data-markdown-view-active]")).toContainText(
    "First edit second third",
  );
  await page.getByRole("textbox", { name: "Chat draft" }).focus();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("2: ");
  await save.click();
  await expect(writes).toContainText("3: ");
  await expect(page.locator("footer [role=status]")).toContainText("Saved");
  await preview.focus();
  await page.keyboard.press("Control+s");
  await expect(writes).toContainText("4: ");

  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    for (const light of [false, true]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        light,
      );
      await expect(save).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: info.outputPath("save-mobile.png") });
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  await page.getByRole("switch", { name: "Autosave", exact: true }).click();
  await page.getByRole("button", { name: "Editor settings", exact: true }).click();
  await source.click();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" autosaved");
  await expect(writes).toContainText("5: ");
  await expect(writes).toContainText("autosaved");
  await expect(
    page.getByRole("tab", { name: /^notes\.md(?: Unsaved changes)?$/ }),
  ).not.toHaveAttribute("title", /Unsaved changes/);
  expect(errors).toEqual([]);
});
