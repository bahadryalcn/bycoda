import { expect, test, type Page } from "@playwright/test";
import {
  dropAnnouncer,
  dropBadge,
  dropMarks,
  fileDrag,
  files,
  textDrag,
} from "../support/external-drop";

test("image picker keeps progress on its button and note content readable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/notes/notes.html");
  const image = page.getByRole("button", { name: "Insert image", exact: true });
  await image.focus();
  await image.press("Enter");
  await expect(image).toHaveAttribute("aria-busy", "true");
  await expect(image).toBeFocused();
  await expect(page.getByText("Adding images…", { exact: true })).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    await page.screenshot({ path: testInfo.outputPath(`image-picker-390-${theme}.png`) });
  }
  await page.evaluate(() => (window as any).imagePickerControl.finish());
  await expect(image).not.toHaveAttribute("aria-busy", "true");
  expect(
    await page.evaluate(() =>
      (window as any).notesFixtureCalls.filter(
        (call: { command: string }) => call.command === "notes_upsert",
      ),
    ),
  ).toHaveLength(0);
});

test("fills the note workspace and exposes each pane's remaining content", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes/notes.html?long");
  const panes = page.locator(".note-editor-pane");
  // Document is the default view; Split shows both panes side by side.
  await expect(panes).toHaveCount(1);
  await page.getByRole("tab", { name: "Split", exact: true }).click();
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
  await expect(preview.getByRole("button", { name: "More below", exact: true })).toHaveCount(0);
  expect(
    await preview
      .locator(".note-pane-scroll")
      .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeLessThanOrEqual(2);
  await expect(preview.getByRole("button", { name: "Add text", exact: true })).toBeInViewport();
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(panes).toHaveCount(1);
  await page.getByRole("tab", { name: "Document", exact: true }).click();
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
  await page.goto("/tests/browser/notes/notes.html?panel");
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
  await page.goto("/tests/browser/notes/notes.html?panel&empty");
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
  await page.goto("/tests/browser/notes/notes.html");
  await page.getByRole("button", { name: "Select notes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all filtered notes", exact: true }).check();
  await expect(page.getByText("42 selected", { exact: true })).toBeVisible();
  // The library is one continuous list; every filtered note row is selected.
  await expect(page.locator('.note-selectable-row input[type="checkbox"]')).toHaveCount(42);
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
  await page.goto("/tests/browser/notes/notes.html?theme=light");
  // Retain Split as the desktop mode, then narrow the window to a single pane.
  await page.getByRole("tab", { name: "Split", exact: true }).click();
  await expect(page.locator(".note-editor-pane")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const title = page.getByRole("textbox", { name: "Note title", exact: true });
  await title.fill("Narrow layout draft");
  await expect(title).toBeInViewport();
  await page
    .locator(".note-mobile-navigation")
    .getByRole("tab", { name: "Notes", exact: true })
    .click();
  await expect(title).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "Filter notes" })).toBeInViewport();
  await page
    .locator(".note-mobile-navigation")
    .getByRole("tab", { name: "Editor", exact: true })
    .click();
  await expect(title).toHaveValue("Narrow layout draft");
  await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".note-editor-pane")).toHaveCount(1);
  const tags = page.locator('.note-detail-tags [data-tag="release"]');
  await expect(tags).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-19-notes/${testInfo.project.name}-narrow-light.png`,
  });
  await page.getByRole("tab", { name: "Document", exact: true }).click();
  await expect(page.locator(".note-editor-pane")).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 950 });
  await expect(page.getByRole("tab", { name: "Split", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".note-editor-pane")).toHaveCount(2);
  await expect(title).toHaveValue("Narrow layout draft");
});

test("shared tags, searchable filters, autosave and keyboard save preserve note drafts", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/notes/notes.html?theme=light");
  const tags = page.getByRole("textbox", { name: "Add note tag", exact: true });
  // The tag shell measures its rows right after mount and re-renders once. WebKit can
  // deliver the first input while that measured render is in flight and drops it, so
  // wait for the measured height before typing, as a person would.
  await expect(page.locator(".note-detail-tags [data-ui-focus-group]")).toHaveAttribute(
    "style",
    /height: \d+px/,
  );
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
  // Routine saves are automatic; the library deliberately has no Save button.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { notesFixture: { tags: string[] }[] }).notesFixture[0].tags,
      ),
    )
    .toEqual(expect.arrayContaining(["newtag", "日本語"]));
  const title = page.getByRole("textbox", { name: "Note title", exact: true });
  await title.fill("Release planning · keyboard save");
  await title.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { notesFixture: { title: string }[] }).notesFixture[0].title,
      ),
    )
    .toBe("Release planning · keyboard save");
  await page.setViewportSize({ width: 768, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-16-ui-system/W4b-NOTES-${testInfo.project.name}-light-768.png`,
  });
});

