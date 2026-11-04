import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { platformConfirm } from "../../shared/model/appConfirm";
import { registerClosingEditor } from "../../features/files/model/editorClose";
import { flushComposerDrafts } from "../../features/sessions/data/composerDraftStore";
import { forgetHarnessSession } from "../../integrations/harness/core/registry";
import { forgetWindowChildren, killAllChildren } from "../../integrations/harness/core/child";
import { newSession } from "../../features/sessions/model/session";
import { newTab, splitPane } from "../../features/workspace/model/layout";
import {
  askQuitConfirmation,
  closeBusyWindow,
  commitQuit,
  confirmReload,
  reapUnloadRuntime,
  handleQuitRequested as handleCurrentWorkspaceQuit,
  reportQuitPoll,
  setQuitWorkspace,
} from "./appLifecycle";
import type { DockSide } from "../../features/projects/model/projectTerminal";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "../../features/workspace/model/workspaceSnapshot";
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "../../features/sessions/data/sessionStore";
import { reconcileProjectReturn } from "../../features/projects/model/projectReturn";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((command: string) => nativeSuccess(command)),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

function nativeSuccess(command: string) {
  return Promise.resolve(
    command === "session_upsert" ? { harness: "cursor", updatedAt: 1 } : undefined,
  );
}
vi.mock("../../shared/model/appConfirm", () => ({
  platformConfirm: vi.fn().mockResolvedValue(true),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
  message: vi.fn().mockResolvedValue("Save"),
}));
vi.mock("./windowTransferBootstrap", () => ({
  loadWindowTransfer: vi.fn().mockResolvedValue(null),
}));
vi.mock("./sessionWindowOwnership", () => ({
  claimRestoredSession: vi.fn().mockResolvedValue(true),
  abortRestoredSession: vi.fn().mockResolvedValue(undefined),
  remoteSessionOwnershipKey: (cwd: string, id: string) => `remote:${cwd}:${id}`,
}));
vi.mock("../../features/sessions/data/sessionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/sessions/data/sessionStore")>();
  return {
    ...actual,
    loadWorkspaceSnapshot: vi.fn().mockResolvedValue(null),
    listInFlightSessions: vi.fn().mockResolvedValue([]),
    listSessionsByProject: vi.fn().mockResolvedValue([]),
    isPrimaryWorkspaceWindow: vi.fn().mockReturnValue(true),
    getSession: vi.fn().mockResolvedValue(null),
  };
});
vi.mock("../../integrations/harness/core/registry", () => ({
  bindHarnessSession: vi.fn(),
  isLiveHarness: vi.fn(),
  forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../integrations/harness/core/child", () => ({
  killAllChildren: vi.fn().mockResolvedValue(undefined),
  forgetWindowChildren: vi.fn(),
}));
vi.mock("../../features/sessions/data/composerDraftStore", async (original) => {
  const actual = await original<typeof import("../../features/sessions/data/composerDraftStore")>();
  return { ...actual, flushComposerDrafts: vi.fn(actual.flushComposerDrafts) };
});

