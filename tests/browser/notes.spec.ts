import { expect, test, type Page } from "@playwright/test";

test("fills the note workspace and exposes each pane's remaining content", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes.html?long");
  const panes = page.locator(".note-editor-pane");
  await expect(panes).toHaveCount(2);
  await expect(page.getByRole("button", { name: "More below", exact: true })).toHaveCount(2);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    const bounds = await page.locator(".note-layout").boundingBox();
    expect(bounds!.y + bounds!.height).toBeGreaterThan(920);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(950);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const detail = page.locator(".note-detail");
    expect(
      await detail.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  const preview = panes.nth(1);
  await preview.getByRole("button", { name: "More below", exact: true }).click();
  expect(
    await preview.locator(".note-pane-scroll").evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await panes
      .first()
      .locator(".note-pane-scroll")
      .evaluate((node) => node.scrollTop),
  ).toBe(0);
  await preview.locator(".note-pane-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(preview.locator(".note-pane-footer")).toHaveText("End of note");
  await expect(preview.getByRole("button", { name: "Add text", exact: true })).toBeInViewport();
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(panes).toHaveCount(1);
  await page.getByRole("tab", { name: "Edit preview", exact: true }).click();
  await expect(panes).toHaveCount(1);
  await expect(preview).toHaveCount(0);
  await page.getByRole("tab", { name: "Split", exact: true }).click();
  await expect(panes).toHaveCount(2);
  await page.screenshot({
    path: `temp/verification/2026-10-17-notes-height/${testInfo.project.name}-dark.png`,
  });
  await page.evaluate(() => document.documentElement.classList.add("theme-light"));
  await page.screenshot({
    path: `temp/verification/2026-10-17-notes-height/${testInfo.project.name}-light.png`,
  });
});

async function choose(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("button", { name: new RegExp(`^${label}(?::|$)`) }).click();
  await page.getByRole("option", { name: option }).click();
}

test("session note picker overlays the editor, restores keyboard focus and opens the same note in the library", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes.html?panel");
  const editor = page.getByRole("textbox", { name: "Note", exact: true });
  await expect(editor).toHaveValue(/Release checklist/);
  const before = await editor.boundingBox();
  const switcher = page.getByRole("button", { name: "Switch note", exact: true });
  await switcher.click();
  const picker = page.getByRole("dialog", { name: "Switch note", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("textbox", { name: "Search notes" })).toBeFocused();
  expect(await editor.boundingBox()).toEqual(before);
  await picker.getByRole("textbox", { name: "Search notes" }).fill("no such note");
  await expect(picker).toContainText("No matching notes");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(switcher).toBeFocused();
  await expect(editor).toBeVisible();
  await page.screenshot({
    path: `temp/verification/2026-10-19-notes/${testInfo.project.name}-panel.png`,
  });
  await page.getByRole("button", { name: "Open note library", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(
    "Release planning",
  );
  await expect(page.locator('[data-note-id="note-1"]')).toHaveCount(0);
});

test("opening an empty session creates no document and browsing project notes remembers the selection", async ({
  page,
}) => {
  await page.goto("/tests/browser/notes.html?panel&empty");
  await expect(page.getByText("No notes for this session yet.", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { notesFixture: unknown[] }).notesFixture.length,
    ),
  ).toBe(42);
  await page.getByRole("button", { name: "Browse project notes" }).click();
  await page
    .getByRole("dialog", { name: "Switch note" })
    .getByRole("button", { name: /Note 03/ })
    .click();
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toHaveValue(
    "Project notes and ideas for item 3.",
  );
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByRole("group", { name: "Delete note permanently?" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { notesFixture: unknown[] }).notesFixture.length,
    ),
  ).toBe(42);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Note", exact: true })).toBeVisible();
});

test("bulk selection spans pages, confirms explicitly and deletes only selected notes", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes.html");
  await page.getByRole("button", { name: "Select notes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all filtered notes", exact: true }).check();
  await expect(page.getByText("42 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  for (const checkbox of await page.locator('.note-selectable-row input[type="checkbox"]').all()) {
    await expect(checkbox).toBeChecked();
  }
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete 42 notes permanently?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { notesFixture: unknown[] }).notesFixture.length,
    ),
  ).toBe(42);
  await page.getByRole("checkbox", { name: "Select all filtered notes", exact: true }).uncheck();
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Select note: Release planning", exact: true }).check();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { notesFixture: unknown[] }).notesFixture.length),
    )
    .toBe(41);
  await expect(page.locator('[data-note-id="note-0"]')).toHaveCount(0);
  await page.screenshot({
    path: `temp/verification/2026-10-19-notes/${testInfo.project.name}-bulk-result.png`,
  });
});

