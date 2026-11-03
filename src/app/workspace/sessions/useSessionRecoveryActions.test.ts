// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { saveWorkspaceSnapshot } from "../../../features/sessions/data/sessionStore";
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
}));

let root: Root;
let actions: SessionRecoveryActions;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(saveWorkspaceSnapshot).mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  sessionsRef.current = [];
  setSessionRecovery(null);
  setRecoverySaveFailure(null);
  vi.unstubAllGlobals();
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
