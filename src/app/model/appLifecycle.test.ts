import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { flushComposerDrafts } from "../../features/sessions/data/composerDraftStore";
import { forgetHarnessSession } from "../../integrations/harness/core/registry";
import { killAllChildren } from "../../integrations/harness/core/child";
import { newSession } from "../../features/sessions/model/session";
import { newTab } from "../../features/workspace/model/layout";
import {
  askQuitConfirmation,
  closeBusyWindow,
  commitQuit,
  confirmReload,
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

function nativeSuccess(command: string) {
  return Promise.resolve(
    command === "session_upsert" ? { harness: "cursor", updatedAt: 1 } : undefined,
  );
}
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
  message: vi.fn().mockResolvedValue("Save"),
}));
vi.mock("./windowTransferBootstrap", () => ({
  loadWindowTransfer: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../features/sessions/data/sessionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/sessions/data/sessionStore")>();
  return {
    ...actual,
    loadWorkspaceSnapshot: vi.fn().mockResolvedValue(null),
    listInFlightSessions: vi.fn().mockResolvedValue([]),
    listSessionsByProject: vi.fn().mockResolvedValue([]),
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
    vi.mocked(ask).mockResolvedValue(true);
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
      expect(ask).toHaveBeenCalled();
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
    vi.mocked(ask).mockResolvedValue(false);
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
});

describe("confirming reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
  });

  it("reloads without prompting when files are clean", async () => {
    await expect(confirmReload(false)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("allows reload after unsaved changes are confirmed", async () => {
    await expect(confirmReload(true)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledWith("Reload bycoda and discard unsaved changes?", {
      title: "bycoda",
      kind: "warning",
      okLabel: "Reload",
    });
  });

  it("cancels reload when unsaved changes are kept", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    await expect(confirmReload(true)).resolves.toBe(false);
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

describe("destructive window close safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ask).mockResolvedValue(true);
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
    vi.mocked(ask).mockResolvedValue(false);
    try {
      await closeBusyWindow();
      expect(ask).toHaveBeenCalledOnce();
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
      vi.mocked(ask).mockResolvedValue(false);
      try {
        await closeBusyWindow();
        if (foreground === null) {
          expect(ask).not.toHaveBeenCalled();
          expect(invoke).toHaveBeenCalledWith("destroy_window");
        } else {
          expect(ask).toHaveBeenCalledOnce();
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
