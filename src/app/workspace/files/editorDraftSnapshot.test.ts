// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  newEditorWorkspaceTab,
  newFileTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "../../../features/workspace/model/workspaceSnapshot";
import { useEditorFileEvents } from "./useEditorFileEvents";

vi.mock("../../../features/files/model/fileIndex", () => ({ invalidateProjectFiles: vi.fn() }));
const locator = {
  version: 1 as const,
  ownerEpoch: "a".repeat(64),
  documentId: "11111111-1111-4111-8111-111111111111",
  path: "/repo/old.txt",
  revision: 1,
  payloadDigest: "b".repeat(64),
};
function tab() {
  return newEditorWorkspaceTab({
    ...newFileTab(locator.path, "/repo"),
    id: locator.documentId,
    recoveredEditorDraft: locator,
  });
}
function snapshot(tabs: WorkspaceTab[]) {
  return collectWorkspaceSnapshot(tabs, [], tabs[0].id, "/repo", new Map());
}
it("persists only exact locators, excluding any recovery plaintext from workspace JSON", () => {
  const original = tab();
  const file = original.editorPanes[0].files[0] as unknown as Record<string, unknown>;
  file.text = "private recovered body";
  file.diskBaseline = "private baseline";
  const encoded = JSON.stringify(snapshot([original]));
  expect(encoded).not.toContain("private");
  const restored = hydrateWorkspaceSnapshot(JSON.parse(encoded), new Map());
  expect(restored?.tabs[0].editorPanes[0].files[0].recoveredEditorDraft).toEqual(locator);
});
it("preserves a historical locator through the actual file-move producer and workspace roundtrip", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const tabs = { current: [tab()] };
  let move!: (from: string, to: string) => void;
  function Harness() {
    move = useEditorFileEvents({
      tabsRef: tabs,
      setTabs: (update) => {
        tabs.current = typeof update === "function" ? update(tabs.current) : update;
      },
      setDirtyFiles: vi.fn(),
      setComposerFocused: vi.fn(),
    }).onFileMoved;
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    act(() => move("/repo/old.txt", "/repo/new.txt"));
    const parsed = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot(tabs.current))));
    const file = parsed?.tabs[0].editorPanes[0].files[0];
    expect(file?.path).toBe("/repo/new.txt");
    expect(file?.recoveredEditorDraft).toEqual(locator);
    expect(file?.recoveredEditorDraft?.path).toBe("/repo/old.txt");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it.each(["terminal", "plan", "remoteFile"])(
  "rejects a recovery locator mixed with unrelated %s surface",
  (kind) => {
    const original = tab();
    const file = original.editorPanes[0].files[0] as unknown as Record<string, unknown>;
    file[kind] = kind === "terminal" ? true : {};
    expect(snapshot([original]).tabs).toHaveLength(0);
  },
);