test("quotes selected note text from preview and source through the contextual menu", async ({
  page,
}) => {
  await page.goto("/tests/browser/notes/notes.html");
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
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  const source = page.locator(".note-editor-pane .cm-content");
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
  await page.goto("/tests/browser/notes/notes.html");
  const filters = page.getByRole("button", { name: "Filters and options", exact: true });
  await expect(page.getByLabel("Filter by project", { exact: true })).toHaveCount(0);
  await filters.click();
  const options = page.getByRole("dialog", { name: "Filters and options" });
  await expect(options).toBeVisible();
  await choose(page, "Filter by tag", "#ideas");
  // The shared FilterTrigger shows how many filters narrow the library.
  await expect(filters).toContainText("1");
  await page.keyboard.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(filters).toBeFocused();
  await page.getByRole("button", { name: "Reset project and tag filters", exact: true }).click();
  await expect(filters).not.toContainText("1");
  await expect(page.getByLabel("Note title", { exact: true })).toBeVisible();
  const header = await page.locator(".note-detail-header").boundingBox();
  expect(header!.height).toBeLessThan(120);
  const title = await page.getByLabel("Note title", { exact: true }).boundingBox();
  const actions = await page.locator(".note-detail-actions").boundingBox();
  expect(actions!.x).toBeGreaterThan(title!.x + title!.width);
  // Delete belongs to the library row, outside the editor's Details controls.
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Actions for Release planning", exact: true });
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-wide.png`,
  });
  await menu.click();
  const remove = page
    .getByRole("menu", { name: "Note actions", exact: true })
    .getByRole("menuitem", { name: "Delete note", exact: true });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete note permanently?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-delete.png`,
  });
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Note actions" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { notesFixture: unknown[] }).notesFixture.length,
    ),
  ).toBe(42);
  await expect(menu).toBeFocused();
  await expect(page.getByLabel("Note title", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 700 });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `temp/verification/2026-10-13-notes-controls/${testInfo.project.name}-compact.png`,
  });
});

test("groups and filters many notes, edits both panes, formats and saves preview changes", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/notes/notes.html");
  await expect(page.getByRole("tab", { name: "Document", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Split", exact: true }).click();
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
  await page.getByRole("tab", { name: "Document", exact: true }).click();
  await page.locator("[data-note-preview] .note-preview-content").nth(1).click();
  const block = page.locator(".note-active-block .cm-content");
  await block.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Edited from preview");
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("button", { name: /^Bold/ }).click();
  await page.getByRole("button", { name: "Read document", exact: true }).click();
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
  // Each note also contains a semantic Tags list; count canonical note cards,
  // not the nested tag listitems.
  const cards = page.locator("[data-note-library] [data-note-id]");
  await expect(cards).toHaveCount(14);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-note-id")).sort(),
    ),
  ).toEqual(Array.from({ length: 14 }, (_, index) => `note-${index * 3 + 1}`).sort());
  const capture = async (state: string) => {
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(`${state}-${light ? "light" : "dark"}.png`),
      });
    }
  };
  await capture("project-filter");
  await choose(page, "Filter by tag", "#ideas");
  await expect(cards).toHaveCount(7);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-note-id")).sort(),
    ),
  ).toEqual(Array.from({ length: 7 }, (_, index) => `note-${index * 6 + 1}`).sort());
  await choose(page, "Group notes by", "Tags");
  await expect(page.locator(".note-group-heading")).toHaveCount(1);
  await capture("project-tag-filter");
  await page.keyboard.press("Escape");
  await page.locator(".note-group-heading").click();
  await expect(cards).toHaveCount(0);
  await capture("collapsed-group");
  expect(errors).toEqual([]);
});