describe("project choices through lifecycle saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(loadWorkspaceSnapshot).mockResolvedValue(null);
  });

  function workspace() {
    const sessions = ["a1", "a2", "b1", "b2"].map((id) => ({
      ...newSession("cursor", id.startsWith("a") ? "/alpha" : "/beta"),
      id,
    }));
    const tabs = sessions.map((session) => ({
      ...newTab(session.id),
      id: `tab-${session.id}`,
    }));
    const memory = new Map([
      ["/alpha", "a2"],
      ["/beta", "b2"],
    ]);
    return {
      sessions,
      tabs,
      memory,
      activeTabId: "tab-b2",
      projectCwd: "/beta",
    };
  }

  function lastSavedMemory() {
    const call = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "workspace_set_snapshot")
      .at(-1);
    const args = call?.[1];
    const snapshot =
      args && typeof args === "object" && "snapshot" in args
        ? parseWorkspaceSnapshot(args.snapshot)
        : null;
    expect(snapshot).not.toBeNull();
    return snapshot
      ? hydrateWorkspaceSnapshot(snapshot, new Map())?.projectReturnMemory
      : undefined;
  }

  it("keeps both project choices in the final quit save after autosave", async () => {
    const state = workspace();
    const { handleQuitRequested, setQuitWorkspace } = await import("./appLifecycle");
    await saveWorkspaceSnapshot(
      collectWorkspaceSnapshot(
        state.tabs,
        state.sessions,
        state.activeTabId,
        state.projectCwd,
        state.memory,
      ),
    );
    const release = setQuitWorkspace(
      () => state.sessions,
      () => state.tabs,
      () => state.activeTabId,
      () => state.projectCwd,
      () => [],
      () => state.memory,
      vi.fn(),
    );
    try {
      await handleQuitRequested();
      expect([...(lastSavedMemory() ?? [])]).toEqual([...state.memory]);
      expect(
        vi.mocked(invoke).mock.calls.filter(([command]) => command === "workspace_set_snapshot"),
      ).toHaveLength(2);
    } finally {
      release();
    }
  });

  it("reads committed selection from live getters before autosave", async () => {
    const state = workspace();
    const { handleQuitRequested, setQuitWorkspace } = await import("./appLifecycle");
    state.activeTabId = "tab-a1";
    state.projectCwd = "/alpha";
    const readMemory = () => reconcileProjectReturn(state);
    const release = setQuitWorkspace(
      () => state.sessions,
      () => state.tabs,
      () => state.activeTabId,
      () => state.projectCwd,
      () => [],
      readMemory,
      vi.fn(),
    );
    try {
      await handleQuitRequested();
      expect(lastSavedMemory()?.get("/alpha")).toBe("a1");
      expect(lastSavedMemory()?.get("/beta")).toBe("b2");
    } finally {
      release();
    }
  });

  it("preserves choices through unload persistence used by idle close", async () => {
    const state = workspace();
    const { persistQuitState } = await import("./appLifecycle");
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
      "unload",
    );
    expect([...(lastSavedMemory() ?? [])]).toEqual([...state.memory]);
  });

  it("preserves activity timestamps for both interrupted and idle quit snapshots", async () => {
    const state = workspace();
    for (const session of state.sessions)
      session.blocks = [{ id: `user-${session.id}`, role: "user", text: "hello" }];
    state.sessions[0].busy = true;
    const { persistQuitState } = await import("./appLifecycle");
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      state.memory,
    );
    const writes = vi.mocked(invoke).mock.calls.filter(([command]) => command === "session_upsert");
    expect(writes).toHaveLength(state.sessions.length);
    for (const [, args] of writes) expect(args).toMatchObject({ preserveActivityAt: true });
  });

  it("preserves choices when closing a busy window", async () => {
    const state = workspace();
    state.sessions[3].busy = true;
    const release = setQuitWorkspace(
      () => state.sessions,
      () => state.tabs,
      () => state.activeTabId,
      () => state.projectCwd,
      () => [],
      () => state.memory,
      vi.fn(),
    );
    try {
      await closeBusyWindow();
      expect([...(lastSavedMemory() ?? [])]).toEqual([...state.memory]);
      expect(invoke).toHaveBeenCalledWith("destroy_window");
    } finally {
      release();
    }
  });

  it("preserves resumed choices when quitting before App registers live getters", async () => {
    const state = workspace();
    state.sessions[0].worktreeCwd = "/alpha-worktrees/feature";
    vi.mocked(loadWorkspaceSnapshot).mockResolvedValue(
      collectWorkspaceSnapshot(
        state.tabs,
        state.sessions,
        state.activeTabId,
        state.projectCwd,
        state.memory,
      ),
    );
    const { handleQuitRequested } = await import("./appLifecycle");
    await handleQuitRequested();
    expect([...(lastSavedMemory() ?? [])]).toEqual([...state.memory]);
    const args = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "workspace_set_snapshot")
      .at(-1)?.[1];
    const saved =
      args && typeof args === "object" && "snapshot" in args
        ? parseWorkspaceSnapshot(args.snapshot)
        : null;
    expect(saved?.sessions.find((session) => session.id === "a1")?.worktreeCwd).toBe(
      "/alpha-worktrees/feature",
    );
  });
});

