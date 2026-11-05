// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const ownership = vi.hoisted(() => ({
  reserve:
    vi.fn<(ids: readonly string[]) => Promise<((retain?: boolean) => Promise<void>) | null>>(),
}));
vi.mock("../../model/sessionWindowOwnership", () => ({
  reserveSessionWindow: ownership.reserve,
  remoteSessionOwnershipKey: (project: string, id: string) => `${project.split("/")[2]}:${id}`,
}));
import { rememberRemoteSession } from "../../../features/connections/model/connections";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { newSession } from "../../../features/sessions/model/session";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { captureSessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import { collectWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import {
  useOpenRecoveredSessions,
  type OpenRecoveredSessions,
  type OpenRecoveredSessionsDeps,
} from "./useOpenRecoveredSessions";

const PROJECT = "remote://env/repo";
let root: Root;
let actions: OpenRecoveredSessions;

beforeEach(() => {
  ownership.reserve.mockReset().mockImplementation(async () => async () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  sessionsRef.current = [];
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("resolves a remote stub whose host session is already open instead of restoring a second shell", async () => {
  const open = newSession("codex", PROJECT);
  const stale = newSession("codex", PROJECT);
  const fresh = newSession("codex", PROJECT);
  rememberRemoteSession(stale.id, "host-open");
  rememberRemoteSession(fresh.id, "host-new");
  const saved = collectWorkspaceSnapshot(
    [newTab(stale.id), newTab(fresh.id)],
    [stale, fresh],
    "tab",
    PROJECT,
    new Map(),
  );
  const sessionRecovery = captureSessionRecovery(null, saved, 100)!;
  localStorage.clear();
  rememberRemoteSession(open.id, "host-open");
  const openTab = newTab(open.id);
  sessionsRef.current = [open];

  const tabsRef = { current: [openTab] as WorkspaceTab[] };
  const activeTabIdRef = { current: "" };
  const setActiveTabId = vi.fn();
  const removeRecoveredSessions = vi.fn(async () => undefined);
  const deps: OpenRecoveredSessionsDeps = {
    sessionRecovery,
    lockSnapshot: {
      lockedProjectKeys: new Set(),
    } as OpenRecoveredSessionsDeps["lockSnapshot"],
    removingSessionIds: { current: new Set() },
    movingSessionIds: { current: new Set() },
    switchingWorktrees: { current: new Map() },
    workspaceNavigation: {
      cancel: vi.fn(),
    } as unknown as OpenRecoveredSessionsDeps["workspaceNavigation"],
    ensureOpenSession: async () => null,
    tabsRef,
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    activeTabIdRef,
    setActiveTabId,
    followProject: vi.fn(),
    removeRecoveredSessions,
  };
  function Harness() {
    actions = useOpenRecoveredSessions(deps);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));

  // Only the covered stub: nothing is added, the open tab is focused, the stub is resolved.
  await act(async () => actions.openRecoveredSessions([stale.id], false));
  expect(sessionsRef.current.map((session) => session.id)).toEqual([open.id]);
  expect(tabsRef.current.map((tab) => tab.id)).toEqual([openTab.id]);
  expect(setActiveTabId).toHaveBeenCalledWith(openTab.id);
  expect(removeRecoveredSessions).toHaveBeenLastCalledWith([stale.id]);

  // A genuinely unopened stub is still rebuilt from the saved binding.
  await act(async () => actions.openRecoveredSessions([stale.id, fresh.id], false));
  expect(sessionsRef.current.map((session) => session.id)).toEqual([open.id, fresh.id]);
  expect(removeRecoveredSessions).toHaveBeenLastCalledWith([fresh.id, stale.id]);
  expect(ownership.reserve).toHaveBeenCalledWith([fresh.id, "env:host-new"]);
});

it("retains opened tabs after acknowledgment failure and retries without reopening them", async () => {
  const session = newSession("codex", "/repo");
  const recovery = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot([newTab(session.id)], [session], "tab", "/repo", new Map()),
    100,
  )!;
  const tabsRef = { current: [] as WorkspaceTab[] };
  const ensureOpenSession = vi.fn(async () => {
    sessionsRef.current = [session];
    return session;
  });
  const removeRecoveredSessions = vi
    .fn<(_ids: string[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error("snapshot unavailable"))
    .mockResolvedValue(undefined);
  const deps: OpenRecoveredSessionsDeps = {
    sessionRecovery: recovery,
    lockSnapshot: { lockedProjectKeys: new Set() } as OpenRecoveredSessionsDeps["lockSnapshot"],
    removingSessionIds: { current: new Set() },
    movingSessionIds: { current: new Set() },
    switchingWorktrees: { current: new Map() },
    workspaceNavigation: {
      cancel: vi.fn(),
    } as unknown as OpenRecoveredSessionsDeps["workspaceNavigation"],
    ensureOpenSession,
    tabsRef,
    setTabs: (next) => {
      tabsRef.current = typeof next === "function" ? next(tabsRef.current) : next;
    },
    activeTabIdRef: { current: "" },
    setActiveTabId: vi.fn(),
    followProject: vi.fn(),
    removeRecoveredSessions,
  };
  function Harness() {
    actions = useOpenRecoveredSessions(deps);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    await expect(actions.openRecoveredSessions([session.id], false)).rejects.toMatchObject({
      opened: [session.id],
      failed: [],
      acknowledgmentFailed: true,
    });
  });
  const openedTabId = tabsRef.current[0].id;
  await act(async () => actions.openRecoveredSessions([session.id], false));
  expect(ensureOpenSession).toHaveBeenCalledOnce();
  expect(tabsRef.current.map((tab) => tab.id)).toEqual([openedTabId]);
  expect(removeRecoveredSessions).toHaveBeenCalledTimes(2);
});

it("focuses foreign ownership without creating a pane and releases stale reservations", async () => {
  const session = newSession("codex", "/repo");
  const recovery = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot([newTab(session.id)], [session], "tab", "/repo", new Map()),
    100,
  )!;
  const tabsRef = { current: [] as WorkspaceTab[] };
  const ensure = vi.fn(async () => session);
  const remove = vi.fn(async () => undefined);
  const removing = { current: new Set<string>() };
  const deps: OpenRecoveredSessionsDeps = {
    sessionRecovery: recovery,
    lockSnapshot: { lockedProjectKeys: new Set() } as OpenRecoveredSessionsDeps["lockSnapshot"],
    removingSessionIds: removing,
    movingSessionIds: { current: new Set() },
    switchingWorktrees: { current: new Map() },
    workspaceNavigation: {
      cancel: vi.fn(),
    } as unknown as OpenRecoveredSessionsDeps["workspaceNavigation"],
    ensureOpenSession: ensure,
    tabsRef,
    setTabs: vi.fn(),
    activeTabIdRef: { current: "" },
    setActiveTabId: vi.fn(),
    followProject: vi.fn(),
    removeRecoveredSessions: remove,
  };
  function Harness() {
    actions = useOpenRecoveredSessions(deps);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  ownership.reserve.mockResolvedValueOnce(null);
  await act(async () => actions.openRecoveredSessions([session.id], false));
  expect(ensure).not.toHaveBeenCalled();
  expect(tabsRef.current).toHaveLength(0);
  expect(remove).toHaveBeenCalledWith([session.id]);
  const release = vi.fn(async (_retain?: boolean) => {});
  ownership.reserve.mockImplementationOnce(async () => {
    removing.current.add(session.id);
    return release;
  });
  await act(async () => actions.openRecoveredSessions([session.id], false));
  expect(release).toHaveBeenCalledWith(false);
  expect(ensure).not.toHaveBeenCalled();
  expect(tabsRef.current).toHaveLength(0);
});
