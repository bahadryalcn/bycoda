// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newEditorWorkspaceTab,
  newFileTab,
  newTerminalFile,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { useEditorFileClose, type EditorFileCloseDeps } from "./useEditorFileClose";

const native = vi.hoisted(() => ({ status: vi.fn(), discard: vi.fn(), ask: vi.fn() }));
vi.mock("../../../platform/tauri/pty", () => ({ getPtyStatus: native.status }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));
vi.mock("../helpers/appHelpers", () => ({ confirmDiscardUnsaved: native.discard }));
vi.mock("../../../platform/tauri/fs", () => ({ basename: (path: string) => path }));

let root: Root;
let deps: EditorFileCloseDeps;
let actions: ReturnType<typeof useEditorFileClose>;
let resolveStatus: (value: { foreground: null; supported: true }) => void;
const selected = newFileTab("/selected", "/repo");
const target = newFileTab("/target", "/repo");
const terminal = newTerminalFile("/repo");
let tab: WorkspaceTab;
let paneId: string;
let queuedTabs: WorkspaceTab[] | undefined;
let moving: boolean;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.status.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  native.discard.mockReset().mockResolvedValue(false);
  native.ask.mockReset().mockResolvedValue(true);
  queuedTabs = undefined;
  moving = false;
  tab = newEditorWorkspaceTab(selected);
  paneId = tab.editorPanes[0].id;
  tab.editorPanes[0].files = [selected, target, terminal];
  deps = {
    activeTabId: tab.id,
    projectCwd: "/repo",
    tabCloseScope: "project",
    tabWorktreeOf: () => null,
    tabsRef: { current: [tab] },
    sessionsRef: { current: [] },
    dirtyFilesRef: { current: new Set() },
    isMovingPane: () => moving,
    onCloseTab: vi.fn(),
    setDirtyFiles: (update) => {
      deps.dirtyFilesRef.current =
        typeof update === "function" ? update(deps.dirtyFilesRef.current) : update;
    },
    setSessions: vi.fn(),
    setTabs: (update) => {
      const previous = queuedTabs ?? deps.tabsRef.current;
      const next = typeof update === "function" ? update(previous) : update;
      if (queuedTabs) queuedTabs = next;
      else deps.tabsRef.current = next;
    },
    setComposerFocused: vi.fn(),
  };
  function Harness() {
    actions = useEditorFileClose(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([undefined, "left", "right"] as const)(
  "rechecks edits during PTY lookup for close %s",
  async (direction) => {
    if (direction === "left") tab.editorPanes[0].files = [terminal, target, selected];
    actions.onCloseOtherFiles(paneId, selected.id, direction);
    expect(native.status).toHaveBeenCalledExactlyOnceWith(terminal.id);
    deps.dirtyFilesRef.current.add(target.id);
    await act(async () => {
      resolveStatus({ foreground: null, supported: true });
    });
    expect(native.discard).toHaveBeenCalledOnce();
    expect(native.ask).not.toHaveBeenCalled();
    expect(deps.tabsRef.current[0].editorPanes[0].files).toContain(target);
    expect(deps.dirtyFilesRef.current.has(target.id)).toBe(true);
  },
);

it("closes approved targets using queued state and keeps concurrent files and tabs", async () => {
  native.discard.mockResolvedValue(true);
  actions.onCloseOtherFiles(paneId, selected.id);
  const added = newFileTab("/added", "/repo");
  const otherTab = newEditorWorkspaceTab(newFileTab("/other", "/other"));
  queuedTabs = [
    {
      ...tab,
      editorPanes: [{ ...tab.editorPanes[0], files: [selected, target, terminal, added] }],
    },
    otherTab,
  ];
  deps.dirtyFilesRef.current = new Set([target.id, added.id]);
  await act(async () => {
    resolveStatus({ foreground: null, supported: true });
  });
  expect(native.discard).toHaveBeenCalledOnce();
  expect(queuedTabs[0].editorPanes[0].files).toEqual([selected, added]);
  expect(queuedTabs[1]).toBe(otherTab);
  expect(deps.dirtyFilesRef.current).toEqual(new Set([added.id]));
});

it.each(["selected removed", "pane moving"])(
  "abandons close without clearing dirty markers when %s",
  async (change) => {
    actions.onCloseOtherFiles(paneId, selected.id);
    deps.dirtyFilesRef.current.add(target.id);
    if (change === "selected removed") tab.editorPanes[0].files = [target, terminal];
    else moving = true;
    await act(async () => {
      resolveStatus({ foreground: null, supported: true });
    });
    expect(native.discard).not.toHaveBeenCalled();
    expect(deps.tabsRef.current[0].editorPanes[0].files).toContain(target);
    expect(deps.dirtyFilesRef.current.has(target.id)).toBe(true);
  },
);
