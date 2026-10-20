// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useEditorFileClose,
  type EditorFileClose,
  type EditorFileCloseDeps,
} from "./useEditorFileClose";
import { newEditorWorkspaceTab, newFileTab, newTerminalFile } from "../../../features/workspace/model/layout";
const confirms = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("../../model/closeConfirmation", () => ({ confirmWorkspaceClose: confirms.run }));
vi.mock("../../../platform/tauri/fs", () => ({ basename: (path: string) => path }));
vi.mock("../helpers/appHelpers", () => ({ confirmDiscardUnsaved: vi.fn() }));
vi.mock("../../../features/terminal/model/terminalClose", () => ({
  confirmCloseTerminal: vi.fn(),
  confirmCloseTerminals: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(["left", "right", undefined] as const)(
  "preserves the selected tab and opposite side with close direction %s, and honors cancellation",
  async (direction) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const left = newFileTab("/left", "/repo");
    const selected = newFileTab("/selected", "/repo");
    const right = newFileTab("/right", "/repo");
    const terminal = newTerminalFile("/repo");
    const tab = newEditorWorkspaceTab(selected);
    const pane = tab.editorPanes[0];
    pane.files = [left, selected, right, terminal];
    const otherTab = newEditorWorkspaceTab(newFileTab("/other", "/repo"));
    const tabsRef = { current: [tab, otherTab] };
    const dirtyFilesRef = { current: new Set([left.id, selected.id, right.id]) };
    const deps: EditorFileCloseDeps = {
      activeTabId: tab.id,
      projectCwd: "/repo",
      tabCloseScope: "project",
      tabWorktreeOf: () => null,
      tabsRef,
      sessionsRef: { current: [] },
      dirtyFilesRef,
      isMovingPane: () => false,
      onCloseTab: vi.fn(),
      setDirtyFiles: (update) => {
        dirtyFilesRef.current = typeof update === "function" ? update(dirtyFilesRef.current) : update;
      },
      setSessions: vi.fn(),
      setTabs: (update) => {
        tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
      },
      setComposerFocused: vi.fn(),
    };
    let actions!: EditorFileClose;
    function Harness() {
      actions = useEditorFileClose(deps);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Harness)));
      confirms.run.mockResolvedValue(false);
      await act(async () => actions.onCloseOtherFiles(pane.id, selected.id, direction));
      expect(tabsRef.current[0].editorPanes[0].files).toEqual([left, selected, right, terminal]);
      expect(dirtyFilesRef.current.size).toBe(3);
      expect(confirms.run).toHaveBeenLastCalledWith(expect.any(Function), direction === "left" ? undefined : expect.any(Function));
      confirms.run.mockResolvedValue(true);
      await act(async () => actions.onCloseOtherFiles(pane.id, selected.id, direction));
      const remaining = direction === "left" ? [selected, right, terminal] : direction === "right" ? [left, selected] : [selected];
      expect(tabsRef.current[0].editorPanes[0].files).toEqual(remaining);
      expect(tabsRef.current[0].editorPanes[0].activeFileId).toBe(selected.id);
      expect(tabsRef.current[1]).toBe(otherTab);
      expect(dirtyFilesRef.current).toEqual(new Set(remaining.filter((file) => !file.terminal).map((file) => file.id)));
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it("reads queued state before replacing the last editor pane", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const a = newFileTab("/a", "/repo");
  const c = newFileTab("/new", "/repo");
  const tab = newEditorWorkspaceTab(a);
  const paneId = tab.editorPanes[0].id;
  const tabsRef = { current: [tab] };
  // A queued update is ahead of the render mirror used to start this close.
  let queued = [
    { ...tab, editorPanes: [{ ...tab.editorPanes[0], files: [a, c], activeFileId: c.id }] },
  ];
  confirms.run.mockResolvedValue(true);
  const deps: EditorFileCloseDeps = {
    activeTabId: tab.id,
    projectCwd: "/repo",
    tabCloseScope: "project",
    tabWorktreeOf: () => null,
    tabsRef,
    sessionsRef: { current: [] },
    dirtyFilesRef: { current: new Set() },
    isMovingPane: () => false,
    onCloseTab: vi.fn(),
    setDirtyFiles: vi.fn(),
    setSessions: vi.fn(),
    setTabs: (update) => {
      queued = typeof update === "function" ? update(queued) : update;
    },
    setComposerFocused: vi.fn(),
  };
  let actions!: EditorFileClose;
  function Harness() {
    actions = useEditorFileClose(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => actions.onCloseFile(paneId, a.id));
    expect(queued[0].editorPanes[0].files).toEqual([c]);
    expect(queued[0].editorPanes[0].activeFileId).toBe(c.id);
    expect(deps.setSessions).not.toHaveBeenCalled();
    expect(deps.onCloseTab).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
it.each([false, true])(
  "closes against current files without reviving a removed tab (removed=%s)",
  async (removed) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const a = newFileTab("/a", "/repo");
    const b = newFileTab("/b", "/repo");
    const c = newFileTab("/c", "/repo");
    const tab = newEditorWorkspaceTab(a);
    tab.editorPanes[0].files.push(b);
    const paneId = tab.editorPanes[0].id;
    const tabs = { current: [tab] };
    const approvals: Array<() => void> = [];
    confirms.run.mockImplementation(
      () => new Promise<boolean>((resolve) => approvals.push(() => resolve(true))),
    );
    const deps: EditorFileCloseDeps = {
      activeTabId: tab.id,
      projectCwd: "/repo",
      tabCloseScope: "project",
      tabWorktreeOf: () => null,
      tabsRef: tabs,
      sessionsRef: { current: [] },
      dirtyFilesRef: { current: new Set() },
      isMovingPane: () => false,
      onCloseTab: vi.fn(),
      setDirtyFiles: vi.fn(),
      setSessions: vi.fn(),
      setTabs: (update) => {
        tabs.current = typeof update === "function" ? update(tabs.current) : update;
      },
      setComposerFocused: vi.fn(),
    };
    let actions!: EditorFileClose;
    function Harness() {
      actions = useEditorFileClose(deps);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Harness)));
      actions.onCloseFile(paneId, a.id);
      actions.onCloseFile(paneId, b.id);
      tabs.current = removed
        ? []
        : [
            {
              ...tab,
              editorPanes: [{ ...tab.editorPanes[0], files: [a, b, c], activeFileId: c.id }],
            },
          ];
      await act(async () => {
        approvals[0]();
        approvals[1]();
      });
      expect(tabs.current).toHaveLength(removed ? 0 : 1);
      if (!removed) expect(tabs.current[0].editorPanes[0].files).toEqual([c]);
      expect(deps.onCloseTab).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  },
);
