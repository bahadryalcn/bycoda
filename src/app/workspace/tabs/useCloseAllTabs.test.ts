// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import {
  leaf,
  newTab,
  openEditorTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { useCloseAllTabs, type CloseAllTabsDeps } from "./useCloseAllTabs";
import { useCloseTabActions } from "./useCloseTabActions";

const confirms = vi.hoisted(() => ({ dirty: vi.fn(), terminals: vi.fn() }));
vi.mock("../helpers/appHelpers", () => ({ confirmDiscardUnsaved: confirms.dirty }));
vi.mock("../../../features/terminal/model/terminalClose", () => ({
  confirmCloseTerminals: confirms.terminals,
}));

let root: Root;
let container: HTMLDivElement;
let deps: CloseAllTabsDeps;
let closeAll: () => void;
let setLiveTabs: CloseAllTabsDeps["setTabs"];
let onClearTabSession: ReturnType<typeof vi.fn<(id: string) => void>>;
const tab = (id: string): WorkspaceTab => ({ ...newTab(`session-${id}`), id });
const file = (id: string): FilePaneTab => ({ id, path: `/${id}`, cwd: "/project" });
const withFile = (value: WorkspaceTab, item: FilePaneTab) => openEditorTab(value, item);
const ids = () => deps.tabsRef.current.map((value) => value.id);
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness() {
  const [tabs, setTabs] = useState(deps.tabsRef.current);
  setLiveTabs = setTabs;
  deps.tabsRef.current = tabs;
  const actions = useCloseTabActions({
    activateTab: vi.fn(),
    persistSession: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/project",
    tabCloseScope: deps.tabCloseScope,
    tabWorktreeOf: deps.tabWorktreeOf,
    tabsRef: deps.tabsRef,
    sessionsRef: deps.sessionsRef,
    activeTabIdRef: deps.activeTabIdRef,
    movingTabIds: { current: new Set() },
    windowTransferPendingRef: deps.windowTransferPendingRef,
    dirtyFilesRef: deps.dirtyFilesRef,
    setDirtyFiles: deps.setDirtyFiles,
    setTabs: deps.setTabs,
    rememberRemoteSession: vi.fn(),
    rememberRemotePendingWorktree: vi.fn(),
  });
  closeAll = useCloseAllTabs({ ...deps, ...actions }).onCloseAllTabs;
  return null;
}
async function mountWith(tabs: WorkspaceTab[], dirty: string[]) {
  deps.tabsRef.current = tabs;
  deps.sessionsRef.current = tabs.map((value) => ({
    ...newSession("claude", "/project"),
    id: `session-${value.id}`,
  }));
  deps.dirtyFilesRef.current = new Set(dirty);
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  confirms.dirty.mockReset().mockResolvedValue(true);
  confirms.terminals.mockReset().mockResolvedValue(true);
  onClearTabSession = vi.fn();
  deps = {
    onCloseTab: vi.fn(),
    onCloseTabs: vi.fn(),
    onClearTabSession,
    projectCwd: "/project",
    tabCloseScope: "workspace",
    tabWorktreeOf: () => null,
    tabsRef: { current: [] },
    sessionsRef: { current: [] },
    activeTabIdRef: { current: "a" },
    windowTransferPendingRef: { current: false },
    dirtyFilesRef: { current: new Set() },
    setDirtyFiles: (update) => {
      deps.dirtyFilesRef.current =
        typeof update === "function" ? update(deps.dirtyFilesRef.current) : update;
    },
    setTabs: (update) => setLiveTabs(update),
    setSessions: vi.fn(),
    setComposerFocused: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("closes every other tab and clears the active one once confirmed", async () => {
  await mountWith([tab("a"), withFile(tab("b"), file("dirty")), tab("c")], ["dirty"]);
  await act(async () => closeAll());
  expect(confirms.dirty).toHaveBeenCalledOnce();
  expect(ids()).toEqual(["a"]);
  expect(onClearTabSession).toHaveBeenCalledExactlyOnceWith("a");
});

it("leaves every tab in place when the prompt is declined", async () => {
  await mountWith([tab("a"), withFile(tab("b"), file("dirty"))], ["dirty"]);
  confirms.dirty.mockResolvedValue(false);
  await act(async () => closeAll());
  expect(ids()).toEqual(["a", "b"]);
  expect(onClearTabSession).not.toHaveBeenCalled();
});

it("keeps a tab opened while the prompt is open", async () => {
  await mountWith([tab("a"), withFile(tab("b"), file("dirty"))], ["dirty"]);
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  await act(async () => closeAll());
  const opened = withFile(tab("c"), file("fresh"));
  await act(async () => setLiveTabs((previous) => [...previous, opened]));
  await act(async () => pending.resolve(true));
  expect(ids()).toEqual(["a", "c"]);
  expect(deps.tabsRef.current[1]).toBe(opened);
});

it("asks again for a file that became dirty during the prompt", async () => {
  await mountWith(
    [tab("a"), withFile(tab("b"), file("one")), withFile(tab("c"), file("two"))],
    ["one"],
  );
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(false);
  await act(async () => closeAll());
  deps.dirtyFilesRef.current.add("two");
  await act(async () => pending.resolve(true));
  expect(confirms.dirty).toHaveBeenCalledTimes(2);
  expect(confirms.dirty.mock.calls[1][0].files.map((item: FilePaneTab) => item.id)).toEqual([
    "two",
  ]);
  expect(ids()).toEqual(["a", "b", "c"]);
  expect(deps.dirtyFilesRef.current).toEqual(new Set(["one", "two"]));
});

it("keeps a tab whose sessions changed during the prompt", async () => {
  await mountWith([tab("a"), withFile(tab("b"), file("dirty")), tab("c")], ["dirty"]);
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  await act(async () => closeAll());
  const replaced = { ...tab("x"), id: "b" };
  await act(async () =>
    setLiveTabs((previous) => previous.map((value) => (value.id === "b" ? replaced : value))),
  );
  await act(async () => pending.resolve(true));
  expect(ids()).toEqual(["a", "b"]);
  expect(deps.tabsRef.current[1]).toBe(replaced);
});

it("abandons the command when the window is being transferred", async () => {
  await mountWith([tab("a"), withFile(tab("b"), file("dirty"))], ["dirty"]);
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  await act(async () => closeAll());
  deps.windowTransferPendingRef.current = true;
  await act(async () => pending.resolve(true));
  expect(ids()).toEqual(["a", "b"]);
  expect(onClearTabSession).not.toHaveBeenCalled();
});

it("keeps tab patches that landed while the editor files prompt was open", async () => {
  await mountWith([withFile(tab("a"), file("dirty")), tab("b")], ["dirty"]);
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  await act(async () => closeAll());
  await act(async () =>
    setLiveTabs((previous) =>
      previous.map((value) => (value.id === "a" ? { ...value, diffOpen: true } : value)),
    ),
  );
  await act(async () => pending.resolve(true));
  expect(deps.tabsRef.current[0].editorPanes).toEqual([]);
  expect(deps.tabsRef.current[0].diffOpen).toBe(true);
  expect(ids()).toEqual(["a", "b"]);
  expect(deps.dirtyFilesRef.current.has("dirty")).toBe(false);
});

it("asks again for a file that became dirty in the active tab during the prompt", async () => {
  await mountWith([withFile(tab("a"), file("one")), tab("b")], ["one"]);
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(false);
  await act(async () => closeAll());
  await act(async () =>
    setLiveTabs((previous) =>
      previous.map((value) => (value.id === "a" ? openEditorTab(value, file("two")) : value)),
    ),
  );
  deps.dirtyFilesRef.current.add("two");
  await act(async () => pending.resolve(true));
  expect(confirms.dirty).toHaveBeenCalledTimes(2);
  expect(deps.tabsRef.current[0].editorPanes.flatMap((pane) => pane.files)).toHaveLength(2);
  expect(deps.dirtyFilesRef.current).toEqual(new Set(["one", "two"]));
});

it("keeps the single-tab close when the active tab holds only editor files", async () => {
  const pane = { id: "pane-a", files: [file("dirty")], activeFileId: "dirty" };
  const editorOnly: WorkspaceTab = {
    ...tab("a"),
    layout: leaf(pane.id),
    focusedId: pane.id,
    editorPanes: [pane],
  };
  await mountWith([editorOnly, tab("b")], ["dirty"]);
  await act(async () => closeAll());
  expect(confirms.dirty).toHaveBeenCalledOnce();
  expect(ids()).toEqual(["b"]);
  expect(onClearTabSession).not.toHaveBeenCalled();
});
