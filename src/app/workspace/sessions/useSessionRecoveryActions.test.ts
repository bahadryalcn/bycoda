// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import {
  getSession,
  isPrimaryWorkspaceWindow,
  saveWorkspaceSnapshot,
} from "../../../features/sessions/data/sessionStore";
import { invoke } from "@tauri-apps/api/core";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import { newTab } from "../../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import {
  captureSessionRecovery,
  getSessionRecovery,
  getRecoverySaveFailure,
  removeRecoverySessions,
  setRecoverySaveFailure,
  setSessionRecovery,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import * as lockState from "../../../features/group-lock/model/lockState";
import {
  useSessionRecoveryActions,
  type SessionRecoveryActions,
  type SessionRecoveryActionsDeps,
} from "./useSessionRecoveryActions";

vi.mock("../../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../../features/sessions/data/sessionStore")>()),
  saveWorkspaceSnapshot: vi.fn(),
  getSession: vi.fn(),
  isPrimaryWorkspaceWindow: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
vi.mock("../../../platform/tauri/listenWindow", () => ({ listenWindow: vi.fn(() => vi.fn()) }));

let root: Root;
let actions: SessionRecoveryActions;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(saveWorkspaceSnapshot).mockReset();
  vi.mocked(isPrimaryWorkspaceWindow).mockReturnValue(false);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  sessionsRef.current = [];
  setSessionRecovery(null);
  setRecoverySaveFailure(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function recoveryFor(...sessions: ReturnType<typeof newSession>[]) {
  const tabs = sessions.map((session) => newTab(session.id));
  return captureSessionRecovery(
    null,
    collectWorkspaceSnapshot(tabs, sessions, tabs[0].id, sessions[0].cwd, new Map()),
    100,
  )!;
}

async function mountActions(recovery: SessionRecovery) {
  setSessionRecovery(recovery);
  const deps: SessionRecoveryActionsDeps = {
    sessionRecovery: recovery,
    updateSessionRecovery: vi.fn(),
    setRecoveryOpen: vi.fn(),
    projectCwd: "/work",
    projectReturnRef: { current: new Map() },
    projectTerminals: [],
    lastDockSide: null,
    keepWorkspaceTab: () => true,
    lockSnapshot: { lockedProjectKeys: new Set(), lockedGroupIds: new Set() },
    tabsRef: { current: [] },
    activeTabIdRef: { current: "" },
  };
  function Harness() {
    actions = useSessionRecoveryActions(deps);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
}

it("keeps recovery entries relocked after a remove action was rendered", async () => {
  const session = newSession("codex", "/locked");
  await mountActions(recoveryFor(session));
  vi.spyOn(lockState, "isProjectLockedIn").mockReturnValue(true);
  await act(async () => actions.removeRecoveredSessions([session.id]));
  expect(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id)).toEqual([session.id]);
  expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
});

it.each(["remove", "clear"])(
  "%s retains recovery entries whose checkout relocks while their project stays unlocked",
  async (action) => {
    const session = { ...newSession("codex", "/project"), worktreeCwd: "/locked-checkout" };
    await mountActions(recoveryFor(session));
    vi.spyOn(lockState, "isProjectLockedIn").mockImplementation(
      (_lock, cwd) => cwd === "/locked-checkout",
    );
    await act(async () =>
      action === "remove"
        ? actions.removeRecoveredSessions([session.id])
        : actions.clearRecoveredSessions(),
    );
    expect(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id)).toEqual([session.id]);
    expect(saveWorkspaceSnapshot).not.toHaveBeenCalled();
  },
);

it("rechecks removal authority after an older journal write settles", async () => {
  const session = newSession("codex", "/locked");
  await mountActions(recoveryFor(session));
  const save = Promise.withResolvers<void>();
  vi.mocked(saveWorkspaceSnapshot).mockReturnValueOnce(save.promise);
  await act(async () => actions.closeRecovery());
  let removal!: Promise<void>;
  await act(async () => {
    removal = actions.removeRecoveredSessions([session.id]);
  });
  vi.spyOn(lockState, "isProjectLockedIn").mockReturnValue(true);
  await act(async () => {
    save.resolve();
    await removal;
  });
  expect(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id)).toEqual([session.id]);
  expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce();
});

it("serializes removals so a failed first removal cannot be saved by a second one", async () => {
  const a = newSession("codex", "/a");
  const b = newSession("codex", "/b");
  await mountActions(recoveryFor(a, b));
  const save = Promise.withResolvers<void>();
  vi.mocked(saveWorkspaceSnapshot).mockReturnValueOnce(save.promise);
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = actions.removeRecoveredSessions([a.id]);
    second = actions.removeRecoveredSessions([b.id]);
  });
  const failure = expect(first).rejects.toThrow("offline");
  expect(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id)).toEqual([b.id]);
  expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce();
  await act(async () => {
    save.reject(new Error("offline"));
    await failure;
    await second;
  });
  expect(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id)).toEqual([a.id]);
  expect(getSessionRecovery()!.resolvedIds).toContain(b.id);
  expect(getSessionRecovery()!.resolvedIds).not.toContain(a.id);
});