describe("closing a busy window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platformConfirm).mockResolvedValue(true);
  });

  function workspace() {
    const session = newSession("cursor", "C:/test");
    session.busy = true;
    session.blocks = [{ id: "user", role: "user", text: "test" }];
    const tab = newTab(session.id);
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      () => new Map(),
      vi.fn(),
    );
    return { session, release };
  }

  it("stops only its sessions and destroys only its window", async () => {
    const { session, release } = workspace();
    try {
      await closeBusyWindow();
      expect(platformConfirm).toHaveBeenCalled();
      expect(forgetHarnessSession).toHaveBeenCalledWith("cursor", session.id);
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("destroy_window");
      expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "confirm_quit")).toBe(
        false,
      );
    } finally {
      release();
    }
  });

  it("leaves the window and sessions running when closing is cancelled", async () => {
    const { release } = workspace();
    vi.mocked(platformConfirm).mockResolvedValue(false);
    try {
      await closeBusyWindow();
      expect(forgetHarnessSession).not.toHaveBeenCalled();
      expect(killAllChildren).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
});

describe("coordinated quit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(
        command === "session_upsert" ? { harness: "cursor", updatedAt: 1 } : undefined,
      ),
    );
  });

  function busyWorkspace() {
    const session = newSession("cursor", "C:/test");
    session.busy = true;
    session.blocks = [{ id: "user", role: "user", text: "test" }];
    const tab = newTab(session.id);
    return setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      () => new Map(),
      vi.fn(),
    );
  }

  function invokedWith(command: string) {
    return vi.mocked(invoke).mock.calls.find(([name]) => name === command)?.[1];
  }

  it("reports this window's live turns to the coordinator", async () => {
    const release = busyWorkspace();
    try {
      await reportQuitPoll(7);
      expect(invokedWith("quit_poll_reply")).toEqual({ id: 7, inFlight: 1 });
    } finally {
      release();
    }
  });

  it("counts a running Inbox Ask, which cannot be resumed", async () => {
    const session = newSession("cursor", "C:/test");
    session.busy = true;
    session.inboxAsk = true;
    const tab = newTab(session.id);
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      () => new Map(),
      vi.fn(),
    );
    try {
      await reportQuitPoll(1);
      expect(invokedWith("quit_poll_reply")).toEqual({ id: 1, inFlight: 1 });
    } finally {
      release();
    }
  });

  it("reports nothing from a window with no workspace yet", async () => {
    await reportQuitPoll(2);
    expect(invokedWith("quit_poll_reply")).toEqual({ id: 2, inFlight: 0 });
  });

  it("passes a declined dialog back as a refusal", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    await askQuitConfirmation(3, 2);
    expect(invokedWith("quit_decision")).toEqual({ id: 3, confirmed: false });
  });

  it("asks once using the count from every window", async () => {
    await askQuitConfirmation(4, 5);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ask).mock.calls[0]?.[0]).toContain("5");
    expect(invokedWith("quit_decision")).toEqual({ id: 4, confirmed: true });
  });

  it("tells the coordinator when a required quit write fails", async () => {
    const release = busyWorkspace();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "workspace_set_snapshot"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(
            command === "session_upsert" ? { harness: "cursor", updatedAt: 1 } : undefined,
          ),
    );
    try {
      await commitQuit(6);
      expect(invokedWith("quit_ready")).toEqual({ id: 6, persisted: false });
    } finally {
      vi.mocked(invoke).mockImplementation(nativeSuccess);
      release();
    }
  });

  it("refuses quit when a stale transcript write resolves without saving", async () => {
    const session = newSession("cursor", "C:/test");
    session.blocks = [{ id: "unique", role: "user", text: "Only in this renderer" }];
    const tab = newTab(session.id);
    const release = setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      () => new Map(),
      vi.fn(),
    );
    let finishWrite!: (value: null) => void;
    vi.mocked(invoke).mockImplementation((command) =>
      command === "session_upsert"
        ? new Promise<null>((resolve) => {
            finishWrite = resolve;
          })
        : Promise.resolve(undefined),
    );
    try {
      const quitting = commitQuit(10);
      await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
      expect(invokedWith("quit_ready")).toBeUndefined();
      finishWrite(null);
      await quitting;
      expect(invokedWith("quit_ready")).toEqual({ id: 10, persisted: false });
      expect(invokedWith("workspace_set_snapshot")).toBeUndefined();
      expect(message).toHaveBeenCalledWith(
        expect.stringContaining("The window remains open"),
        expect.objectContaining({ kind: "error" }),
      );
      expect(session.blocks).toEqual([
        { id: "unique", role: "user", text: "Only in this renderer" },
      ]);
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");
      expect(killAllChildren).not.toHaveBeenCalled();
      const { isAppQuitting } = await import("./appLifecycle");
      expect(isAppQuitting()).toBe(false);
    } finally {
      release();
    }
  });

  // The whole point of the handshake: no window exits on its own.
  it("persists and reports ready without exiting the app", async () => {
    const release = busyWorkspace();
    try {
      await commitQuit(9);
      expect(invokedWith("workspace_set_snapshot")).toBeDefined();
      expect(invokedWith("quit_ready")).toEqual({ id: 9, persisted: true });
      expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "confirm_quit")).toBe(
        false,
      );
    } finally {
      release();
    }
  });

  it("pauses commit watchdog only around close confirmation before saving", async () => {
    const release = busyWorkspace();
    const unregister = registerClosingEditor({
      path: "/dirty",
      dirty: () => true,
      settle: async () => {},
      save: async () => false,
    });
    vi.mocked(message).mockResolvedValueOnce("Discard");
    try {
      await commitQuit(88);
      const calls = vi.mocked(invoke).mock.calls;
      const open = calls.findIndex(
        ([name, args]) =>
          name === "quit_commit_dialog" && (args as { open?: boolean }).open === true,
      );
      const close = calls.findIndex(
        ([name, args]) =>
          name === "quit_commit_dialog" && (args as { open?: boolean }).open === false,
      );
      const save = calls.findIndex(([name]) => name === "session_upsert");
      expect(open).toBeGreaterThanOrEqual(0);
      expect(close).toBeGreaterThan(open);
      expect(save).toBeGreaterThan(close);
    } finally {
      unregister();
      release();
    }
  });

  it("aborts the native quit before showing a close failure", async () => {
    const release = busyWorkspace();
    const unregister = registerClosingEditor({
      path: "/dirty",
      dirty: () => true,
      settle: async () => {},
      save: async () => false,
    });
    let abortObserved = false;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "quit_commit_dialog" && (args as { open?: boolean }).open)
        return Promise.reject(new Error("offline"));
      if (command === "quit_ready") abortObserved = true;
      return Promise.resolve(undefined);
    });
    vi.mocked(message).mockImplementation(async () => {
      expect(abortObserved).toBe(true);
    });
    try {
      await commitQuit(89);
      expect(invokedWith("quit_ready")).toEqual({ id: 89, persisted: false });
      expect(message).toHaveBeenCalled();
    } finally {
      unregister();
      release();
    }
  });

  it("keeps the watchdog running while editor settlement is pending", async () => {
    const release = busyWorkspace();
    let settle!: () => void;
    const unregister = registerClosingEditor({
      path: "/pending",
      dirty: () => false,
      settle: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      save: async () => true,
    });
    try {
      const pending = commitQuit(90);
      await vi.waitFor(() => expect(settle).toBeTypeOf("function"));
      expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "quit_commit_dialog")).toBe(
        false,
      );
      settle();
      await pending;
      expect(invokedWith("quit_ready")).toEqual({ id: 90, persisted: true });
    } finally {
      unregister();
      release();
    }
  });
});