test("narrow library and editor switch without losing a draft", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/notes.html?theme=light");
  const title = page.getByRole("textbox", { name: "Note title", exact: true });
  await title.fill("Narrow layout draft");
  await expect(title).toBeInViewport();
  await page
    .locator(".note-mobile-navigation")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await expect(title).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "Filter notes" })).toBeInViewport();
  await page
    .locator(".note-mobile-navigation")
    .getByRole("button", { name: "Editor", exact: true })
    .click();
  await expect(title).toHaveValue("Narrow layout draft");
  const tags = page.locator('.note-detail-tags [data-tag="release"]');
  await expect(tags).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-19-notes/${testInfo.project.name}-narrow-light.png`,
  });
});

test("shared tags, searchable filters and visible save preserve note drafts", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes.html?theme=light");
  const tags = page.getByRole("textbox", { name: "Add note tag", exact: true });
  await tags.fill("#NEWTAG,");
  await expect(page.locator('.note-detail-tags [data-tag="newtag"]')).toBeVisible();
  await tags.fill("日本語");
  await tags.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(tags).toHaveValue("日本語");
  await tags.press("Enter");
  await expect(page.locator('.note-detail-tags [data-tag="日本語"]')).toBeVisible();
  await page.getByRole("button", { name: "Filters and options", exact: true }).click();
  await page.getByRole("button", { name: /^Filter by project:/ }).click();
  await page.getByRole("combobox").fill("mobile");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(
    "Release planning",
  );
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { notesFixture: { tags: string[] }[] }).notesFixture[0].tags,
      ),
    )
    .toEqual(expect.arrayContaining(["newtag", "日本語"]));
  await page.setViewportSize({ width: 768, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-16-ui-system/W4b-NOTES-${testInfo.project.name}-light-768.png`,
  });
});

test("quotes selected note text from preview and source through the contextual menu", async ({
  page,
}) => {
  await page.goto("/tests/browser/notes.html");
  await page.evaluate(() => {
    (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes = [];
    window.addEventListener("bycoda:add-to-chat", (event) => {
      (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes.push(
        (event as CustomEvent).detail,
      );
    });
  });
  const paragraph = page
    .locator("[data-note-preview] p")
    .filter({ hasText: "Write the launch summary here." })
    .first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const menu = page.getByRole("toolbar", { name: "Selected text actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Add to notes", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes),
    )
    .toEqual([{ text: "Write the launch summary here.", mode: "quote" }]);
  const source = page.locator(".note-split > div:first-child .cm-content");
  await source.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { selectedQuotes: { text: string }[] }).selectedQuotes[1]?.text,
      ),
    )
    .toBe("# Release checklist");
});

