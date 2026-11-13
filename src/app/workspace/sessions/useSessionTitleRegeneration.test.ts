// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import type { SessionRenameDeps } from "./useSessionRename";
import { useSessionTitleRegeneration } from "./useSessionTitleRegeneration";
import { TitleRegenerationConflictError } from "../../../features/sessions/model/regenerateSessionTitle";

const mocks = vi.hoisted(() => ({
  regenerate: vi.fn(),
  locked: vi.fn(),
  choice: vi.fn(),
  refreshRemote: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../../features/sessions/model/regenerateSessionTitle", () => ({
  regenerateSessionTitle: mocks.regenerate,
  TitleRegenerationConflictError: class TitleRegenerationConflictError extends Error {},
}));
vi.mock("../../../features/connections/model/connections", () => ({
  loadRemoteSession: vi.fn(),
  remoteMachineFor: vi.fn(),
  remoteSessionFor: vi.fn(),
  refreshRemoteProjectSessions: mocks.refreshRemote,
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({ getSession: mocks.read }));
vi.mock("../../../features/sessions/model/titlePreferences", () => ({
  resolveTitleGenerationChoice: mocks.choice,
}));
vi.mock("../../../features/group-lock/model/groupLock", () => ({ isProjectLocked: mocks.locked }));

let root: Root;
let deps: SessionRenameDeps;
let action: ReturnType<typeof useSessionTitleRegeneration>;
const session = { ...newSession("claude", "/repo"), id: "s", title: "Original" };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.locked.mockReturnValue(false);
  mocks.choice.mockReturnValue({ harness: "claude", model: "haiku" });
  mocks.regenerate.mockResolvedValue({ ...session, title: "Generated" });
  deps = {
    sessionsRef: { current: [session] },
    setSessions: (update) => {
      deps.sessionsRef.current =
        typeof update === "function" ? update(deps.sessionsRef.current) : update;
    },
    loadedSessionCache: { current: new Map([[session.id, session]]) },
    lastPersisted: { current: new Map([[session.id, "old"]]) },
    invalidateLoadedSession: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/repo",
  };
  function Harness() {
    action = useSessionTitleRegeneration(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("publishes persisted title while preserving concurrent execution state", async () => {
  mocks.regenerate.mockImplementation(async () => {
    deps.sessionsRef.current = [{ ...session, busy: true, activity: "New activity" }];
    return { ...session, title: "Generated" };
  });
  await action.onRegenerateHistorySessionTitle("s", "/repo");
  expect(deps.sessionsRef.current[0]).toMatchObject({
    title: "Generated",
    busy: true,
    activity: "New activity",
  });
  expect(deps.loadedSessionCache.current.has("s")).toBe(false);
  expect(deps.refreshHistory).toHaveBeenCalledWith("/repo");
});

it("retains operation identity after an uncertain response and leaves title unchanged", async () => {
  mocks.regenerate.mockRejectedValueOnce(new Error("RPC_TIMEOUT"));
  await expect(action.onRegenerateHistorySessionTitle("s")).rejects.toThrow("RPC_TIMEOUT");
  expect(deps.sessionsRef.current[0].title).toBe("Original");
  await action.onRegenerateHistorySessionTitle("s");
  expect(mocks.regenerate.mock.calls[0][2].commandId).toBe(
    mocks.regenerate.mock.calls[1][2].commandId,
  );
});

it("starts a fresh operation only after a proven conflict and explicit retry", async () => {
  mocks.regenerate.mockRejectedValueOnce(
    new TitleRegenerationConflictError("Conversation title changed. Try again."),
  );
  await expect(action.onRegenerateHistorySessionTitle("s")).rejects.toThrow(
    "Conversation title changed",
  );
  deps.sessionsRef.current = [{ ...session, title: "Manual" }];
  await action.onRegenerateHistorySessionTitle("s");
  expect(mocks.regenerate.mock.calls[0][2].commandId).not.toBe(
    mocks.regenerate.mock.calls[1][2].commandId,
  );
  expect(mocks.regenerate.mock.calls[1][0].title).toBe("Manual");
});

it("blocks locked projects and missing low-cost defaults before generation", async () => {
  mocks.locked.mockReturnValue(true);
  await expect(action.onRegenerateHistorySessionTitle("s")).rejects.toThrow();
  mocks.locked.mockReturnValue(false);
  mocks.choice.mockReturnValue(undefined);
  await expect(action.onRegenerateHistorySessionTitle("s")).rejects.toThrow(
    "Choose a title generation model in Settings.",
  );
  expect(mocks.regenerate).not.toHaveBeenCalled();
});

it("does not overwrite a manual rename that finishes during generation", async () => {
  mocks.regenerate.mockImplementation(async () => {
    deps.sessionsRef.current = [{ ...session, title: "Manual" }];
    return { ...session, title: "Generated" };
  });
  await action.onRegenerateHistorySessionTitle("s");
  expect(deps.sessionsRef.current[0].title).toBe("Manual");
});