describe("confirming reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platformConfirm).mockResolvedValue(true);
  });

  it("reloads without prompting when files are clean", async () => {
    await expect(confirmReload(false)).resolves.toBe(true);
    expect(platformConfirm).not.toHaveBeenCalled();
  });

  it("allows reload after unsaved changes are confirmed", async () => {
    await expect(confirmReload(true)).resolves.toBe(true);
    expect(platformConfirm).toHaveBeenCalledWith({
      title: "Reload bycoda?",
      message: "Unsaved changes in open files will be discarded.",
      confirmLabel: "Reload",
      tone: "danger",
    });
  });

  it("cancels reload when unsaved changes are kept", async () => {
    vi.mocked(platformConfirm).mockResolvedValue(false);
    await expect(confirmReload(true)).resolves.toBe(false);
  });

  it("asks about running local chats, including when files are dirty", async () => {
    await expect(confirmReload(false, true)).resolves.toBe(true);
    expect(platformConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Running chats will be interrupted." }),
    );
    vi.mocked(platformConfirm).mockResolvedValue(false);
    await expect(confirmReload(true, true)).resolves.toBe(false);
    expect(platformConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message:
          "Running chats will be interrupted and unsaved changes in open files will be discarded.",
      }),
    );
  });

  it("unload clears page routes without stopping global or Host children", async () => {
    await reapUnloadRuntime([newSession("cursor", "/repo")]);
    expect(forgetWindowChildren).toHaveBeenCalledOnce();
    expect(killAllChildren).not.toHaveBeenCalled();
    expect(forgetHarnessSession).not.toHaveBeenCalled();
  });
});

