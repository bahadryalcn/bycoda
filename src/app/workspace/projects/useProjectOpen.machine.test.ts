// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pickFolderOnMachine } from "../../../features/connections/model/machineFolderPick";
import { rememberProject } from "../../../features/projects/model/recents";
import { useProjectOpen, type ProjectOpenDeps } from "./useProjectOpen";

vi.mock("../../../features/connections/model/machineFolderPick", () => ({
  pickFolderOnMachine: vi.fn(),
}));
vi.mock("../../../features/projects/model/recents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/projects/model/recents")>()),
  rememberProject: vi.fn(async () => []),
}));

let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useProjectOpen>;
const deps = () => {
  const noop = () => vi.fn();
  return {
    readProjectReturnMemory: () => ({}),
    tabsRef: { current: [] },
    sessionsRef: { current: [] },
    activeTabIdRef: { current: "" },
    setSearchViewOpen: noop(),
    setInboxViewOpen: noop(),
    setNotesViewOpen: noop(),
    setAutomationsViewOpen: noop(),
    onCwdChange: noop(),
    setSessions: noop(),
    setTabs: noop(),
    insertBeside: noop(),
    setProjectCwd: noop(),
    activateTab: noop(),
    setActiveTabId: noop(),
    setComposerFocused: noop(),
    setRecents: noop(),
    workspaceNavigation: { cancel: vi.fn(), selectProject: vi.fn() },
  } as unknown as ProjectOpenDeps;
};
let current: ProjectOpenDeps;

function Harness() {
  api = useProjectOpen(current);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(pickFolderOnMachine).mockReset();
  vi.mocked(rememberProject).mockClear();
  current = deps();
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("returns the verified path of the machine's folder, remembers it, and does not navigate", async () => {
  vi.mocked(pickFolderOnMachine).mockResolvedValue("remote://env/home/me/app");
  let path: string | undefined;
  await act(async () => {
    path = await api.pickProjectOnMachine({ kind: "remote", machineId: "m2" });
  });
  expect(path).toBe("remote://env/home/me/app");
  expect(pickFolderOnMachine).toHaveBeenCalledWith({ kind: "remote", machineId: "m2" });
  expect(rememberProject).toHaveBeenCalledWith("remote://env/home/me/app");
  expect(current.workspaceNavigation.selectProject).not.toHaveBeenCalled();
  expect(current.setProjectCwd).not.toHaveBeenCalled();
  expect(current.setSearchViewOpen).not.toHaveBeenCalled();
});

it("keeps everything as it was when the picker is cancelled", async () => {
  vi.mocked(pickFolderOnMachine).mockResolvedValue(undefined);
  let path: string | undefined = "x";
  await act(async () => {
    path = await api.pickProjectOnMachine({ kind: "local" });
  });
  expect(path).toBeUndefined();
  expect(rememberProject).not.toHaveBeenCalled();
  expect(current.setRecents).not.toHaveBeenCalled();
});
