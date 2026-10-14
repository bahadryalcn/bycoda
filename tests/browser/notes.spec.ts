import { expect, test } from "@playwright/test";

test("quotes selected note text from preview and source through the contextual menu", async ({ page }) => {
  await page.goto("/tests/browser/notes.html");
  await page.evaluate(() => {
    (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes = [];
    window.addEventListener("bycoda:add-to-chat", (event) => {
      (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes.push((event as CustomEvent).detail);
    });
  });
  const paragraph = page.locator('[data-note-preview] p').filter({ hasText: "Write the launch summary here." }).first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const menu = page.getByRole("toolbar", { name: "Selected text actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Add to notes", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { selectedQuotes: unknown[] }).selectedQuotes)).toEqual([
    { text: "Write the launch summary here.", mode: "quote" },
  ]);
  const source = page.locator(".note-split > div:first-child .cm-content");
  await source.click(); await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { selectedQuotes: { text: string }[] }).selectedQuotes[1]?.text)).toBe("# Release checklist");
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
  await page.getByLabel("Filter by tag", { exact: true }).selectOption("ideas");
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
  const confirmation = page.getByRole("dialog", { name: "Confirm note deletion" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Release planning");
  await expect(confirmation).toHaveAttribute("aria-modal", "true");
  expect(await confirmation.evaluate((element) => element.contains(document.activeElement))).toBe(
    true,
  );
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
  await page.getByLabel("Filter by project", { exact: true }).selectOption("g:/projects/mobile");
  await expect(page.locator("[data-note-library] li")).toHaveCount(14);
  await page.getByLabel("Filter by tag", { exact: true }).selectOption("ideas");
  await expect(page.locator("[data-note-library] li")).toHaveCount(7);
  await page.getByLabel("Group notes by", { exact: true }).selectOption("tag");
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
  await page.getByLabel("Group notes by", { exact: true }).selectOption("none");
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