it("rolls back only the failed removal while retaining new captures and other resolutions", async () => {
  const a = newSession("codex", "/a");
  const b = newSession("codex", "/b");
  const c = newSession("codex", "/c");
  await mountActions(recoveryFor(a, b));
  const save = Promise.withResolvers<void>();
  vi.mocked(saveWorkspaceSnapshot).mockReturnValueOnce(save.promise);
  let removal!: Promise<void>;
  await act(async () => {
    removal = actions.removeRecoveredSessions([a.id]);
  });
  const failure = expect(removal).rejects.toThrow("offline");
  setSessionRecovery(
    removeRecoverySessions(
      captureSessionRecovery(getSessionRecovery(), recoveryFor(c).workspace)!,
      [b.id],
    ),
  );
  await act(async () => {
    save.reject(new Error("offline"));
    await failure;
  });
  expect(new Set(getSessionRecovery()!.workspace.sessions.map((stub) => stub.id))).toEqual(
    new Set([a.id, c.id]),
  );
  expect(getSessionRecovery()!.resolvedIds).toContain(b.id);
  expect(getSessionRecovery()!.resolvedIds).not.toContain(a.id);
});

it("does not resurrect a newer confirmed acknowledgment when an older removal fails", async () => {
  const a = newSession("codex", "/a");
  const b = newSession("codex", "/b");
  const before = recoveryFor(a, b);
  await mountActions(before);
  const save = Promise.withResolvers<void>();
  vi.mocked(saveWorkspaceSnapshot).mockReturnValueOnce(save.promise);
  let removal!: Promise<void>;
  await act(async () => {
    removal = actions.removeRecoveredSessions([a.id]);
  });
  const failure = expect(removal).rejects.toThrow("offline");
  setSessionRecovery(removeRecoverySessions(before, [a.id, b.id]));
  await act(async () => {
    save.reject(new Error("offline"));
    await failure;
  });
  expect(getSessionRecovery()!.workspace.sessions).toEqual([]);
  expect(getSessionRecovery()!.resolvedIds).toEqual(expect.arrayContaining([a.id, b.id]));
});

it("queues a retirement receipt and latest journal behind a pending dismissal save", async () => {
  vi.mocked(isPrimaryWorkspaceWindow).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ sessions: [], pending: false });
  const a = newSession("codex", "/a");
  const b = newSession("codex", "/b");
  await mountActions(recoveryFor(a));
  const save = Promise.withResolvers<void>();
  vi.mocked(saveWorkspaceSnapshot).mockReturnValueOnce(save.promise);
  await act(async () => actions.closeRecovery());
  vi.mocked(getSession).mockResolvedValue(b);
  vi.mocked(invoke).mockResolvedValue({
    sessions: [{ sessionId: b.id, cwd: b.cwd }],
    pending: false,
    receipt: "exact-retirement",
  });
  const notify = vi.mocked(listenWindow).mock.calls.at(-1)![1];
  await act(async () => notify({ event: "session-recovery-changed", id: 1, payload: null }));
  expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce();
  expect(getSessionRecovery()!.workspace.sessions.some((stub) => stub.id === b.id)).toBe(true);
  await act(async () => save.resolve());
  expect(saveWorkspaceSnapshot).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveWorkspaceSnapshot).mock.calls[1][1]).toBe("exact-retirement");
});

it("retains a failed exact receipt when a different retirement save succeeds", async () => {
  vi.mocked(isPrimaryWorkspaceWindow).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ sessions: [], pending: false });
  await mountActions(recoveryFor(newSession("codex", "/a")));
  const notify = vi.mocked(listenWindow).mock.calls.at(-1)![1];
  const first = newSession("codex", "/first");
  const second = newSession("codex", "/second");
  for (const [session, receipt] of [
    [first, "first-receipt"],
    [second, "second-receipt"],
  ] as const) {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(invoke).mockResolvedValue({
      sessions: [{ sessionId: session.id, cwd: session.cwd }],
      pending: false,
      receipt,
    });
    if (session === first)
      vi.mocked(saveWorkspaceSnapshot).mockRejectedValueOnce(new Error("offline"));
    await act(async () => notify({ event: "session-recovery-changed", id: 1, payload: null }));
  }
  expect(vi.mocked(saveWorkspaceSnapshot).mock.calls.map((call) => call[1])).toEqual([
    "first-receipt",
    "second-receipt",
  ]);
  expect(getRecoverySaveFailure()).not.toBeNull();
  await act(async () => getRecoverySaveFailure()!.retry());
  expect(vi.mocked(saveWorkspaceSnapshot).mock.calls[2][1]).toBe("first-receipt");
  expect(getRecoverySaveFailure()).toBeNull();
});