test("uses available width and keeps the toolbar usable in smaller windows", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/notes/notes.html?lang=tr");
  await page.getByRole("tab", { name: "Bölünmüş görünüm", exact: true }).click();
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
  page.on("pageerror", (error) => {
    // WebKit reports the browser's benign ResizeObserver loop notice as an error event while the
    // virtual library measures rows that scrolled into view; it is not an application exception.
    if (!error.message.startsWith("ResizeObserver loop")) errors.push(error.message);
  });
  await page.goto("/tests/browser/notes/notes.html?count=1000");
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue("Release planning");
  // The library renders a bounded virtual window instead of 32-note pages.
  const cards = page.locator("[data-note-library] button[data-note-id]");
  const bounded = () => expect.poll(() => cards.count()).toBeLessThanOrEqual(64);
  await bounded();
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
  await expect(page.locator('[data-note-library] [data-note-id="note-1"]')).toBeVisible();
  await bounded();
  // ArrowDown from the last rendered card moves past the window edge.
  const lastId = await cards.last().getAttribute("data-note-id");
  const nextIndex = Number(lastId!.replace("note-", "")) + 1;
  await cards.last().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-note-id="note-${nextIndex}"]`)).toBeFocused();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(`Note ${nextIndex}`);
  await bounded();
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
  await expect(page.getByText("1000 notes", { exact: true })).toBeVisible();
  await bounded();
  await expect(page.locator('[data-note-library] [aria-current="true"]')).toBeInViewport();
  await page.locator('[data-note-id="note-999"]').focus();
  await page.keyboard.press("Home");
  await expect(page.locator('[data-note-id="note-0"]')).toBeFocused();
  await bounded();
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
    `note-${nextIndex}`,
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

for (const theme of ["light", "dark"] as const) {
  test(`external drop: the note editor shows Insert image, refuses other files and leaves text drops alone ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/notes/notes.html?theme=${theme}`);
    const zone = page.locator('[data-external-drop-owner="note-images"]');
    await expect(zone).toBeVisible();
    await page.getByRole("tab", { name: "Split", exact: true }).click();

    // A text drag keeps the editor's own caret and text-drop behaviour: no mark, no badge.
    await textDrag(zone, "dragover");
    await expect(dropBadge(page)).toHaveCount(0);
    await expect(dropMarks(page)).toHaveCount(0);

    await fileDrag(zone, "dragover", files(1));
    await expect(zone).toHaveAttribute("data-drop-indicator", "inside");
    await expect(dropBadge(page)).toHaveText("Insert image");
    await expect(dropAnnouncer(page)).toHaveText("Insert image");
    await expect(dropMarks(page)).toHaveCount(1);
    // The old in-editor overlay sentence is not drawn next to the badge.
    await expect(zone.getByText("Drop images here")).toHaveCount(0);
    await page.screenshot({ path: `temp/verification/vis-dnd-4/notes-insert-image-${theme}.png` });

    await fileDrag(zone, "dragover", files(3));
    await expect(dropBadge(page)).toHaveText("Insert 3 images");

    await fileDrag(zone, "dragover", [{ name: "report.pdf", type: "application/pdf" }]);
    await expect(zone).toHaveAttribute("data-drop-indicator", "blocked");
    await expect(dropBadge(page)).toHaveText("Only images can be inserted here");
    await expect(dropBadge(page)).toHaveAttribute("data-action", "blocked");
    await page.screenshot({ path: `temp/verification/vis-dnd-4/notes-blocked-${theme}.png` });

    await page.keyboard.press("Escape");
    await expect(dropBadge(page)).toHaveCount(0);
    await expect(dropMarks(page)).toHaveCount(0);
    await fileDrag(zone, "dragover", files(1));
    await fileDrag(zone, "dragleave", files(1), { x: 1, y: 1 });
    await expect(dropMarks(page)).toHaveCount(0);
    await fileDrag(zone, "dragover", files(1));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(dropBadge(page)).toHaveCount(0);
  });
}

test("compact notes refresh captures and tag filtering", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`/tests/browser/notes/notes.html?theme=${theme}`);
      await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
      const tags = page.getByRole("group", { name: "Filter by tag", exact: true });
      await expect(tags).toBeVisible();
      await tags.getByRole("button", { name: "#ideas", exact: true }).click();
      await expect(tags.getByRole("button", { name: "#ideas", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
      await tags.getByRole("button", { name: "All tags", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/notes-refresh/${theme}-${width}-document.png`,
      });
      await page
        .locator(".note-preview-content")
        .filter({ hasText: "Write the launch summary here." })
        .click();
      await expect(page.locator(".note-active-block .cm-editor")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/notes-refresh/${theme}-${width}-editing.png`,
      });
      await page.getByRole("button", { name: "Read document", exact: true }).click();
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Tags", exact: true })).toBeVisible();
      await page.screenshot({ path: `temp/verification/notes-refresh/${theme}-${width}-tags.png` });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Choose project", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/notes-refresh/${theme}-${width}-projects.png`,
      });
      await page.keyboard.press("Escape");
      const split = page.getByRole("tab", { name: "Split", exact: true });
      if (await split.isVisible()) await split.click();
      else await page.getByRole("tab", { name: "Source", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/notes-refresh/${theme}-${width}-split.png`,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test("exposes all formatting commands directly without an overflow menu", async ({ page }) => {
  await page.goto("/tests/browser/notes/notes.html");
  const toolbar = page.getByRole("toolbar", { name: "Markdown formatting", exact: true });
  for (const mode of ["Document", "Source", "Split"]) {
    await page.setViewportSize({ width: 1560, height: 900 });
    await page.getByRole("tab", { name: mode, exact: true }).click();
    if (mode === "Document")
      await page.locator("[data-note-preview] .note-preview-content").first().click();
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      for (const label of [
        "Strikethrough",
        "Numbered list",
        "Quote",
        "Code block",
        "Table",
        "Divider",
      ]) {
        await expect(toolbar.getByRole("button", { name: label, exact: true })).toBeInViewport();
      }
      await expect(
        toolbar.getByRole("button", { name: "Markdown formatting", exact: true }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.screenshot({
          path: `temp/verification/2026-11-13-notes-toolbar/${mode}-${width}-${theme}.png`,
        });
      }
    }
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`note shared frames preserve split draft ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notes/notes.html?theme=${theme}&saveError`);
      const mode = width === 1280 ? "Split" : "Source";
      await page.getByRole("tab", { name: mode, exact: true }).click();
      const panes = page.locator(".note-editor-pane");
      await expect(panes).toHaveCount(width === 1280 ? 2 : 1);
      if (width === 1280) await expect(panes.nth(1)).toHaveCSS("border-inline-start-width", "1px");
      const editor = panes.first().locator(".cm-content");
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\nRetain note draft.");
      await expect(editor).toContainText("Retain note draft.");
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(retry).toHaveCSS("text-decoration-line", "underline");
      await retry.hover();
      await expect(retry).toHaveCSS("text-decoration-line", "none");
      await page.screenshot({
        path: `temp/verification/search-skills-notes/notes-${theme}-${width}.png`,
      });
      await retry.click();
      await expect(retry).toHaveCount(0);
      await page.getByRole("tab", { name: "Document", exact: true }).click();
      await page.getByRole("tab", { name: mode, exact: true }).click();
      await expect(editor).toContainText("Retain note draft.");
      await page.setViewportSize({ width: 600, height: 900 });
      await expect(page.locator(".note-mobile-navigation")).toBeVisible();
      await expect(page.locator(".note-mobile-navigation")).toHaveCSS(
        "border-block-end-width",
        "1px",
      );
    });
  }
for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`session notes caller states ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/notes/notes.html?panel&theme=${theme}`);
      const editor = page.getByRole("textbox", { name: "Note", exact: true });
      await expect(editor).toHaveValue(/Release checklist/);
      await page.getByRole("button", { name: "Switch note", exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Switch note", exact: true });
      await expect(picker).toBeVisible();
      await picker.getByRole("textbox", { name: "Search notes" }).fill("no such note");
      await expect(picker).toContainText("No matching notes");
      await page.screenshot({ path: info.outputPath(`notes-picker-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      await page.screenshot({ path: info.outputPath(`notes-panel-${theme}-${width}.png`) });
      await page.goto(`/tests/browser/notes/notes.html?panel&pendingNotes&theme=${theme}`);
      await expect(page.getByText("Loading notes…")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`notes-loading-${theme}-${width}.png`) });
      await page.goto(`/tests/browser/notes/notes.html?panel&failedNotes&theme=${theme}`);
      await expect(page.getByText(/Fixture notes unavailable/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`notes-error-${theme}-${width}.png`) });
    });
