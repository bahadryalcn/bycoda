// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../features/workspace/model/workspaceSnapshot";
import {
  captureSessionRecovery,
  getSessionRecovery,
} from "../../features/workspace/model/sessionRecovery";
import * as store from "../../features/sessions/data/sessionStore";
import { invoke } from "@tauri-apps/api/core";
import { loadResumedWorkspace } from "./appLifecycle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../features/sessions/data/sessionStore")>()),
  loadWorkspaceSnapshot: vi.fn(),
  listInFlightSessions: vi.fn().mockResolvedValue([]),
  getSession: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("captures all restored projects before first paint and retains an earlier closed conversation", async () => {
  const chats = ["alpha", "beta"].map((id) => ({
    ...newSession("codex", `/${id}`),
    id,
    blocks: [{ id: `u-${id}`, role: "user" as const, text: "hello" }],
  }));
  const all = collectWorkspaceSnapshot(
    chats.map((s) => newTab(s.id)),
    chats,
    "tab",
    "/alpha",
    new Map(),
  );
  const earlier = captureSessionRecovery(null, all, 100)!;
  earlier.workspace.activeTabId = earlier.workspace.tabs[0].id;
  const current = collectWorkspaceSnapshot([newTab("beta")], [chats[1]], "tab", "/beta", new Map());
  vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue({
    ...current,
    sessionRecovery: earlier,
  });
  vi.mocked(store.getSession).mockImplementation(
    async (id) => chats.find((s) => s.id === id) ?? null,
  );
  const resumed = await loadResumedWorkspace();
  expect(resumed?.sessions.map((s) => s.id)).toEqual(["beta"]);
  expect(getSessionRecovery()?.workspace.sessions.map((s) => s.id)).toEqual(["alpha", "beta"]);
  const write = vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "workspace_set_snapshot")?.[1] as {
    snapshot: { sessionRecovery: unknown };
  };
  // Persisted recovery is normalized (for example, resolvedIds defaults to []).
  expect(write.snapshot.sessionRecovery).toMatchObject(earlier);
});