describe("remembering the terminal dock side across restarts", () => {
  // The lifecycle caches its boot resume in module state, and the suites
  // above have already consumed it � reset for a clean quit/restore cycle.
  beforeEach(() => {
    vi.resetModules();
  });

  function dockWorkspace(side: DockSide | null) {
    const sessions = ["a1"].map((id) => ({
      ...newSession("cursor", "/alpha"),
      id,
    }));
    const tabs = sessions.map((session) => ({
      ...newTab(session.id),
      id: `tab-${session.id}`,
    }));
    return {
      sessions,
      tabs,
      activeTabId: "tab-a1",
      projectCwd: "/alpha",
      side,
    };
  }

  async function lastSavedDockSide(): Promise<DockSide | undefined | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    const call = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "workspace_set_snapshot")
      .at(-1);
    const args = call?.[1];
    const snapshot =
      args && typeof args === "object" && "snapshot" in args
        ? parseWorkspaceSnapshot(args.snapshot)
        : null;
    expect(snapshot).not.toBeNull();
    return snapshot?.lastDockSide;
  }

  it("saves the chosen side on a coordinated quit", async () => {
    const state = dockWorkspace("right");
    const { handleQuitRequested, setQuitWorkspace } = await import("./appLifecycle");
    const release = setQuitWorkspace(
      () => state.sessions,
      () => state.tabs,
      () => state.activeTabId,
      () => state.projectCwd,
      () => [],
      () => new Map(),
      vi.fn(),
      () => state.side,
    );
    try {
      await handleQuitRequested();
      expect(await lastSavedDockSide()).toBe("right");
    } finally {
      release();
    }
  });

  it("saves the side through unload persistence used by reload and tray close", async () => {
    const state = dockWorkspace("left");
    const { persistQuitState } = await import("./appLifecycle");
    await persistQuitState(
      state.sessions,
      state.tabs,
      state.activeTabId,
      state.projectCwd,
      new Map(),
      "unload",
      [],
      "left",
    );
    expect(await lastSavedDockSide()).toBe("left");
  });

  it("keeps the restored side when quitting before App registers live getters", async () => {
    const state = dockWorkspace("left");
    const store = await import("../../features/sessions/data/sessionStore");
    vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue(
      collectWorkspaceSnapshot(
        state.tabs,
        state.sessions,
        state.activeTabId,
        state.projectCwd,
        new Map(),
        [],
        "left",
      ),
    );
    const { handleQuitRequested } = await import("./appLifecycle");
    await handleQuitRequested();
    expect(await lastSavedDockSide()).toBe("left");
  });
});

it("paints transferred tabs without waiting for sidebar history", async () => {
  vi.resetModules();
  const { loadWindowTransfer } = await import("./windowTransferBootstrap");
  const { listSessionsByProject } = await import("../../features/sessions/data/sessionStore");
  const { loadBootWorkspace } = await import("./appLifecycle");
  const session = newSession("cursor", "/transferred");
  const tab = newTab(session.id);
  const payload = {
    tabs: [tab],
    sessions: [session],
    activeTabId: tab.id,
    projectCwd: session.cwd,
    dirtyFileIds: [],
  };
  vi.mocked(loadWindowTransfer).mockResolvedValueOnce(payload);
  vi.mocked(listSessionsByProject).mockClear();
  expect(await loadBootWorkspace()).toMatchObject({
    windowTransfer: payload,
    resumed: null,
    history: [],
    historyCwd: null,
  });
  expect(listSessionsByProject).not.toHaveBeenCalled();
});

