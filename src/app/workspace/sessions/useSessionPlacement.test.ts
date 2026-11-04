// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { useSessionPlacement, type SessionPlacementDeps } from "./useSessionPlacement";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  forget: vi.fn().mockResolvedValue(undefined),
  locked: new Set<string>(),
  remote: new Map<string, string>(),
}));
vi.mock("../../model/sessionWindowOwnership", () => ({
  reserveSessionWindow: mocks.reserve,
  remoteSessionOwnershipKey: (cwd: string, id: string) => `remote:${cwd}:${id}`,
}));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: {} }),
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({
  isProjectLockedIn: (_: unknown, cwd: string) => mocks.locked.has(cwd),
}));
vi.mock("../../../features/connections/model/connections", () => ({
  remoteSessionFor: (id: string) => mocks.remote.get(id),
}));
vi.mock("../../../integrations/harness", () => ({ forgetHarnessSession: mocks.forget }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn().mockResolvedValue(undefined) }));

let root: Root;
let node: HTMLDivElement;
let deps: SessionPlacementDeps;
let actions: ReturnType<typeof useSessionPlacement>;
let source: Session;
let target: Session;
let finish: ReturnType<typeof vi.fn>;

function Harness() {
  actions = useSessionPlacement(deps);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.locked.clear();
  mocks.remote.clear();
  mocks.reserve.mockReset();
  mocks.forget.mockClear();
  source = { ...newDefaultSession("/source"), id: "source" };
  target = { ...newDefaultSession("/target"), id: "target" };
  finish = vi.fn().mockResolvedValue(undefined);
  mocks.reserve.mockResolvedValue(finish);
  const tab = { ...newTab(target.id), id: "tab" };
  const tabsRef = { current: [tab] as WorkspaceTab[] };
  const sessionsRef = { current: [target] as Session[] };
  deps = {
    isMovingPane: () => false,
    movingTabIds: { current: new Set() },
    tabsRef,
    sessionsRef,
    dirtyFilesRef: { current: new Set() },
    lastPersisted: { current: new Map([[target.id, "saved"]]) },
    projectCwdRef: { current: "/target" },
    setSessions: vi.fn(),
    setTabs: vi.fn(),
    setActiveTabId: vi.fn(),
    setProjectTerminalFocused: vi.fn(),
    setComposerFocused: vi.fn(),
    ensureOpenSession: vi.fn(async () => {
      sessionsRef.current.push(source);
      return source;
    }),
    tabCloseScope: "project",
    tabWorktreeOf: () => null,
    onMovePane: vi.fn(),
  };
  node = document.createElement("div");
  root = createRoot(node);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("leaves the blank target intact when another window owns the session", async () => {
  mocks.reserve.mockResolvedValueOnce(null);
  await act(async () => {
    await actions.onPlaceSessionOnPane("source", "target", "right");
  });
  expect(leafIds(deps.tabsRef.current[0].layout)).toEqual(["target"]);
  expect(deps.lastPersisted.current.has("target")).toBe(true);
  expect(mocks.forget).not.toHaveBeenCalled();
  expect(deps.setTabs).not.toHaveBeenCalled();
});

it("keeps the target unchanged when ownership cannot be checked", async () => {
  mocks.reserve.mockRejectedValueOnce(new Error("ownership unavailable"));
  await act(async () => {
    await actions.onPlaceSessionOnPane("source", "target", "right");
  });
  expect(deps.setTabs).not.toHaveBeenCalled();
  expect(deps.lastPersisted.current.has("target")).toBe(true);
  expect(mocks.forget).not.toHaveBeenCalled();
});

it("claims local and canonical remote identity before replacing a blank pane", async () => {
  source.cwd = "remote://machine/repo";
  mocks.remote.set("source", "host-session");
  await act(async () => {
    await actions.onPlaceSessionOnPane("source", "target", "right");
  });
  expect(mocks.reserve).toHaveBeenCalledWith([
    "source",
    "remote:remote://machine/repo:host-session",
  ]);
  expect(leafIds(deps.tabsRef.current[0].layout)).toEqual(["source"]);
  expect(mocks.forget).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledWith(true);
});

it.each([
  "target-removed",
  "moving",
  "locked",
  "target-locked",
  "session-removed",
  "source-moved",
  "remote-changed",
])("releases the claim without mutations when %s changes during admission", async (change) => {
  let resume!: (value: typeof finish) => void;
  mocks.reserve.mockReturnValueOnce(
    new Promise((resolve) => {
      resume = resolve;
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.onPlaceSessionOnPane("source", "target", "right");
    await Promise.resolve();
  });
  if (change === "target-removed") deps.tabsRef.current = [];
  if (change === "moving") deps.movingTabIds.current.add("tab");
  if (change === "locked") mocks.locked.add("/source");
  if (change === "target-locked") mocks.locked.add("/target");
  if (change === "session-removed") deps.sessionsRef.current = [target];
  if (change === "source-moved") deps.tabsRef.current.push({ ...newTab("source"), id: "other" });
  if (change === "remote-changed") {
    source.cwd = "remote://machine/repo";
    mocks.remote.set("source", "host-session");
  }
  await act(async () => {
    resume(finish);
    await pending;
  });
  expect(deps.setTabs).not.toHaveBeenCalled();
  expect(deps.lastPersisted.current.has("target")).toBe(true);
  expect(mocks.forget).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledWith(false);
});
