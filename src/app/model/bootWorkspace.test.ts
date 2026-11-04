import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
vi.mock("./sessionWindowOwnership", () => ({
  claimRestoredSession: vi.fn().mockResolvedValue(true),
  abortRestoredSession: vi.fn().mockResolvedValue(undefined),
  remoteSessionOwnershipKey: (cwd: string, id: string) => `remote:${cwd}:${id}`,
}));

const store = vi.hoisted(() => ({
  loadWorkspaceSnapshot: vi.fn(),
  listInFlightSessions: vi.fn(),
  listDeletedSessionIds: vi.fn(),
  isSessionDeleted: vi.fn(),
  getSession: vi.fn(),
  upsertSession: vi.fn(),
  upsertSessionPreservingActivity: vi.fn(),
}));
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../features/sessions/data/sessionStore")>()),
  ...store,
}));
vi.mock("../../integrations/harness/core/registry", () => ({}));
vi.mock("../../integrations/harness/core/child", () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  store.listInFlightSessions.mockResolvedValue([]);
  store.listDeletedSessionIds.mockResolvedValue([]);
  store.isSessionDeleted.mockReturnValue(false);
  store.upsertSession.mockResolvedValue(null);
  store.upsertSessionPreservingActivity.mockResolvedValue({ id: "stored" });
});

function savedWorkspace() {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    ...newSession("codex", "/repo"),
    id: `session-${index}`,
    blocks: [{ id: `user-${index}`, role: "user" as const, text: "Hello" }],
  }));
  const tabs = sessions.map((session) => newTab(session.id));
  store.loadWorkspaceSnapshot.mockResolvedValue(
    collectWorkspaceSnapshot(tabs, sessions, tabs[0].id, "/repo", new Map()),
  );
  store.getSession.mockImplementation(
    async (id: string) => sessions.find((session) => session.id === id) ?? null,
  );
  return sessions;
}

it("restores ten idle tabs without rewriting their transcripts before first paint", async () => {
  const sessions = savedWorkspace();
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions.map((session) => session.id)).toEqual(
    sessions.map((session) => session.id),
  );
  expect(restored?.tabs).toHaveLength(10);
  expect(store.upsertSession).not.toHaveBeenCalled();
  expect(store.upsertSessionPreservingActivity).not.toHaveBeenCalled();
});

it("drops deleted active and inactive chats before rebuilding saved layout or recovery", async () => {
  const sessions = savedWorkspace();
  const deleted = [sessions[0].id, sessions[7].id];
  store.listDeletedSessionIds.mockResolvedValue(deleted);
  store.listInFlightSessions.mockResolvedValue(
    deleted.map((sessionId) => ({ sessionId, cwd: "/repo" })),
  );
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions.map((session) => session.id)).toEqual(
    sessions.filter((session) => !deleted.includes(session.id)).map((session) => session.id),
  );
  expect(restored?.tabs).toHaveLength(8);
  expect(store.getSession).not.toHaveBeenCalled();
  expect(store.upsertSessionPreservingActivity).not.toHaveBeenCalled();
  const { getSessionRecovery } = await import("../../features/workspace/model/sessionRecovery");
  expect(getSessionRecovery()).toBeNull();
});

it("keeps saved layout protected when deletion status cannot be verified", async () => {
  savedWorkspace();
  store.listDeletedSessionIds.mockRejectedValue(new Error("database unavailable"));
  const { loadResumedWorkspace, workspaceSnapshotWriteBlocked } = await import("./appLifecycle");
  expect(await loadResumedWorkspace()).toBeNull();
  expect(workspaceSnapshotWriteBlocked()).toBe(true);
  expect(store.getSession).not.toHaveBeenCalled();
  expect(store.upsertSessionPreservingActivity).not.toHaveBeenCalled();
});

it("does not rebuild a deleted shell when deletion is confirmed during active hydration", async () => {
  const sessions = savedWorkspace();
  store.getSession.mockResolvedValue(null);
  store.isSessionDeleted.mockImplementation((id: string) => id === sessions[0].id);
  store.listInFlightSessions.mockResolvedValue([{ sessionId: sessions[0].id, cwd: "/repo" }]);
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions.map((session) => session.id)).not.toContain(sessions[0].id);
  expect(restored?.tabs).toHaveLength(9);
  expect(store.upsertSessionPreservingActivity).not.toHaveBeenCalled();
});

it("still persists the interruption marker for a recovered running turn", async () => {
  const sessions = savedWorkspace();
  store.listInFlightSessions.mockResolvedValue([{ sessionId: sessions[0].id, cwd: "/repo" }]);
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(store.upsertSessionPreservingActivity).toHaveBeenCalledTimes(1);
  expect(store.upsertSessionPreservingActivity).toHaveBeenCalledWith(restored?.sessions[0]);
  expect(store.upsertSession).not.toHaveBeenCalled();
  expect(restored?.sessions[0].blocks.at(-1)?.notice).toBe("interrupt");
});

