// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorConflictBar } from "./EditorConflictBar";

const language = vi.hoisted(() => ({ load: vi.fn() }));
const counts = vi.hoisted(() => ({ enabled: false }));
vi.mock("../editor/editorGit", async (original) => {
  const actual = await original<typeof import("../editor/editorGit")>();
  return {
    ...actual,
    diffLineStatsForView: (view: Parameters<typeof actual.diffLineStatsForView>[0]) =>
      counts.enabled ? { additions: 1234, deletions: 4321 } : actual.diffLineStatsForView(view),
  };
});
vi.mock("../editor/editorChrome", async (original) => ({
  ...(await original<typeof import("../editor/editorChrome")>()),
  languageForPath: language.load,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Storage();
  storage.setItem("bycoda.autosave", "0");
  vi.stubGlobal("localStorage", storage);
  language.load.mockReset().mockResolvedValue(null);
  counts.enabled = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps long staging failures and next-file notes in wrapped visible status text", async () => {
  const error = `Staging failed: C:/work/${"account-and-project-".repeat(30)}retry-required`;
  const note = "Sonraki dosya kullanılamıyor مرحبا 📄";
  await act(async () =>
    root.render(
      createElement(EditorConflictBar, {
        count: 0,
        canMarkResolved: true,
        marking: false,
        error,
        fileNote: note,
        onPrev: vi.fn(),
        onNext: vi.fn(),
        onMarkResolved: vi.fn(),
      }),
    ),
  );
  const statuses = [...host.querySelectorAll('[role="status"]')];
  for (const value of [error, note]) {
    const status = statuses.find((element) => element.textContent === value)!;
    expect(status).toBeDefined();
    expect(status.getAttribute("data-wrap")).toBe("anywhere");
    expect(status.hasAttribute("data-truncate")).toBe(false);
  }
});

it("reports a rejected language chunk without losing edits or save behavior", async () => {
  language.load.mockRejectedValueOnce(new Error("Syntax chunk unavailable"));
  const onSave = vi.fn(async () => {});
  const saveRequestRef = { current: null as (() => Promise<boolean>) | null };
  await act(async () =>
    root.render(
      createElement(CodeMirrorEditor, {
        path: "/repo/draft.ts",
        cwd: "/repo",
        commentPath: "draft.ts",
        value: "const draft = 1;",
        showDiff: false,
        gitOriginal: null,
        active: false,
        formatOnSave: false,
        onSave,
        onDirtyChange: vi.fn(),
        onErrorCountChange: vi.fn(),
        canAutosave: () => false,
        saveRequestRef,
      }),
    ),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Syntax chunk unavailable");
  const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
  await act(async () =>
    view.dispatch({ changes: { from: view.state.doc.length, insert: " // retained" } }),
  );
  await act(async () => expect(await saveRequestRef.current!()).toBe(true));
  expect(onSave).toHaveBeenCalledWith("const draft = 1; // retained");
  expect(EditorView.findFromDOM(host.querySelector(".cm-editor")!)).toBe(view);
});

it("updates diff numerals after a locale change without changing the editable document", async () => {
  counts.enabled = true;
  localStorage.setItem("bycoda.diffLayout", "unified");
  try {
    await act(async () =>
      root.render(
        createElement(CodeMirrorEditor, {
          path: "/repo/counts.txt",
          cwd: "/repo",
          commentPath: "counts.txt",
          value: "new text",
          showDiff: true,
          gitOriginal: "old text",
          active: false,
          formatOnSave: false,
          onSave: vi.fn(async () => {}),
          onDirtyChange: vi.fn(),
          onErrorCountChange: vi.fn(),
          canAutosave: () => false,
        }),
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    expect(host.textContent).toContain("+1,234");
    expect(host.textContent).toContain("-4,321");
    await act(async () => {
      await setLanguagePreference("tr");
    });
    expect(host.textContent).toContain("+1.234");
    expect(host.textContent).toContain("-4.321");
    expect(view.state.doc.toString()).toBe("new text");
  } finally {
    await act(async () => {
      await setLanguagePreference("en");
    });
  }
});