it("boots secondary windows blank without reading the shared recovery snapshot", async () => {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  vi.mocked(store.isPrimaryWorkspaceWindow).mockReturnValueOnce(false);
  vi.mocked(store.loadWorkspaceSnapshot).mockClear();
  const { loadBootWorkspace } = await import("./appLifecycle");
  expect(await loadBootWorkspace()).toEqual({
    windowTransfer: null,
    resumed: null,
    history: [],
    historyCwd: null,
  });
  expect(store.loadWorkspaceSnapshot).not.toHaveBeenCalled();
});

it("bounds durable recovery scans to one active session at a time", async () => {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  const shellState = await import("../../features/connections/model/remoteShellState");
  const sessions = ["first", "second", "third"].map((id) => ({
    ...newSession("cursor", "/repo"),
    id,
  }));
  const tabs = sessions.map((session) => newTab(session.id));
  const snapshot = collectWorkspaceSnapshot(tabs, sessions, tabs[0].id, "/repo", new Map());
  vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue({
    ...snapshot,
    sessionRecovery: { capturedAt: 1, dismissed: false, workspace: snapshot },
  });
  let active = 0;
  let maximum = 0;
  const read = vi.spyOn(shellState, "remoteShellState").mockImplementation(async () => {
    maximum = Math.max(maximum, ++active);
    await Promise.resolve();
    active--;
    return { bound: true, pending: false, hasDraft: false };
  });
  try {
    const { loadResumedWorkspace } = await import("./appLifecycle");
    await loadResumedWorkspace();
    expect(read).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(1);
  } finally {
    read.mockRestore();
  }
});

it("restores only sessions whose native window ownership is confirmed", async () => {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  const ownership = await import("./sessionWindowOwnership");
  const first = { ...newSession("cursor", "/repo"), id: "first" };
  const second = { ...newSession("cursor", "/repo"), id: "second" };
  const base = newTab(first.id);
  const tabs = [
    {
      ...base,
      layout: splitPane(base.layout, first.id, "right", "editor"),
      editorPanes: [
        {
          id: "editor",
          files: [{ id: "file", path: "/repo/a.txt", cwd: "/repo" }],
          activeFileId: "file",
        },
      ],
    },
    newTab(second.id),
  ];
  vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue(
    collectWorkspaceSnapshot(tabs, [first, second], tabs[0].id, "/repo", new Map()),
  );
  vi.mocked(ownership.claimRestoredSession).mockImplementation(async (id) => id !== "first");
  const { loadResumedWorkspace } = await import("./appLifecycle");
  const restored = await loadResumedWorkspace();
  expect(restored?.sessions.map((session) => session.id)).toEqual(["second"]);
  expect(restored?.tabs).toHaveLength(2);
  expect(restored?.tabs[0].editorPanes[0].files[0].path).toBe("/repo/a.txt");
  expect(ownership.claimRestoredSession).toHaveBeenCalledTimes(2);
});

it("keeps saved workspace protected when a boot ownership read fails", async () => {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  const ownership = await import("./sessionWindowOwnership");
  const session = { ...newSession("cursor", "/repo"), id: "unknown" };
  const tab = newTab(session.id);
  vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue(
    collectWorkspaceSnapshot([tab], [session], tab.id, "/repo", new Map()),
  );
  vi.mocked(ownership.claimRestoredSession).mockRejectedValueOnce(new Error("offline"));
  const lifecycle = await import("./appLifecycle");
  expect(await lifecycle.loadResumedWorkspace()).toBeNull();
  expect(lifecycle.workspaceSnapshotWriteBlocked()).toBe(true);
});

it("does not restore a remote shell whose Host session is owned elsewhere", async () => {
  vi.resetModules();
  const store = await import("../../features/sessions/data/sessionStore");
  const ownership = await import("./sessionWindowOwnership");
  const session = { ...newSession("cursor", "/repo"), id: "remote-shell" };
  const tab = newTab(session.id);
  const snapshot = collectWorkspaceSnapshot([tab], [session], tab.id, "/repo", new Map());
  snapshot.sessions[0] = {
    ...snapshot.sessions[0],
    cwd: "remote://machine/repo",
    remoteSessionId: "host-session",
  };
  vi.mocked(store.loadWorkspaceSnapshot).mockResolvedValue(snapshot);
  vi.mocked(ownership.claimRestoredSession).mockImplementation(
    async (id) => !id.startsWith("remote:"),
  );
  vi.mocked(ownership.abortRestoredSession).mockClear();
  const { loadResumedWorkspace } = await import("./appLifecycle");
  expect(await loadResumedWorkspace()).toBeNull();
  expect(ownership.claimRestoredSession).toHaveBeenCalledWith(
    "remote:remote://machine/repo:host-session",
  );
  expect(ownership.abortRestoredSession).toHaveBeenCalledWith("remote-shell");
});

