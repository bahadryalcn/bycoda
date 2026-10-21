// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  leaf,
  newTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { useProjectRemoval, type ProjectRemovalDeps } from "./useProjectRemoval";

const effects = vi.hoisted(() => ({ confirm: vi.fn(), archive: vi.fn(), purge: vi.fn() }));
vi.mock("../helpers/appHelpers", () => ({ confirmDiscardUnsaved: effects.confirm }));
vi.mock("../../../features/projects/model/recents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  archiveProject: effects.archive,
  forgetProject: vi.fn(() => []),
}));
vi.mock("../../../features/projects/model/projectData", () => ({
  removeProjectData: effects.purge,
}));
vi.mock("../../../features/projects/model/projectLocation", () => ({
  forgetProjectLocation: vi.fn(),
}));
vi.mock("../../../integrations/harness", () => ({
  cancelHarnessTurn: vi.fn(),
  forgetHarnessSession: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let deps: ProjectRemovalDeps;
let actions: ReturnType<typeof useProjectRemoval>;
let setLiveTabs: ProjectRemovalDeps["setTabs"];
const file = (id: string, cwd = "/project"): FilePaneTab => ({ id, cwd, path: `${cwd}/${id}.txt` });
function tab(id: string, files: FilePaneTab[]): WorkspaceTab {
  return {
    ...newTab(`session-${id}`),
    id,
    layout: leaf(`editor-${id}`),
    focusedId: `editor-${id}`,
    editorPanes: [{ id: `editor-${id}`, files, activeFileId: files[0]?.id ?? "" }],
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
  const [tabs, setTabs] = useState(deps.refs.tabsRef.current);
  setLiveTabs = setTabs;
  deps.refs.tabsRef.current = tabs;
  actions = useProjectRemoval(deps);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  effects.confirm.mockReset().mockResolvedValue(true);
  effects.archive.mockReset().mockReturnValue([]);
  effects.purge.mockReset().mockResolvedValue(undefined);
  deps = {
    refs: {
      sessionsRef: { current: [] },
      tabsRef: {
        current: [tab("project", [file("dirty")]), tab("other", [file("other-dirty", "/other")])],
      },
      activeTabIdRef: { current: "project" },
      projectCwdRef: { current: "/project" },
      dirtyFilesRef: { current: new Set(["dirty", "other-dirty"]) },
      removingSessionIds: { current: new Set() },
      loadedSessionCache: { current: new Map() },
      sessionLoads: { current: new Map() },
      pendingPersist: { current: new Map() },
      lastPersisted: { current: new Map() },
      turnGen: { current: new Map() },
    },
    activeTabId: "project",
    invalidateLoadedSession: vi.fn(),
    persistSession: vi.fn(),
    onSelectProject: vi.fn(),
    setRecents: vi.fn(),
    setSidebarTabSelection: vi.fn(),
    setSessions: vi.fn(),
    setTabs: (update) => setLiveTabs(update),
    setActiveTabId: vi.fn(),
    setProjectCwd: vi.fn(),
    setDirtyFiles: (update) => {
      deps.refs.dirtyFilesRef.current =
        typeof update === "function" ? update(deps.refs.dirtyFilesRef.current) : update;
    },
    setProjectTerminals: vi.fn(),
    setComposerFocused: vi.fn(),
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

it("keeps the project, tabs and dirty buffers when archive is declined", async () => {
  effects.confirm.mockResolvedValue(false);
  const original = deps.refs.tabsRef.current;
  await act(async () => {
    await expect(actions.onRemoveProject("/project", { purgeData: false })).rejects.toThrow(
      "Cancelled",
    );
  });
  expect(effects.confirm).toHaveBeenCalledOnce();
  expect(effects.archive).not.toHaveBeenCalled();
  expect(deps.refs.tabsRef.current).toBe(original);
  expect(deps.refs.dirtyFilesRef.current).toEqual(new Set(["dirty", "other-dirty"]));
  expect(deps.setRecents).not.toHaveBeenCalled();
});

it("discards only the confirmed project's buffers and preserves concurrent unrelated tabs", async () => {
  const pending = deferred();
  effects.confirm.mockReturnValueOnce(pending.promise);
  let operation!: Promise<void>;
  act(() => {
    operation = actions.onRemoveProject("/project", { purgeData: false });
  });
  const added = tab("new", [file("new-dirty", "/new")]);
  const other = deps.refs.tabsRef.current[1];
  await act(async () => setLiveTabs((tabs) => [...tabs, added]));
  deps.refs.dirtyFilesRef.current.add("new-dirty");
  await act(async () => {
    pending.resolve(true);
    await operation;
  });
  expect(effects.confirm).toHaveBeenCalledOnce();
  expect(deps.refs.tabsRef.current).toEqual([other, added]);
  expect(deps.refs.dirtyFilesRef.current).toEqual(new Set(["other-dirty", "new-dirty"]));
});

it("asks again for a newly dirty filesystem buffer before removing the project", async () => {
  const pending = deferred();
  effects.confirm.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(false);
  let operation!: Promise<void>;
  act(() => {
    operation = actions.onRemoveProject("/project", { purgeData: false });
  });
  await act(async () =>
    setLiveTabs((tabs) => [
      {
        ...tabs[0],
        terminalPanes: [{ id: "extra", files: [file("new-dirty")], activeFileId: "new-dirty" }],
      },
      ...tabs.slice(1),
    ]),
  );
  deps.refs.dirtyFilesRef.current.add("new-dirty");
  await act(async () => {
    pending.resolve(true);
    await expect(operation).rejects.toThrow("Cancelled");
  });
  expect(effects.confirm).toHaveBeenCalledTimes(2);
  expect(effects.archive).not.toHaveBeenCalled();
  expect(deps.refs.tabsRef.current).toHaveLength(2);
  expect(deps.refs.dirtyFilesRef.current.has("new-dirty")).toBe(true);
});

it("does not prompt for clean filesystem files or dirty virtual documents", async () => {
  await act(async () =>
    setLiveTabs([
      tab("project", [{ ...file("dirty"), terminal: true }, file("clean")]),
      deps.refs.tabsRef.current[1],
    ]),
  );
  await act(async () => actions.onRemoveProject("/project", { purgeData: false }));
  expect(effects.confirm).not.toHaveBeenCalled();
  expect(effects.archive).toHaveBeenCalledExactlyOnceWith("/project");
});

it("confirms before deleting stored project data", async () => {
  effects.confirm.mockResolvedValue(false);
  await act(async () => {
    await expect(actions.onRemoveProject("/project", { purgeData: true })).rejects.toThrow(
      "Cancelled",
    );
  });
  expect(effects.purge).not.toHaveBeenCalled();
  expect(deps.refs.tabsRef.current).toHaveLength(2);
});

it("stops bulk/group removal at the declined project", async () => {
  effects.confirm.mockResolvedValueOnce(false);
  const removeSelection = async () => {
    for (const path of ["/project", "/other"]) {
      await actions.onRemoveProject(path, { purgeData: true });
    }
  };
  await act(async () => {
    await expect(removeSelection()).rejects.toThrow("Cancelled");
  });
  expect(effects.confirm).toHaveBeenCalledOnce();
  expect(effects.purge).not.toHaveBeenCalled();
  expect(deps.refs.tabsRef.current).toHaveLength(2);
});

it("rechecks new dirty files after asynchronous project storage removal", async () => {
  const pending = deferred();
  effects.purge.mockReturnValueOnce(pending.promise);
  effects.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  let operation!: Promise<void>;
  await act(async () => {
    operation = actions.onRemoveProject("/project", { purgeData: true });
  });
  await act(async () =>
    setLiveTabs((tabs) => [tab("project", [file("dirty"), file("new-dirty")]), ...tabs.slice(1)]),
  );
  deps.refs.dirtyFilesRef.current.add("new-dirty");
  await act(async () => {
    pending.resolve(true);
    await expect(operation).rejects.toThrow("Cancelled");
  });
  expect(effects.confirm).toHaveBeenCalledTimes(2);
  expect(deps.refs.tabsRef.current).toHaveLength(2);
  expect(deps.refs.dirtyFilesRef.current.has("new-dirty")).toBe(true);
  expect(deps.setRecents).not.toHaveBeenCalled();
});

it("requires fresh approval for an already dirty buffer after storage removal yields", async () => {
  const pending = deferred();
  effects.purge.mockReturnValueOnce(pending.promise);
  effects.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  let operation!: Promise<void>;
  await act(async () => {
    operation = actions.onRemoveProject("/project", { purgeData: true });
  });
  await act(async () => {
    pending.resolve(true);
    await expect(operation).rejects.toThrow("Cancelled");
  });
  expect(effects.confirm).toHaveBeenCalledTimes(2);
  expect(deps.refs.tabsRef.current).toHaveLength(2);
  expect(deps.refs.dirtyFilesRef.current.has("dirty")).toBe(true);
});