it("opens the active tail before reading inactive tabs, then hydrates them after mount", async () => {
  const sessions = savedWorkspace();
  let release!: (session: (typeof sessions)[number]) => void;
  const held = new Promise<(typeof sessions)[number]>((resolve) => {
    release = resolve;
  });
  store.getSession.mockImplementation((id: string) =>
    id === sessions[1].id
      ? held
      : Promise.resolve(sessions.find((session) => session.id === id) ?? null),
  );
  const lifecycle = await import("./appLifecycle");
  const restored = (await lifecycle.loadResumedWorkspace())!;
  expect(store.getSession.mock.calls.map(([id]) => id)).toEqual([sessions[0].id]);
  expect(store.getSession.mock.calls[0][1]).toMatchObject({ onHydrated: expect.any(Function) });
  expect(restored.sessions[1].historyLoading).toBe(true);
  const state = await import("../../features/sessions/model/sessionsStore");
  state.resetSessionsStore(restored.sessions);
  const detach = lifecycle.setQuitWorkspace(
    state.getSessions,
    () => restored.tabs,
    () => restored.activeTabId,
    () => restored.projectCwd,
    () => [],
    () => new Map(),
    vi.fn(),
  );
  try {
    expect(store.getSession.mock.calls.map(([id]) => id)).toContain(sessions[1].id);
    release(sessions[1]);
    await vi.waitFor(() =>
      expect(state.getSessions().find((session) => session.id === sessions[1].id)?.blocks).toBe(
        sessions[1].blocks,
      ),
    );
    expect(
      state.getSessions().find((session) => session.id === sessions[1].id)?.historyLoading,
    ).not.toBe(true);
  } finally {
    release(sessions[1]);
    detach();
  }
});

it("does not overwrite a session edited while deferred boot IO is pending", async () => {
  const sessions = savedWorkspace();
  let release!: (session: (typeof sessions)[number]) => void;
  const held = new Promise<(typeof sessions)[number]>((resolve) => {
    release = resolve;
  });
  store.getSession.mockImplementation((id: string) =>
    id === sessions[1].id
      ? held
      : Promise.resolve(sessions.find((session) => session.id === id) ?? null),
  );
  const lifecycle = await import("./appLifecycle");
  const restored = (await lifecycle.loadResumedWorkspace())!;
  const state = await import("../../features/sessions/model/sessionsStore");
  state.resetSessionsStore(restored.sessions);
  const detach = lifecycle.setQuitWorkspace(
    state.getSessions,
    () => restored.tabs,
    () => restored.activeTabId,
    () => restored.projectCwd,
    () => [],
    () => new Map(),
    vi.fn(),
  );
  const changed = [{ id: "new", role: "user" as const, text: "New state" }];
  state.setSessions((values) =>
    values.map((session) =>
      session.id === sessions[1].id ? { ...session, blocks: changed } : session,
    ),
  );
  try {
    release(sessions[1]);
    await vi.waitFor(() => expect(store.getSession).toHaveBeenCalledTimes(10));
    expect(state.getSessions().find((session) => session.id === sessions[1].id)?.blocks).toBe(
      changed,
    );
  } finally {
    release(sessions[1]);
    detach();
  }
});

it("defers an interrupted inactive tab while keeping it blocked until recovery is durable", async () => {
  const sessions = savedWorkspace();
  let acknowledge!: () => void;
  store.upsertSessionPreservingActivity.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  store.listInFlightSessions.mockResolvedValue([{ sessionId: sessions[1].id, cwd: "/repo" }]);
  let release!: (session: (typeof sessions)[number]) => void;
  const held = new Promise<(typeof sessions)[number]>((resolve) => {
    release = resolve;
  });
  store.getSession.mockImplementation((id: string) =>
    id === sessions[1].id
      ? held
      : Promise.resolve(sessions.find((session) => session.id === id) ?? null),
  );
  const lifecycle = await import("./appLifecycle");
  const restored = (await lifecycle.loadResumedWorkspace())!;
  expect(store.getSession.mock.calls.map(([id]) => id)).not.toContain(sessions[1].id);
  expect(restored.sessions.find((session) => session.id === sessions[1].id)?.historyLoading).toBe(
    true,
  );
  const state = await import("../../features/sessions/model/sessionsStore");
  state.resetSessionsStore(restored.sessions);
  const detach = lifecycle.setQuitWorkspace(
    state.getSessions,
    () => restored.tabs,
    () => restored.activeTabId,
    () => restored.projectCwd,
    () => [],
    () => new Map(),
    vi.fn(),
  );
  try {
    release(sessions[1]);
    await vi.waitFor(() => expect(store.upsertSessionPreservingActivity).toHaveBeenCalledTimes(1));
    expect(
      state.getSessions().find((session) => session.id === sessions[1].id)?.historyLoading,
    ).toBe(true);
    expect(store.upsertSession).not.toHaveBeenCalled();
    acknowledge();
    await vi.waitFor(() =>
      expect(
        state.getSessions().find((session) => session.id === sessions[1].id)?.historyLoading,
      ).not.toBe(true),
    );
  } finally {
    acknowledge?.();
    release(sessions[1]);
    detach();
  }
});
