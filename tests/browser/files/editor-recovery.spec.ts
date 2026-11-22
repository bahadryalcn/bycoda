import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { NativeEditorDraftRecord } from "../../../src/features/files/data/editorDraftPersistence";
import type { WorkspaceTab } from "../../../src/features/workspace/model/layout";

type State = {
  disk: string | null;
  writes: Array<{ path: string; content: string }>;
  puts: Array<{ documentId: string; revision: number; text: string }>;
  putRequests: Array<{ documentId: string; revision: number }>;
  reports: Array<{ documentId: string }>;
  source: NativeEditorDraftRecord;
  originalSource: NativeEditorDraftRecord;
  rows: NativeEditorDraftRecord[];
  tabs: WorkspaceTab[];
  dirty: string[];
  initialDocument: string;
  selectedTab: string;
  held: boolean;
};
type Controls = {
  snapshot(): State;
  advanceSource(): Promise<void>;
  releasePut(): void;
  setTheme(light: boolean): void;
};
function snapshot(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.snapshot(),
  );
}
// The fixture module installs its controls after top-level awaits; goto can resolve first.
const fixtureReady = (page: Page) => page.waitForFunction(() => "editorRecoveryFixture" in window);
const recoveredEditor = (page: Page) => page.locator('[data-workspace="recovered"] .cm-content');
const sourceRow = (page: Page) =>
  page
    .getByRole("region", { name: "File recovery copies", exact: true })
    .locator("li")
    .filter({ hasText: "Earlier desktop window" });
async function openCatalog(page: Page) {
  // The active file editor takes keyboard focus once its document loads. Let that
  // settle first (or the open error show) so the Enter below reaches the recovery
  // control, not the editor.
  const existing = page.locator('[data-workspace="existing"]');
  await expect(
    existing.locator(".cm-content").or(existing.getByRole("alert")).first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !document.querySelector('[data-workspace="existing"] .cm-editor') ||
          !!document.activeElement?.closest(".cm-editor"),
      ),
    )
    .toBe(true);
  const open = page.getByRole("button", { name: /^Recovered work(?: \(\d+\))?$/ });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Recovered work", exact: true })).toBeVisible();
  await expect(sourceRow(page)).toBeVisible();
}
async function openCopy(page: Page) {
  await sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }).click();
  await expect(recoveredEditor(page)).toContainText(
    /Recovered unsaved text|Updated source revision/,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function sourceUntouched(page: Page) {
  const state = await snapshot(page);
  expect(state.source).toEqual(state.originalSource);
  expect(
    state.rows.find(
      (row) =>
        row.metadata.ownerId === state.source.metadata.ownerId &&
        row.metadata.documentId === state.source.payload.documentId,
    ),
  ).toEqual(state.originalSource);
}

test("file-only recovery persists a separate permanent tab, preserves an existing dirty same-path editor and reports only an explicit save", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-recovery.html");
  const existing = page.locator('[data-workspace="existing"] .cm-content');
  await expect(existing).toContainText("Original disk text");
  await existing.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Existing unsaved view\n");
  await expect(existing).toContainText("Existing unsaved view");
  await openCatalog(page);
  await expect(page.getByRole("region", { name: "File drafts", exact: true })).toBeVisible();
  await openCopy(page);
  const state = await snapshot(page);
  expect(state.tabs).toHaveLength(2);
  const recovered = state.tabs[1].editorPanes[0].files[0];
  expect(recovered.id).not.toBe(state.initialDocument);
  expect(recovered.preview).not.toBe(true);
  expect(recovered.recoveredEditorDraft).toMatchObject({
    documentId: recovered.id,
    path: recovered.path,
  });
  expect(JSON.stringify(state.tabs)).not.toContain("Recovered unsaved text");
  expect(JSON.stringify(state.tabs)).not.toContain("Original disk text");
  expect(state.dirty).toContain(state.initialDocument);
  expect(state.dirty).toContain(recovered.id);
  expect(state.writes).toHaveLength(0);
  await expect(page.locator('[data-workspace="recovered"] footer [role="status"]')).toContainText(
    "Unsaved changes",
  );
  await page.getByRole("button", { name: "Existing document", exact: true }).click();
  await expect(existing).toBeVisible();
  await expect(existing).toContainText("Existing unsaved view");
  await expect(existing).not.toContainText("Recovered unsaved text");
  await page.getByRole("button", { name: "Recovered copy", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).writes.length).toBe(1);
  await expect.poll(async () => (await snapshot(page)).reports.length).toBe(1);
  expect((await snapshot(page)).disk).toBe("Recovered unsaved text\r\nİstanbul 漢🦀\r\n");
  expect((await snapshot(page)).reports[0].documentId).toBe(recovered.id);
  await expect(page.locator('[data-workspace="recovered"] footer [role="status"]')).toHaveText(
    "Saved",
  );
  await sourceUntouched(page);
});

