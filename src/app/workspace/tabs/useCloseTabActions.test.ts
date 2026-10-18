// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  newTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { useCloseTabActions, type CloseTabActionDeps } from "./useCloseTabActions";

const confirms = vi.hoisted(() => ({ dirty: vi.fn(), terminals: vi.fn() }));
vi.mock("../helpers/appHelpers", () => ({ confirmDiscardUnsaved: confirms.dirty }));
vi.mock("../../../features/terminal/model/terminalClose", () => ({
  confirmCloseTerminals: confirms.terminals,
}));

let root: Root;
let container: HTMLDivElement;
let deps: CloseTabActionDeps;
let actions: ReturnType<typeof useCloseTabActions>;
let setLiveTabs: CloseTabActionDeps["setTabs"];
let deferredUpdates: Parameters<CloseTabActionDeps["setTabs"]>[0][] | undefined;
const tab = (id: string) => ({ ...newTab(`session-${id}`), id });
const file = (id: string): FilePaneTab => ({ id, path: `/${id}`, cwd: "/project" });
function withFile(value: WorkspaceTab, item: FilePaneTab) {
  return {
    ...value,
    editorPanes: [{ id: `editor-${item.id}`, files: [item], activeFileId: item.id }],
  };
}
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
  actions = useCloseTabActions(deps);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  deferredUpdates = undefined;
  confirms.dirty.mockReset().mockResolvedValue(true);
  confirms.terminals.mockReset().mockResolvedValue(true);
  deps = {
    activateTab: vi.fn(),
    persistSession: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/project",
    tabCloseScope: "workspace",
    tabWorktreeOf: () => null,
    tabsRef: { current: [withFile(tab("a"), file("dirty")), tab("b")] },
    sessionsRef: { current: [] },
    activeTabIdRef: { current: "a" },
    movingTabIds: { current: new Set() },
    windowTransferPendingRef: { current: false },
    dirtyFilesRef: { current: new Set(["dirty"]) },
    setDirtyFiles: (update) => {
      deps.dirtyFilesRef.current =
        typeof update === "function" ? update(deps.dirtyFilesRef.current) : update;
    },
    setTabs: (update) => {
      if (deferredUpdates) deferredUpdates.push(update);
      else setLiveTabs(update);
    },
    rememberRemoteSession: vi.fn(),
    rememberRemotePendingWorktree: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("retains newly opened tabs and their current layout, without resurrecting a closed fallback", async () => {
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  actions.onCloseTab("a");
  const c = withFile(tab("c"), file("other-dirty"));
  await act(async () => setLiveTabs([deps.tabsRef.current[0], c]));
  deps.dirtyFilesRef.current.add("other-dirty");
  await act(async () => pending.resolve(true));
  expect(deps.tabsRef.current).toEqual([c]);
  expect(deps.tabsRef.current[0]).toBe(c);
  expect(deps.dirtyFilesRef.current).toEqual(new Set(["other-dirty"]));
  expect(deps.activateTab).toHaveBeenCalledExactlyOnceWith("c");
});

it("reconfirms a newly dirty file added while terminal checks wait", async () => {
  const pending = deferred();
  deps.tabsRef.current[0] = withFile(tab("a"), { ...file("terminal"), terminal: true });
  confirms.terminals.mockReturnValueOnce(pending.promise);
  confirms.dirty.mockResolvedValue(false);
  actions.onCloseTab("a");
  deps.tabsRef.current[0] = {
    ...deps.tabsRef.current[0],
    editorPanes: [
      ...deps.tabsRef.current[0].editorPanes,
      { id: "new-pane", files: [file("new-dirty")], activeFileId: "new-dirty" },
    ],
  };
  deps.dirtyFilesRef.current.add("new-dirty");
  await act(async () => pending.resolve(true));
  expect(confirms.dirty).toHaveBeenCalledOnce();
  expect(deps.tabsRef.current.map((value) => value.id)).toEqual(["a", "b"]);
  expect(deps.dirtyFilesRef.current.has("new-dirty")).toBe(true);
});

it.each(["removed", "last", "moving", "transferring"])(
  "abandons a pending close when the tab is %s",
  async (change) => {
    const pending = deferred();
    confirms.dirty.mockReturnValueOnce(pending.promise);
    actions.onCloseTab("a");
    if (change === "removed") await act(async () => setLiveTabs([tab("b"), tab("c")]));
    if (change === "last") await act(async () => setLiveTabs([deps.tabsRef.current[0]]));
    if (change === "moving") deps.movingTabIds.current.add("a");
    if (change === "transferring") deps.windowTransferPendingRef.current = true;
    const latest = deps.tabsRef.current;
    await act(async () => pending.resolve(true));
    expect(deps.tabsRef.current).toBe(latest);
    expect(deps.persistSession).not.toHaveBeenCalled();
    expect(deps.activateTab).not.toHaveBeenCalled();
    expect(deps.dirtyFilesRef.current.has("dirty")).toBe(true);
  },
);

it("keeps the tab and dirty buffers when confirmation is declined", async () => {
  confirms.dirty.mockResolvedValue(false);
  const latest = deps.tabsRef.current;
  await act(async () => actions.onCloseTab("a"));
  expect(deps.tabsRef.current).toBe(latest);
  expect(deps.dirtyFilesRef.current.has("dirty")).toBe(true);
  expect(deps.activateTab).not.toHaveBeenCalled();
});

it("batch close retains concurrent tabs and selects an existing fallback", async () => {
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  actions.onCloseTabs(["a"], "b");
  const c = tab("c");
  await act(async () => setLiveTabs([deps.tabsRef.current[0], c]));
  await act(async () => pending.resolve(true));
  expect(deps.tabsRef.current).toEqual([c]);
  expect(deps.activateTab).toHaveBeenCalledExactlyOnceWith("c");
});

it.each(["single", "batch"])(
  "does not clear dirty state or focus a stale fallback when a deferred %s updater aborts",
  async (kind) => {
    deferredUpdates = [];
    await act(async () => {
      if (kind === "single") actions.onCloseTab("a");
      else actions.onCloseTabs(["a"], "b");
    });
    expect(deferredUpdates).toHaveLength(1);
    expect(deps.dirtyFilesRef.current.has("dirty")).toBe(true);
    expect(deps.activateTab).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
    // The state queue has a newer tab snapshot than the callback saw.
    const updated = withFile(deps.tabsRef.current[0], file("new-dirty"));
    deps.dirtyFilesRef.current.add("new-dirty");
    const updates = deferredUpdates;
    deferredUpdates = undefined;
    await act(async () => {
      setLiveTabs([updated, tab("c")]);
      for (const update of updates) setLiveTabs(update);
    });
    expect(deps.tabsRef.current.map((value) => value.id)).toEqual(["a", "c"]);
    expect(deps.dirtyFilesRef.current).toEqual(new Set(["dirty", "new-dirty"]));
    expect(deps.activateTab).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
    expect(deps.refreshHistory).not.toHaveBeenCalled();
  },
);

it("uses the committed updater's fallback when an older fallback was queued for removal", async () => {
  deferredUpdates = [];
  await act(async () => actions.onCloseTab("a"));
  const updates = deferredUpdates;
  deferredUpdates = undefined;
  await act(async () => {
    setLiveTabs([deps.tabsRef.current[0], tab("c")]);
    for (const update of updates) setLiveTabs(update);
  });
  expect(deps.tabsRef.current.map((value) => value.id)).toEqual(["c"]);
  expect(deps.activateTab).toHaveBeenCalledExactlyOnceWith("c");
  expect(deps.dirtyFilesRef.current.has("dirty")).toBe(false);
});

it("revalidates the current close policy after awaiting confirmation", async () => {
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise);
  actions.onCloseTab("a");
  deps.tabCloseScope = "project";
  deps.sessionsRef.current = [
    { id: "session-a", cwd: "/project-a" },
    { id: "session-b", cwd: "/project-b" },
  ] as CloseTabActionDeps["sessionsRef"]["current"];
  await act(async () => root.render(createElement(Harness)));
  const latest = deps.tabsRef.current;
  await act(async () => pending.resolve(true));
  expect(deps.tabsRef.current).toBe(latest);
  expect(deps.dirtyFilesRef.current.has("dirty")).toBe(true);
  expect(deps.activateTab).not.toHaveBeenCalled();
});

it("batch close reconfirms files that became dirty during the first confirmation", async () => {
  const pending = deferred();
  confirms.dirty.mockReturnValueOnce(pending.promise).mockResolvedValue(false);
  actions.onCloseTabs(["a"], "b");
  deps.tabsRef.current[0] = withFile(deps.tabsRef.current[0], file("new-dirty"));
  deps.dirtyFilesRef.current.add("new-dirty");
  const latest = deps.tabsRef.current;
  await act(async () => pending.resolve(true));
  expect(confirms.dirty).toHaveBeenCalledTimes(2);
  expect(deps.tabsRef.current).toBe(latest);
  expect(deps.dirtyFilesRef.current.has("new-dirty")).toBe(true);
});
