import { expect, test, type Page } from "@playwright/test";
import type { NativeEditorDraftRecord } from "../../src/features/files/data/editorDraftPersistence";
import type { WorkspaceTab } from "../../src/features/workspace/model/layout";

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
  legacyReport: { held: boolean; contentAvailable: false; reportVersion: number };
  legacyCalls: string[];
  hostCalls: { command: string; args: Record<string, any> }[];
  hostReport: { retention: string; qualified: false };
  hostContext: Record<string, unknown>;
  hostCursor: Record<string, unknown>;
};
type Controls = {
  snapshot(): State;
  advanceSource(): Promise<void>;
  releasePut(): void;
  setTheme(light: boolean): void;
  setPrivacy(allowed: boolean): void;
  releaseLegacyRead(): void;
  releaseHostRead(): void;
};
function snapshot(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.snapshot(),
  );
}
// The fixture module installs its controls after top-level awaits; goto can resolve first.
const fixtureReady = (page: Page) => page.waitForFunction(() => "editorRecoveryFixture" in window);
const recoveredEditor = (page: Page) => page.locator('[data-workspace="recovered"] .cm-content');
async function openHostReports(page: Page) {
  await page.getByRole("button", { name: /^Recovered work(?: \(\d+\))?$/ }).click();
  await page.getByRole("tab", { name: /^Earlier file reports/ }).click();
  await page.getByRole("radio", { name: "Host reports", exact: true }).click();
  expect((await snapshot(page)).hostCalls).toEqual([]);
  await page.getByRole("button", { name: "Check reports", exact: true }).click();
}
for (const light of [true, false]) {
  for (const width of [1280, 800]) {
    test(`Host-held reports empty continuation, retry and copies ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/editor-recovery.html?host-empty&host-error");
      await fixtureReady(page);
      await page.evaluate(
        (value) =>
          (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setTheme(
            value,
          ),
        light,
      );
      await openHostReports(page);
      await expect(
        page.getByText("No reports needing recovery on this page.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
      await page.screenshot({
        path: info.outputPath(`host-empty-${width}-${light}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(
        page.getByRole("list", { name: "Earlier file reports", exact: true }),
      ).toContainText("Report 3");
      await expect(
        page.getByText(
          "Some Host reports are unavailable. You can inspect the available reports or refresh to retry.",
          { exact: true },
        ),
      ).toBeVisible();
      const listed = await snapshot(page);
      expect(listed.hostCalls[1]?.args).toEqual({
        request: { after: listed.hostCursor, limit: 25 },
        expectedContext: listed.hostContext,
      });
      await page.screenshot({
        path: info.outputPath(`host-list-${width}-${light}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Inspect report", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(
        page.getByText("Fixture private diagnostic must not reach the UI", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`host-error-${width}-${light}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Retry inspection", exact: true }).click();
      await expect(page.getByRole("list", { name: "Reported files", exact: true })).toContainText(
        "C:\\fixture\\notes.txt",
      );
      await expect(
        page.getByText(
          "This report contains file names and edit status, not the edited text. Its protection has not been removed.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`host-details-${width}-${light}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Find file recovery copies", exact: true }).click();
      await expect(sourceRow(page)).toBeVisible();
      const state = await snapshot(page);
      expect(state.hostCalls.map((call) => call.command)).toEqual([
        "managed_workspace_host_buffer_recovery_list",
        "managed_workspace_host_buffer_recovery_list",
        "managed_workspace_host_buffer_recovery_read",
        "managed_workspace_host_buffer_recovery_read",
      ]);
      expect(state.hostReport).toMatchObject({ retention: "held", qualified: false });
      expect(state.legacyCalls).toEqual([]);
      expect(state.writes).toEqual([]);
      expect(state.putRequests).toEqual([]);
      await sourceUntouched(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
for (const light of [true, false]) {
  for (const width of [1280, 800]) {
    test(`Host report list and long paths stay bounded ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/editor-recovery.html?host-scale");
      await fixtureReady(page);
      await page.evaluate(
        (value) =>
          (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setTheme(
            value,
          ),
        light,
      );
      await openHostReports(page);
      const reports = page.getByRole("list", { name: "Earlier file reports", exact: true });
      await expect(reports.locator("li")).toHaveCount(25);
      // The pane keeps toolbar, counts and footer in place; the list's own scroller is `.recovery-body`.
      expect(
        await reports.evaluate((element) => {
          const scroller = element.closest(".recovery-body") ?? element;
          return scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight;
        }),
      ).toBe(true);
      await reports
        .getByRole("button", { name: "Inspect report", exact: true })
        .last()
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`host-scaled-list-${width}-${light}.png`),
        animations: "disabled",
      });
      await reports.getByRole("button", { name: "Inspect report", exact: true }).last().click();
      await expect(page.getByRole("list", { name: "Reported files", exact: true })).toContainText(
        "long-reported-file-",
      );
      await page.screenshot({
        path: info.outputPath(`host-long-path-${width}-${light}.png`),
        animations: "disabled",
      });
      const bounds = await page
        .getByRole("dialog", { name: "Recovered work", exact: true })
        .boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await snapshot(page)).writes).toEqual([]);
    });
  }
}
test("Host-held read cannot disclose after privacy changes away and back", async ({ page }) => {
  await page.goto("/tests/browser/editor-recovery.html?hold-host");
  await openHostReports(page);
  await page.getByRole("button", { name: "Inspect report", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).hostCalls.filter((call) => call.command.endsWith("_read")).length,
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setPrivacy(
      false,
    ),
  );
  await expect(
    page.getByText("Unlock project groups to inspect earlier file reports.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setPrivacy(
      true,
    ),
  );
  await page.evaluate(() =>
    (
      window as unknown as { editorRecoveryFixture: Controls }
    ).editorRecoveryFixture.releaseHostRead(),
  );
  await expect(page.getByRole("button", { name: "Check reports", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Reported files", exact: true })).toHaveCount(0);
  expect((await snapshot(page)).writes).toEqual([]);
});
const sourceRow = (page: Page) =>
  page
    .getByRole("list", { name: "File recovery copies", exact: true })
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
async function openEarlierReports(page: Page) {
  await page.getByRole("button", { name: /^Recovered work(?: \(\d+\))?$/ }).click();
  await expect(page.getByRole("dialog", { name: "Recovered work", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Earlier file reports/ }).click();
  expect((await snapshot(page)).legacyCalls).toEqual([]);
  await page.getByRole("button", { name: "Check reports", exact: true }).click();
  await expect(page.getByRole("list", { name: "Earlier file reports", exact: true })).toContainText(
    "Earlier desktop report",
  );
}
const legacyRow = (page: Page) =>
  page
    .getByRole("list", { name: "Earlier file reports", exact: true })
    .locator("li")
    .filter({ hasText: "Earlier desktop report" });
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
  await page.goto("/tests/browser/editor-recovery.html");
  const existing = page.locator('[data-workspace="existing"] .cm-content');
  await expect(existing).toContainText("Original disk text");
  await existing.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Existing unsaved view\n");
  await expect(existing).toContainText("Existing unsaved view");
  await openCatalog(page);
  await expect(page.getByRole("tab", { name: /File drafts/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
  await page.goto("/tests/browser/editor-recovery.html?autosave");
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
    await page.goto(`/tests/browser/editor-recovery.html?disk=${disk}`);
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
      "Choose reload or overwrite",
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
  await page.goto("/tests/browser/editor-recovery.html");
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
  await page.goto("/tests/browser/editor-recovery.html?lost-ack");
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
  await page.goto("/tests/browser/editor-recovery.html?hold-target");
  await openCatalog(page);
  await sourceRow(page).getByRole("button", { name: "Open copy in new tab", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).held).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Recovered work", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
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
      await page.goto(`/tests/browser/editor-recovery.html${light ? "?light" : ""}`);
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

test("a late report inspection stays concealed after lock and unlock until another explicit inspection", async ({
  page,
}) => {
  await page.goto("/tests/browser/editor-recovery.html?hold-legacy");
  await openEarlierReports(page);
  await legacyRow(page).getByRole("button", { name: "Inspect report", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).legacyCalls.length).toBe(2);
  await page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setPrivacy(
      false,
    ),
  );
  await expect(
    page.getByText("Unlock project groups to inspect earlier file reports.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Earlier desktop report", { exact: false })).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { editorRecoveryFixture: Controls }).editorRecoveryFixture.setPrivacy(
      true,
    ),
  );
  await page.evaluate(() =>
    (
      window as unknown as { editorRecoveryFixture: Controls }
    ).editorRecoveryFixture.releaseLegacyRead(),
  );
  await page.getByRole("button", { name: "Check reports", exact: true }).click();
  await expect(
    legacyRow(page).getByRole("button", { name: "Inspect report", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("list", { name: "Reported files", exact: true })).toHaveCount(0);
  await legacyRow(page).getByRole("button", { name: "Inspect report", exact: true }).click();
  await expect(page.getByRole("list", { name: "Reported files", exact: true })).toContainText(
    "C:\\fixture\\notes.txt",
  );
  expect((await snapshot(page)).legacyCalls).toEqual([
    "managed_workspace_buffer_recovery_list",
    "managed_workspace_buffer_recovery_read",
    "managed_workspace_buffer_recovery_list",
    "managed_workspace_buffer_recovery_read",
  ]);
  expect((await snapshot(page)).writes).toEqual([]);
  expect((await snapshot(page)).legacyReport.held).toBe(true);
});

test("the desktop recovery entry reaches retained reports with no conversations or new-format copies", async ({
  page,
}) => {
  await page.goto("/tests/browser/editor-recovery.html?legacy-only");
  await openEarlierReports(page);
  await legacyRow(page).getByRole("button", { name: "Inspect report", exact: true }).click();
  await page.getByRole("button", { name: "Find file recovery copies", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "File recovery copies", exact: true }).locator("li"),
  ).toHaveCount(0);
  expect((await snapshot(page)).legacyReport.held).toBe(true);
  expect((await snapshot(page)).writes).toEqual([]);
});

for (const width of [1280, 800]) {
  for (const light of [false, true]) {
    test(`earlier report list, inspection retry and matching copies ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/editor-recovery.html?legacy-error${light ? "&light" : ""}`);
      await openEarlierReports(page);
      const blocked = page
        .getByRole("list", { name: "Earlier file reports", exact: true })
        .locator("li")
        .filter({ hasText: "Uninspectable retained report" });
      await expect(
        blocked.getByRole("button", { name: "Inspect report", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: info.outputPath(`legacy-list-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await legacyRow(page).getByRole("button", { name: "Inspect report", exact: true }).click();
      await expect(legacyRow(page).getByRole("alert")).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`legacy-error-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await legacyRow(page).getByRole("button", { name: "Retry inspection", exact: true }).click();
      await expect(page.getByRole("list", { name: "Reported files", exact: true })).toContainText(
        "C:\\fixture\\notes.txt",
      );
      await expect(page.getByText("Unsaved changes reported", { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          "This report contains file names and edit status, not the edited text. Its protection has not been removed.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`legacy-details-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Find file recovery copies", exact: true }).click();
      await expect(sourceRow(page)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Show all file copies", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`legacy-copies-${width}-${light ? "light" : "dark"}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Show all file copies", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Show all file copies", exact: true }),
      ).toHaveCount(0);
      const state = await snapshot(page);
      expect(state.legacyReport).toMatchObject({
        held: true,
        contentAvailable: false,
        reportVersion: 1,
      });
      expect(state.legacyCalls).toEqual([
        "managed_workspace_buffer_recovery_list",
        "managed_workspace_buffer_recovery_read",
        "managed_workspace_buffer_recovery_read",
      ]);
      expect(state.writes).toEqual([]);
      expect(state.putRequests).toEqual([]);
      expect(state.tabs).toHaveLength(1);
      await sourceUntouched(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