test("recovered text stays dirty for a full enabled-autosave window until explicit save", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-recovery.html?autosave");
  await openCatalog(page);
  await openCopy(page);
  await expect(page.locator('[data-workspace="recovered"] footer [role="status"]')).toContainText(
    "Unsaved changes",
  );
  // This observes the real 1000ms editor autosave window; it is not an IPC SLO.
  await page.waitForTimeout(1100);
  expect((await snapshot(page)).writes).toHaveLength(0);
  expect((await snapshot(page)).reports).toHaveLength(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).writes.length).toBe(1);
  await sourceUntouched(page);
});

for (const disk of ["missing", "changed"]) {
  test(`a ${disk} disk remains an explicit overwrite decision and never becomes false clean`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/files/editor-recovery.html?disk=${disk}`);
    await openCatalog(page);
    await openCopy(page);
    await expect(
      page.getByRole("button", { name: "Overwrite disk version", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-workspace="recovered"] footer [role="status"]')).toContainText(
      "Unsaved changes",
    );
    expect((await snapshot(page)).writes).toHaveLength(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[data-workspace="recovered"]')).toContainText(
      "The file changed on disk. Reload or overwrite before saving.",
    );
    expect((await snapshot(page)).writes).toHaveLength(0);
    await page.getByRole("button", { name: "Overwrite disk version", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).writes.length).toBe(1);
    await expect.poll(async () => (await snapshot(page)).reports.length).toBe(1);
    expect((await snapshot(page)).disk).toBe("Recovered unsaved text\r\nİstanbul 漢🦀\r\n");
    await sourceUntouched(page);
  });
}

test("changed source metadata produces a retained error, refresh and an exact new-source retry", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-recovery.html");
  await openCatalog(page);
  await page.evaluate(() =>
    (
      window as unknown as { editorRecoveryFixture: Controls }
    ).editorRecoveryFixture.advanceSource(),
  );
  await sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }).click();
  await expect(sourceRow(page).getByRole("alert")).toContainText("refresh if the source changed");
  expect((await snapshot(page)).tabs).toHaveLength(1);
  expect((await snapshot(page)).puts).toHaveLength(0);
  await page.getByRole("button", { name: "Refresh copies", exact: true }).click();
  await expect(
    sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }),
  ).toBeVisible();
  await openCopy(page);
  await expect(recoveredEditor(page)).toContainText("Updated source revision");
  const state = await snapshot(page);
  expect(state.source.payload.revision).toBe(4);
  expect(state.writes).toHaveLength(0);
  expect(
    state.rows.filter((row) => row.metadata.ownerId === state.source.metadata.ownerId),
  ).toEqual([state.source]);
});

test("a lost committed target ACK retries the same prepared ID without another put or filesystem write", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-recovery.html?lost-ack");
  await openCatalog(page);
  await sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }).click();
  await expect(sourceRow(page).getByRole("alert")).toBeVisible();
  const accepted = await snapshot(page);
  expect(accepted.puts).toHaveLength(1);
  expect(accepted.tabs).toHaveLength(1);
  const targetId = accepted.puts[0].documentId;
  await sourceRow(page).getByRole("button", { name: "Retry opening copy", exact: true }).click();
  await expect(recoveredEditor(page)).toContainText("Recovered unsaved text");
  const state = await snapshot(page);
  expect(state.tabs[1].editorPanes[0].files[0].id).toBe(targetId);
  expect(state.putRequests.filter((request) => request.documentId === targetId)).toHaveLength(1);
  expect(state.writes).toHaveLength(0);
  await sourceUntouched(page);
});

test("pending Native copy keeps the real recovery dialog open through Escape and Close", async ({
  page,
}) => {
  await page.goto("/tests/browser/files/editor-recovery.html?hold-target");
  await openCatalog(page);
  await sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).held).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Recovered work", exact: true })).toBeVisible();
  // Close is disabled while the copy is pending; a forced click must not dismiss the dialog.
  const close = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeDisabled();
  await close.click({ force: true });
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await snapshot(page)).writes).toHaveLength(0);
  await page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.releasePut(),
  );
  await expect(recoveredEditor(page)).toContainText("Recovered unsaved text");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sourceUntouched(page);
});

for (const width of [1280, 800]) {
  for (const light of [false, true]) {
    test(`recovery catalog, source error and opened copy ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/files/editor-recovery.html${light ? "?light" : ""}`);
      await openCatalog(page);
      await page.screenshot({
        path: info.outputPath(`recovery-list-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await page.evaluate(() =>
        (
          window as unknown as { editorRecoveryFixture: Controls }
        ).editorRecoveryFixture.advanceSource(),
      );
      await sourceRow(page)
        .getByRole("button", { name: "Open copy in new tab", exact: true })
        .click();
      await expect(sourceRow(page).getByRole("alert")).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`recovery-error-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Refresh copies", exact: true }).click();
      await expect(
        sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }),
      ).toBeVisible();
      await openCopy(page);
      await expect(recoveredEditor(page)).toContainText("Updated source revision");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`recovery-opened-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      expect((await snapshot(page)).writes).toHaveLength(0);
    });
  }
}
