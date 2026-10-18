import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  label: "main",
  fail: false,
  raw: {
    tabs: [],
    sessions: [],
    activeTabId: "",
    projectCwd: "~",
    serversRestore: {
      version: 1,
      enabled: true,
      tabs: [{ tabId: "ui-previous", serverId: "canonical-server", input: "never-replay" }],
    },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: fixture.label }) }));
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<typeof import("../../features/sessions/data/sessionStore")>()),
  loadWorkspaceSnapshot: async () => {
    if (fixture.fail) throw new Error("fixture read failed");
    return fixture.raw;
  },
  listInFlightSessions: async () => [],
}));

beforeEach(() => {
  vi.resetModules();
  fixture.label = "main";
  fixture.fail = false;
});

it("loads reference previews even when no conversation workspace can be restored", async () => {
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const { serverTerminalRestoreState } =
    await import("../../features/connections/model/serverTerminalRestoreState");
  expect(await loadResumedWorkspace()).toBeNull();
  const state = serverTerminalRestoreState.getSnapshot();
  expect(state).toMatchObject({ owner: true, initialized: true, pending: ["ui-previous"] });
  expect(state.restore?.tabs).toEqual([{ tabId: "ui-previous", serverId: "canonical-server" }]);
  expect(JSON.stringify(state)).not.toContain("never-replay");
});

it("failed primary reads leave restore uninitialized so a later save cannot opt out implicitly", async () => {
  fixture.fail = true;
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const { serverTerminalRestoreState } =
    await import("../../features/connections/model/serverTerminalRestoreState");
  const { collectWorkspaceSnapshot } =
    await import("../../features/workspace/model/workspaceSnapshot");
  await loadResumedWorkspace();
  expect(serverTerminalRestoreState.getSnapshot()).toMatchObject({
    owner: true,
    initialized: false,
    loadFailed: true,
  });
  const snapshot = collectWorkspaceSnapshot([], [], "", "~", new Map());
  expect(Object.hasOwn(snapshot, "serversRestore")).toBe(false);
});

it("secondary windows cannot take ownership of the primary restore metadata", async () => {
  fixture.label = "detached-project";
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const { serverTerminalRestoreState } =
    await import("../../features/connections/model/serverTerminalRestoreState");
  await loadResumedWorkspace();
  expect(serverTerminalRestoreState.getSnapshot()).toMatchObject({
    owner: false,
    initialized: false,
  });
});