it("merges a page that retires after boot once and stops polling after native proof settles", async () => {
  vi.useFakeTimers();
  vi.mocked(isPrimaryWorkspaceWindow).mockReturnValue(true);
  const session = newSession("codex", "/retired");
  const tab = newTab(session.id);
  const candidates = { sessions: [{ sessionId: session.id, cwd: session.cwd }], pending: false };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke)
    .mockResolvedValue(candidates)
    .mockResolvedValueOnce({ sessions: [], pending: true });
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(saveWorkspaceSnapshot).mockResolvedValue(undefined);
  setSessionRecovery(null);
  const update = vi.fn();
  const open = vi.fn();
  const deps: SessionRecoveryActionsDeps = {
    sessionRecovery: null,
    updateSessionRecovery: update,
    setRecoveryOpen: open,
    projectCwd: session.cwd,
    projectReturnRef: { current: new Map() },
    projectTerminals: [],
    lastDockSide: null,
    keepWorkspaceTab: () => true,
    lockSnapshot: { lockedProjectKeys: new Set() } as SessionRecoveryActionsDeps["lockSnapshot"],
    tabsRef: { current: [tab] },
    activeTabIdRef: { current: tab.id },
  };
  function Harness() {
    useSessionRecoveryActions(deps);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  expect(update).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(update).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledWith(true);
  expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce();
  const reads = vi.mocked(invoke).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(vi.mocked(invoke).mock.calls).toHaveLength(reads);
  const notify = vi.mocked(listenWindow).mock.calls.at(-1)![1];
  await act(async () => notify({ event: "session-recovery-changed", id: 1, payload: null }));
  expect(update).toHaveBeenCalledOnce();
  expect(saveWorkspaceSnapshot).toHaveBeenCalledOnce();
});

it("closes immediately, retries the latest snapshot context, and retires retries on unmount", async () => {
  const session = newSession("codex", "/initial");
  const tab = newTab(session.id);
  sessionsRef.current = [session];
  const recovery = captureSessionRecovery(
    null,
    collectWorkspaceSnapshot([tab], [session], tab.id, "/initial", new Map()),
    100,
  )!;
  setSessionRecovery(recovery);
  const setRecoveryOpen = vi.fn();
  const deps: SessionRecoveryActionsDeps = {
    sessionRecovery: recovery,
    updateSessionRecovery: vi.fn(),
    setRecoveryOpen,
    projectCwd: "/initial",
    projectReturnRef: { current: new Map() },
    projectTerminals: [],
    lastDockSide: null,
    keepWorkspaceTab: () => true,
    lockSnapshot: { lockedProjectKeys: new Set() } as SessionRecoveryActionsDeps["lockSnapshot"],
    tabsRef: { current: [tab] },
    activeTabIdRef: { current: tab.id },
  };
  function Harness({ cwd }: { cwd: string }) {
    actions = useSessionRecoveryActions({ ...deps, projectCwd: cwd });
    return null;
  }
  vi.mocked(saveWorkspaceSnapshot).mockRejectedValueOnce(new Error("disk offline"));
  await act(async () => root.render(createElement(Harness, { cwd: "/initial" })));
  await act(async () => actions.closeRecovery());
  expect(setRecoveryOpen).toHaveBeenCalledWith(false);
  const retry = getRecoverySaveFailure()!.retry;
  await act(async () => root.render(createElement(Harness, { cwd: "/latest" })));
  vi.mocked(saveWorkspaceSnapshot).mockResolvedValueOnce(undefined);
  await act(async () => retry());
  expect(vi.mocked(saveWorkspaceSnapshot).mock.calls[1][0]).toMatchObject({
    projectCwd: "/latest",
  });
  expect(getRecoverySaveFailure()).toBeNull();

  vi.mocked(saveWorkspaceSnapshot).mockRejectedValueOnce(new Error("disk offline"));
  await act(async () => actions.closeRecovery());
  const staleRetry = getRecoverySaveFailure()!.retry;
  await act(async () => root.unmount());
  const writes = vi.mocked(saveWorkspaceSnapshot).mock.calls.length;
  await staleRetry();
  expect(vi.mocked(saveWorkspaceSnapshot).mock.calls).toHaveLength(writes);
  expect(getRecoverySaveFailure()).toBeNull();
});