describe("destructive window close safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platformConfirm).mockResolvedValue(true);
    vi.mocked(invoke).mockImplementation(nativeSuccess);
  });
  function workspace(options: { inboxAsk?: boolean; busy?: boolean; terminal?: boolean } = {}) {
    const session = newSession("cursor", "C:/safeguards");
    session.blocks = [{ id: "question", role: "user", text: "work" }];
    session.busy = !!options.busy;
    session.inboxAsk = options.inboxAsk;
    const tab = newTab(session.id);
    if (options.terminal)
      tab.terminalPanes = [
        {
          id: "term-pane",
          activeFileId: "term",
          files: [{ id: "term", path: "Terminal", cwd: session.cwd, terminal: true }],
        },
      ];
    return setQuitWorkspace(
      () => [session],
      () => [tab],
      () => tab.id,
      () => session.cwd,
      () => [],
      () => new Map(),
      vi.fn(),
    );
  }
  it.each([true, false])("confirms non-resumable busy work (Inbox Ask: %s)", async (inboxAsk) => {
    const release = workspace({ busy: true, inboxAsk });
    vi.mocked(platformConfirm).mockResolvedValue(false);
    try {
      await closeBusyWindow();
      expect(platformConfirm).toHaveBeenCalledOnce();
      expect(invoke).not.toHaveBeenCalledWith("destroy_window");
      expect(forgetHarnessSession).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it.each(["session_upsert", "workspace_set_snapshot", "composer"])(
    "keeps the window open after %s failure and closes once on retry",
    async (command) => {
      const release = workspace();
      if (command === "composer")
        vi.mocked(flushComposerDrafts).mockRejectedValueOnce(new Error("disk full"));
      else
        vi.mocked(invoke).mockImplementationOnce((name) =>
          name === command ? Promise.reject(new Error("disk full")) : nativeSuccess(name),
        );
      // The workspace snapshot is written after the session write.
      if (command === "workspace_set_snapshot")
        vi.mocked(invoke).mockImplementation((name) =>
          name === command ? Promise.reject(new Error("disk full")) : nativeSuccess(name),
        );
      try {
        await closeBusyWindow();
        expect(invoke).not.toHaveBeenCalledWith("destroy_window");
        expect(message).toHaveBeenCalledWith(
          expect.stringContaining("Retry closing"),
          expect.objectContaining({ kind: "error" }),
        );
        vi.mocked(invoke).mockImplementation(nativeSuccess);
        await closeBusyWindow();
        expect(
          vi.mocked(invoke).mock.calls.filter(([name]) => name === "destroy_window"),
        ).toHaveLength(1);
      } finally {
        release();
      }
    },
  );
  it.each(["npm", null, "unknown"])(
    "protects terminal process %s during close and quit",
    async (foreground) => {
      const release = workspace({ terminal: true });
      vi.mocked(invoke).mockImplementation((name) =>
        name === "pty_status"
          ? Promise.resolve(
              foreground === "unknown"
                ? { foreground: null, supported: false }
                : { foreground, supported: true },
            )
          : nativeSuccess(name),
      );
      vi.mocked(platformConfirm).mockResolvedValue(false);
      try {
        await closeBusyWindow();
        if (foreground === null) {
          expect(platformConfirm).not.toHaveBeenCalled();
          expect(invoke).toHaveBeenCalledWith("destroy_window");
        } else {
          expect(platformConfirm).toHaveBeenCalledOnce();
          expect(invoke).not.toHaveBeenCalledWith("destroy_window");
          expect(await handleCurrentWorkspaceQuit()).toBe(false);
          expect(invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
        }
      } finally {
        release();
      }
    },
  );
});
