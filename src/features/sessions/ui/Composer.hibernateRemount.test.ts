// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerAttachments,
  setComposerDraft,
} from "../model/draftCache";
import type { Attachment } from "../model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));

let container: HTMLDivElement;
let root: Root;
const id = "composer-hibernate-remount";
const file: Attachment = {
  id: "kept",
  name: "selected.txt",
  kind: "file",
  mimeType: "text/plain",
  size: 4,
  path: "/fake/selected.txt",
};

/** Mirrors SessionPane: the draft seed is read from the cache at mount time. */
async function mountPane(target: Root) {
  await act(async () =>
    target.render(
      createElement(Composer, {
        sessionId: id,
        focused: false,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        initialDraft: getComposerDraft(id),
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit: vi.fn(),
        onSaveDraft: vi.fn(),
        canSaveDraft: true,
        onDraftChange: (text: string) => setComposerDraft(id, text),
      }),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearComposerDraft(id);
  vi.unstubAllGlobals();
});

it("keeps unsent text and attachments when a hibernated pane mounts again", async () => {
  setComposerDraft(id, "Half-written thought");
  setComposerAttachments(id, [file]);
  await mountPane(root);
  expect(container.querySelector("textarea")!.value).toBe("Half-written thought");

  // Hibernation unmounts the pane tree; the draft must live outside it.
  act(() => root.unmount());
  container.replaceChildren();
  expect(getComposerDraft(id)).toBe("Half-written thought");

  root = createRoot(container);
  await mountPane(root);
  expect(container.querySelector("textarea")!.value).toBe("Half-written thought");
  expect(container.querySelector('[aria-label="Remove selected.txt"]')).not.toBeNull();
});
