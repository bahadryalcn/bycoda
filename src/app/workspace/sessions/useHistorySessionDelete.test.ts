// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { summaryFromSession } from "../../../features/sessions/data/sessionHistory";
import { newTab } from "../../../features/workspace/model/layout";
import { useHistorySessionDelete, type HistorySessionDeleteDeps } from "./useHistorySessionDelete";

const storage = vi.hoisted(() => ({ archive: vi.fn(), remove: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  setSessionArchived: storage.archive,
  deleteSession: storage.remove,
  shouldPersistSession: () => true,
  upsertSession: vi.fn(),
}));
vi.mock("../../../features/sessions/model/confirmSessionDelete", () => ({
  confirmSessionDelete: storage.confirm,
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  forgetHarnessSession: vi.fn(async () => undefined),
}));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: {
    forSession: () => undefined,
    deleteSession: (_id: string, remove: () => Promise<void>) => remove(),
  },
}));
vi.mock("./crewManagedGuard", () => ({
  refuseCrewManagedSession: () => false,
  reportCrewManagedRefusal: () => false,
}));

let root: Root;
let deps: HistorySessionDeleteDeps;
let actions: ReturnType<typeof useHistorySessionDelete>;
const current = { ...newSession("cursor", "/current"), id: "current" };
const listed = summaryFromSession({ ...newSession("cursor", "/owning"), id: "listed" });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.archive.mockReset().mockResolvedValue(undefined);
  storage.remove.mockReset().mockResolvedValue(undefined);
  storage.confirm.mockReset().mockResolvedValue(true);
  const tab = newTab(current.id);
  deps = {
    sessions: {
      sessionsRef: { current: [current] },
      setSessions: vi.fn(),
      history: [summaryFromSession(current)],
      setHistory: (update) => {
        deps.sessions.history =
          typeof update === "function" ? update(deps.sessions.history) : update;
      },
      setStoredLinkedSessions: vi.fn(),
      loadedSessionCache: { current: new Map() },
      sessionLoads: { current: new Map() },
      lastPersisted: { current: new Map() },
      pendingPersist: { current: new Map() },
      invalidateLoadedSession: vi.fn(),
      refreshHistory: vi.fn(async () => undefined),
      sidebarCwd: current.cwd,
    },
    tabs: {
      tabsRef: { current: [tab] },
      activeTabIdRef: { current: tab.id },
      dirtyFilesRef: { current: new Set() },
      setTabs: vi.fn(),
      setDirtyFiles: vi.fn(),
      setComposerFocused: vi.fn(),
      activateTab: vi.fn(),
      tabWorkspace: () => current.cwd,
      tabWorktreeOf: () => null,
      tabCloseScope: "project",
    },
    removal: {
      removingSessionIds: { current: new Set() },
      switchingWorktrees: { current: new Map() },
      deleteConfirmationPending: { current: false },
      setSessionDeleteDialog: vi.fn(),
      stopSessionForRemoval: vi.fn(async () => undefined),
      onRemoveWorktree: vi.fn(),
    },
  };
  function Harness() {
    actions = useHistorySessionDelete(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["archive", "delete"] as const)(
  "%s targets a listed session's owning project while keeping the current session open",
  async (mode) => {
    const originalTab = deps.tabs.tabsRef.current[0];
    expect(await actions.onRemoveHistorySession(listed.id, mode, false, undefined, listed)).toBe(
      true,
    );
    if (mode === "archive") {
      expect(storage.archive).toHaveBeenCalledWith(listed.id, true);
      expect(deps.sessions.history.find((entry) => entry.id === listed.id)).toMatchObject({
        cwd: listed.cwd,
        archived: true,
      });
    } else {
      expect(storage.remove).toHaveBeenCalledWith(listed.id, []);
    }
    expect(deps.sessions.sessionsRef.current).toEqual([current]);
    expect(deps.tabs.tabsRef.current).toEqual([originalTab]);
    expect(deps.tabs.activateTab).not.toHaveBeenCalled();
  },
);

it.each(["archive", "delete"] as const)(
  "%s retains checkout-switch protection for listed sessions",
  async (mode) => {
    deps.removal.switchingWorktrees.current.set(listed.id, "/other-checkout");
    const errors = vi.fn();
    expect(await actions.onRemoveHistorySession(listed.id, mode, false, errors, listed)).toBe(
      false,
    );
    expect(errors).toHaveBeenCalledWith("This conversation's checkout is being switched.");
    expect(storage.archive).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(deps.removal.stopSessionForRemoval).not.toHaveBeenCalled();
  },
);
