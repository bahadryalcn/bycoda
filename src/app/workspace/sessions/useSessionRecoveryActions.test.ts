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
  getRecoverySaveFailure,
  setRecoverySaveFailure,
  setSessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