test("keeps note controls compact and confirms deletion in a focused dialog", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/notes.html");
  const filters = page.getByRole("button", { name: "Filters and options", exact: true });
  await expect(page.getByLabel("Filter by project", { exact: true })).toHaveCount(0);
  await filters.click();
  const options = page.getByRole("dialog", { name: "Filters and options" });
  await expect(options).toBeVisible();
  await choose(page, "Filter by tag", "#ideas");
  await expect(filters).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(filters).toBeFocused();
  await expect(page.getByLabel("Note title", { exact: true })).toBeVisible();
  const header = await page.locator(".note-detail-header").boundingBox();
  expect(header!.height).toBeLessThan(120);
  const title = await page.getByLabel("Note title", { exact: true }).boundingBox();
  const actions = await page.locator(".note-detail-actions").boundingBox();
  expect(actions!.x).toBeGreaterThan(title!.x + title!.width);
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-wide.png`,
  });
  const remove = page.getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const confirmation = page.getByRole("group", { name: "Delete note permanently?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Confirm delete" })).toBeFocused();
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-delete.png`,
  });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(page.getByLabel("Note title", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 700 });
  await expect(remove).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-compact.png`,
  });
});

test("groups and filters many notes, edits both panes, formats and saves preview changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/notes.html");
  await expect(page.getByRole("tab", { name: "Split", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".note-group-heading")).toHaveCount(3);
  await expect(page.locator('[data-note-library] [aria-current="true"]')).toBeInViewport();
  const source = page.locator(".note-split > div:first-child .cm-content");
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nSource input works.");
  await expect(page.locator("[data-note-preview]")).toContainText("Source input works.");
  await page.getByRole("tab", { name: "Edit preview", exact: true }).click();
  await page.locator(".note-edit-block").nth(1).click();
  const block = page.locator(".note-active-block .cm-content");
  await block.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Edited from preview");
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("button", { name: /^Bold/ }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-note-preview] [data-streamdown="strong"]')).toHaveText(
    "Edited from preview",
  );
  await page.getByRole("tab", { name: "Split", exact: true }).click();
  await expect(source).toContainText("**Edited from preview**");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { notesFixture: { body: string }[] }).notesFixture[0].body,
      ),
    )
    .toContain("**Edited from preview**");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { notesFixture: { body: string }[] }).notesFixture[0].body,
      ),
    )
    .toContain("const preserve = true;");
  await page.getByRole("button", { name: "Filters and options", exact: true }).click();
  await choose(page, "Filter by project", /mobile/i);
  await expect(page.locator("[data-note-library] li")).toHaveCount(14);
  await choose(page, "Filter by tag", "#ideas");
  await expect(page.locator("[data-note-library] li")).toHaveCount(7);
  await choose(page, "Group notes by", "Tags");
  await expect(page.locator(".note-group-heading")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator(".note-group-heading").click();
  await expect(page.locator("[data-note-library] li")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("uses available width and keeps the toolbar usable in smaller windows", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/notes.html?lang=tr");
  await expect(page.locator(".note-split")).toBeVisible();
  const width = await page.locator(".note-detail-content").boundingBox();
  expect(width!.width).toBeGreaterThan(1150);
  await page.screenshot({
    path: `temp/verification/2026-10-12-performance-fixes/notes/${testInfo.project.name}-wide.png`,
  });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByRole("button", { name: /^Kalın|^Bold/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `temp/verification/2026-10-12-performance-fixes/notes/${testInfo.project.name}-compact.png`,
  });
});

test("bounds a thousand large notes while fetching selected details and moving keyboard focus across pages", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/notes.html?count=1000");
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue("Release planning");
  const cards = page.locator("[data-note-library] li button");
  await expect.poll(() => cards.count()).toBeLessThanOrEqual(32);
  const initialCalls = await page.evaluate(
    () =>
      (window as unknown as { notesFixtureCalls: { command: string; bytes?: number }[] })
        .notesFixtureCalls,
  );
  expect(initialCalls.some((call) => call.command === "notes_list")).toBe(false);
  expect(initialCalls.filter((call) => call.command === "notes_get")).toHaveLength(1);
  expect(initialCalls.find((call) => call.command === "notes_list_summaries")!.bytes).toBeLessThan(
    650_000,
  );
  await page.getByRole("button", { name: "Filters and options", exact: true }).click();
  await choose(page, "Group notes by", "No grouping");
  await page.keyboard.press("Escape");
  await expect(cards).toHaveCount(32);
  await cards.last().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-note-id="note-32"]')).toBeFocused();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue("Note 32");
  await expect(cards).toHaveCount(32);
  await page.getByLabel("Filter notes", { exact: true }).fill("Search marker past preview 999");
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue("Note 999");
  await expect(page.locator("[data-note-preview]")).toContainText(
    "Search marker past preview 999.",
  );
  await page.getByRole("button", { name: "Clear filters", exact: true }).first().click();
  // The list uses a deferred query. Wait until its full-library result has
  // painted before navigating within that result, including on WebKit.
  await expect(page.getByText("1000 of 1000 notes", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(8);
  await expect.poll(() => cards.count()).toBeLessThanOrEqual(32);
  await expect(page.locator('[data-note-library] [aria-current="true"]')).toBeInViewport();
  await page.locator('[data-note-id="note-999"]').focus();
  await page.keyboard.press("Home");
  await expect(page.locator('[data-note-id="note-0"]')).toBeFocused();
  await expect(cards).toHaveCount(32);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          notesFixtureCalls: { command: string; id?: string; query?: string }[];
        }
      ).notesFixtureCalls,
  );
  expect(calls.filter((call) => call.command === "notes_get").map((call) => call.id)).toEqual([
    "note-0",
    "note-32",
    "note-999",
  ]);
  expect(
    calls.some(
      (call) => call.command === "notes_search" && call.query === "Search marker past preview 999",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `temp/verification/2026-10-12-performance-fixes/notes/${testInfo.project.name}-large-library.png`,
  });
});
