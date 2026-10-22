// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { resetHarnessModelOverlays, setHarnessModels } from "../../sessions/model/models";
import { loadSessionFolders, saveSessionFolders } from "../../sessions/model/sessionFolders";
import type { Note } from "../../notes";
import type { Worktree } from "../../source-control/model/worktrees";
import { handleAgentApp, notePreview, type AgentAppHost } from "./agentApp";

vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: (id: string) => id === "codex",
}));

const note: Note = {
  id: "n1",
  slug: "plan",
  title: "Plan",
  body: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph should stay out of list.",
  tags: ["work"],
  createdAt: 1,
  updatedAt: 2,
};
const featureWorktree: Worktree = {
  path: "/tmp/project-worktrees/feature",
  branch: "feature",
  head: "abc123",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
};

const storedValues = new Map<string, string>();
vi.stubGlobal("localStorage", {
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
});

beforeEach(() => {
  localStorage.clear();
  setHarnessModels("codex", [
    {
      id: "codex:test",
      harness: "codex",
      name: "Test model",
      settings: [
        {
          id: "effort",
          label: "Effort",
          kind: "select",
          value: "medium",
          options: [
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
        },
      ],
    },
  ]);
});

afterEach(() => {
  resetHarnessModelOverlays();
});

function fixture() {
  const source = newSession("codex", "/tmp/project", "codex:test");
  source.id = "lead";
  const host: AgentAppHost = {
    start: vi.fn(async () => {}),
    sessions: vi.fn(async () => [
      {
        id: "other",
        title: "Other",
        harness: "codex",
        model: "codex:test",
        busy: false,
        hasDraft: false,
      },
    ]),
    session: vi.fn(async (id) =>
      id === "other" ? { ...newSession("codex", source.cwd), id } : null,
    ),
    send: vi.fn(async () => ({ alreadySubmitted: false })),
    draft: vi.fn(async () => ({ alreadySaved: false, draft: true })),
    worktrees: vi.fn(async () => ({
      worktrees: [
        { ...featureWorktree },
        { ...featureWorktree, path: source.cwd, isMain: true, branch: "main" },
      ],
      defaultRoot: "/tmp/project-worktrees",
    })),
    createWorktree: vi.fn(async () => ({ ...featureWorktree })),
    notes: vi.fn(async () => [note]),
    note: vi.fn(async (id) => (id === note.id ? note : null)),
    saveNote: vi.fn(async (input) => ({ ...note, ...input })),
  };
  return { source, host };
}

describe("agent app commands", () => {
  it("keeps deeply nested sessions addressable and request correlations stable", async () => {
    const { source, host } = fixture();
    const sessions = new Map<string, typeof source>();
    host.start = vi.fn(async (_launch, id) => {
      if (!sessions.has(id)) sessions.set(id, { ...newSession("codex", source.cwd), id });
    });
    host.sessions = vi.fn(async () =>
      [...sessions.values()].map((session) => ({
        id: session.id,
        title: session.title,
        harness: session.harness,
        model: session.model,
        busy: false,
        hasDraft: false,
      })),
    );
    host.session = vi.fn(async (id) => sessions.get(id) ?? null);
    const requestId = "r".repeat(128);
    let parent = source;
    for (let depth = 0; depth < 20; depth++) {
      const launch = { prompt: "Review this project" };
      const result = (await handleAgentApp(parent, requestId, "sessions.start", launch, host)) as {
        id: string;
      };
      expect(result.id).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(await handleAgentApp(parent, requestId, "sessions.start", launch, host)).toMatchObject(
        { id: result.id },
      );
      const child = sessions.get(result.id)!;
      await expect(
        handleAgentApp(parent, "read", "sessions.read", { sessionId: child.id }, host),
      ).resolves.toMatchObject({ sessionId: child.id });
      await handleAgentApp(
        parent,
        requestId,
        "sessions.send",
        { sessionId: child.id, prompt: "Continue" },
        host,
      );
      const correlation = vi.mocked(host.send).mock.calls.at(-1)![2];
      expect(correlation).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
      await handleAgentApp(
        parent,
        requestId,
        "sessions.draft",
        { sessionId: child.id, prompt: "Draft" },
        host,
      );
      expect(vi.mocked(host.draft).mock.calls.at(-1)![2]).toBe(correlation);
      child.blocks = [
        { id: "user", role: "user", text: "Continue", appRequestId: correlation },
        { id: "answer", role: "assistant", text: "Done" },
      ];
      await expect(
        handleAgentApp(
          parent,
          "wait",
          "sessions.wait",
          { sessionId: child.id, sentRequestId: requestId },
          host,
        ),
      ).resolves.toMatchObject({ settled: true, turn: { assistant: { text: "Done" } } });
      await expect(
        handleAgentApp(
          parent,
          "folder",
          "folders.move",
          { sessionId: child.id, newFolderName: `Depth ${depth}` },
          host,
        ),
      ).resolves.toMatchObject({ sessionId: child.id });
      parent = child;
    }
    expect(sessions.size).toBe(20);
  });

  it("separates long request keys while preserving valid persisted legacy keys", async () => {
    const { source, host } = fixture();
    const launch = { prompt: "Review" };
    expect(await handleAgentApp(source, "request", "sessions.start", launch, host)).toMatchObject({
      id: "app-lead-request",
    });
    source.id = "s".repeat(169);
    const first = (await handleAgentApp(
      source,
      "r".repeat(128),
      "sessions.start",
      launch,
      host,
    )) as { id: string };
    const otherRequest = (await handleAgentApp(
      source,
      "q".repeat(128),
      "sessions.start",
      launch,
      host,
    )) as { id: string };
    source.id = "t".repeat(169);
    const otherSource = (await handleAgentApp(
      source,
      "r".repeat(128),
      "sessions.start",
      launch,
      host,
    )) as { id: string };
    expect(new Set([first.id, otherRequest.id, otherSource.id]).size).toBe(3);
    expect(first.id.length).toBeLessThanOrEqual(256);
  });

  it("retains persisted long send and draft correlations when IDs require hashing", async () => {
    const { source, host } = fixture();
    source.id = "s".repeat(169);
    const requestId = "r".repeat(128);
    const legacy = `app-${source.id}-${requestId}`;
    const target = { ...newSession("codex", source.cwd), id: "other" };
    target.blocks = [
      { id: "u", role: "user", text: "Existing", appRequestId: legacy },
      { id: "a", role: "assistant", text: "Persisted answer" },
    ];
    host.session = vi.fn(async () => target);
    await handleAgentApp(
      source,
      requestId,
      "sessions.send",
      { sessionId: "other", prompt: "Existing" },
      host,
    );
    expect(host.send).toHaveBeenCalledWith("other", "Existing", legacy);
    await handleAgentApp(
      source,
      requestId,
      "sessions.draft",
      { sessionId: "other", prompt: "Existing" },
      host,
    );
    expect(host.draft).toHaveBeenCalledWith("other", "Existing", legacy);
    await expect(
      handleAgentApp(
        source,
        "wait",
        "sessions.wait",
        { sessionId: "other", sentRequestId: requestId },
        host,
      ),
    ).resolves.toMatchObject({ settled: true, turn: { assistant: { text: "Persisted answer" } } });
  });

  it("reads a listed project session in bounded pages", async () => {
    const { source, host } = fixture();
    const result = await handleAgentApp(
      source,
      "read-1",
      "sessions.read",
      { sessionId: "other" },
      host,
    );
    expect(result).toMatchObject({ sessionId: "other", turns: [] });
    await expect(
      handleAgentApp(source, "read-2", "sessions.read", { sessionId: "missing" }, host),
    ).rejects.toThrow("not found in this project");
  });

  it("sends a follow-up only to a listed idle session", async () => {
    const { source, host } = fixture();
    expect(
      await handleAgentApp(
        source,
        "send-1",
        "sessions.send",
        { sessionId: "other", prompt: "Continue the review" },
        host,
      ),
    ).toMatchObject({
      sessionId: "other",
      submitted: true,
      requestId: "send-1",
    });
    expect(host.send).toHaveBeenCalledWith("other", "Continue the review", "app-lead-send-1");
    await expect(
      handleAgentApp(
        source,
        "send-2",
        "sessions.send",
        { sessionId: "lead", prompt: "loop" },
        host,
      ),
    ).rejects.toThrow("current conversation");
    await expect(
      handleAgentApp(
        source,
        "send-3",
        "sessions.send",
        { sessionId: "missing", prompt: "hello" },
        host,
      ),
    ).rejects.toThrow("not found in this project");
    expect(host.send).toHaveBeenCalledTimes(1);
  });

  it("waits for the turn a send submitted and returns its reply", async () => {
    vi.useFakeTimers();
    try {
      const { source, host } = fixture();
      const other = { ...newSession("codex", source.cwd), id: "other" };
      other.blocks = [
        { id: "u1", role: "user", text: "Earlier question" },
        { id: "a1", role: "assistant", text: "Earlier answer" },
      ];
      host.session = vi.fn(async (id) => (id === "other" ? other : null));
      const waiting = handleAgentApp(
        source,
        "wait-1",
        "sessions.wait",
        { sessionId: "other", sentRequestId: "send-1", timeoutSeconds: 5 },
        host,
      );
      await vi.advanceTimersByTimeAsync(600);
      other.busy = true;
      other.blocks = [
        ...other.blocks,
        {
          id: "u2",
          role: "user",
          text: "What are you doing?",
          appRequestId: "app-lead-send-1",
        },
      ];
      await vi.advanceTimersByTimeAsync(600);
      other.busy = false;
      other.blocks = [
        ...other.blocks,
        { id: "a2", role: "assistant", text: "Waiting for a task." },
      ];
      await vi.advanceTimersByTimeAsync(600);
      expect(await waiting).toMatchObject({
        sessionId: "other",
        settled: true,
        busy: false,
        turn: {
          turnId: "u2",
          user: { text: "What are you doing?" },
          assistant: { text: "Waiting for a task." },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a sent turn once a later queued turn keeps the session busy", async () => {
    const { source, host } = fixture();
    const other = {
      ...newSession("codex", source.cwd),
      id: "other",
      busy: true,
    };
    other.blocks = [
      {
        id: "u1",
        role: "user",
        text: "First question",
        appRequestId: "app-lead-send-1",
      },
      { id: "a1", role: "assistant", text: "First answer" },
      { id: "u2", role: "user", text: "Queued follow-up" },
    ];
    host.session = vi.fn(async (id) => (id === "other" ? other : null));
    expect(
      await handleAgentApp(
        source,
        "wait-queued",
        "sessions.wait",
        { sessionId: "other", sentRequestId: "send-1", timeoutSeconds: 1 },
        host,
      ),
    ).toMatchObject({
      settled: true,
      busy: true,
      turn: { turnId: "u1", assistant: { text: "First answer" } },
    });
  });

  it("lets a session run only one wait at a time", async () => {
    vi.useFakeTimers();
    try {
      const { source, host } = fixture();
      const other = {
        ...newSession("codex", source.cwd),
        id: "other",
        busy: true,
      };
      host.session = vi.fn(async (id) => (id === "other" ? other : null));
      const first = handleAgentApp(
        source,
        "wait-a",
        "sessions.wait",
        { sessionId: "other", timeoutSeconds: 1 },
        host,
      );
      await vi.advanceTimersByTimeAsync(0);
      await expect(
        handleAgentApp(
          source,
          "wait-b",
          "sessions.wait",
          { sessionId: "other", timeoutSeconds: 1 },
          host,
        ),
      ).rejects.toThrow("already waiting");
      await vi.advanceTimersByTimeAsync(1_500);
      await first;
      other.busy = false;
      await expect(
        handleAgentApp(
          source,
          "wait-c",
          "sessions.wait",
          { sessionId: "other", timeoutSeconds: 1 },
          host,
        ),
      ).resolves.toMatchObject({ settled: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns unsettled when the waited turn outlasts the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { source, host } = fixture();
      const other = {
        ...newSession("codex", source.cwd),
        id: "other",
        busy: true,
      };
      host.session = vi.fn(async (id) => (id === "other" ? other : null));
      const waiting = handleAgentApp(
        source,
        "wait-2",
        "sessions.wait",
        { sessionId: "other", timeoutSeconds: 1 },
        host,
      );
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await waiting).toMatchObject({
        settled: false,
        busy: true,
        turn: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects waits on itself, outside the project or past the cap", async () => {
    const { source, host } = fixture();
    for (const [input, message] of [
      [{ sessionId: "lead" }, "its own turn"],
      [{ sessionId: "missing" }, "not found in this project"],
      [{ sessionId: "other", timeoutSeconds: 26 }, "from 1 to 25"],
      [{ sessionId: "other", sentRequestId: "bad id" }, "sentRequestId"],
    ] as const)
      await expect(handleAgentApp(source, "wait-x", "sessions.wait", input, host)).rejects.toThrow(
        message,
      );
  });

  it("saves an unsent draft in another listed project session", async () => {
    const { source, host } = fixture();
    expect(
      await handleAgentApp(
        source,
        "draft-1",
        "sessions.draft",
        { sessionId: "other", prompt: "Review this idea later" },
        host,
      ),
    ).toMatchObject({ sessionId: "other", saved: true, draft: true });
    expect(host.draft).toHaveBeenCalledWith("other", "Review this idea later", "app-lead-draft-1");
    await expect(
      handleAgentApp(
        source,
        "draft-2",
        "sessions.draft",
        { sessionId: "lead", prompt: "Not here" },
        host,
      ),
    ).rejects.toThrow("composer");
    await expect(
      handleAgentApp(
        source,
        "draft-3",
        "sessions.draft",
        { sessionId: "missing", prompt: "Not there" },
        host,
      ),
    ).rejects.toThrow("not found in this project");
    expect(host.draft).toHaveBeenCalledTimes(1);
  });

  it("does not let app-supplied prompts enable Operator in another session", async () => {
    const { source, host } = fixture();
    for (const action of ["sessions.send", "sessions.draft", "sessions.start"]) {
      for (const prompt of ["/operator list notes", "/mono list notes", "  /BYCODA list notes"]) {
        await expect(
          handleAgentApp(
            source,
            "blocked",
            action,
            action === "sessions.start" ? { prompt } : { sessionId: "other", prompt },
            host,
          ),
        ).rejects.toThrow("cannot enable /operator");
      }
    }
    expect(host.send).not.toHaveBeenCalled();
    expect(host.draft).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();

    await handleAgentApp(
      source,
      "ordinary",
      "sessions.send",
      { sessionId: "other", prompt: "Explain the /operator command" },
      host,
    );
    expect(host.send).toHaveBeenCalledOnce();
  });

  it("starts a submitted tab with explicit model, effort, permissions and workspace", async () => {
    const { source, host } = fixture();
    const result = await handleAgentApp(
      source,
      "request-1",
      "sessions.start",
      {
        prompt: "Inspect the API",
        model: "codex:test",
        effort: "high",
        runtimeMode: "auto-accept-edits",
        workspaceMode: "worktree",
        reveal: true,
      },
      host,
    );
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Inspect the API",
        cwd: "/tmp/project",
        model: "codex:test",
        modelSettings: { effort: "high" },
        runtimeMode: "auto-accept-edits",
        workspaceMode: "worktree",
        reveal: true,
      }),
      "app-lead-request-1",
    );
    expect(result).toMatchObject({ id: "app-lead-request-1", submitted: true });
  });

  it("lists project worktrees and starts on a selected existing checkout", async () => {
    const { source, host } = fixture();
    source.worktreeCwd = "/tmp/project-worktrees/other";
    const listed = await handleAgentApp(source, "list", "worktrees.list", {}, host);
    expect((listed as { worktrees: Worktree[] }).worktrees[0]).toMatchObject({
      branch: "feature",
    });
    expect(host.worktrees).toHaveBeenCalledWith(source.cwd);

    await handleAgentApp(
      source,
      "feature",
      "sessions.start",
      {
        prompt: "Review feature",
        worktreeCwd: featureWorktree.path,
      },
      host,
    );
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeCwd: featureWorktree.path }),
      "app-lead-feature",
    );
    await handleAgentApp(
      source,
      "main",
      "sessions.start",
      {
        prompt: "Review main",
        worktreeCwd: source.cwd,
      },
      host,
    );
    expect(host.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ worktreeCwd: undefined }),
      "app-lead-main",
    );
  });

  it("rejects unavailable or conflicting worktree choices before launching", async () => {
    const { source, host } = fixture();
    for (const input of [
      { prompt: "A", worktreeCwd: "/tmp/other-repo" },
      {
        prompt: "A",
        workspaceMode: "worktree",
        worktreeCwd: featureWorktree.path,
      },
      { prompt: "A", worktreeBase: "main", worktreeCwd: featureWorktree.path },
    ]) {
      await expect(
        handleAgentApp(source, "invalid", "sessions.start", input, host),
      ).rejects.toThrow();
    }
    vi.mocked(host.worktrees).mockResolvedValueOnce({
      worktrees: [{ ...featureWorktree, missing: true }],
      defaultRoot: "/tmp/project-worktrees",
    });
    await expect(
      handleAgentApp(
        source,
        "missing",
        "sessions.start",
        { prompt: "A", worktreeCwd: featureWorktree.path },
        host,
      ),
    ).rejects.toThrow("unavailable in this project");
    expect(host.start).not.toHaveBeenCalled();
  });

  it("creates a worktree on a named new or existing branch", async () => {
    const { source, host } = fixture();
    expect(
      await handleAgentApp(
        source,
        "new",
        "worktrees.create",
        {
          branch: "feature",
          base: "origin/main",
        },
        host,
      ),
    ).toMatchObject({ path: featureWorktree.path });
    expect(host.createWorktree).toHaveBeenCalledWith(source.cwd, "feature", "origin/main", false);
    await handleAgentApp(
      source,
      "existing",
      "worktrees.create",
      {
        branch: "feature",
        existing: true,
      },
      host,
    );
    expect(host.createWorktree).toHaveBeenLastCalledWith(source.cwd, "feature", "HEAD", true);
    await expect(
      handleAgentApp(
        source,
        "bad",
        "worktrees.create",
        {
          branch: "feature",
          base: "main",
          existing: true,
        },
        host,
      ),
    ).rejects.toThrow("base cannot be set");
    expect(host.createWorktree).toHaveBeenCalledTimes(2);
  });

  it("starts a pane beside the caller or another session in either direction", async () => {
    const { source, host } = fixture();
    await handleAgentApp(
      source,
      "right",
      "sessions.start",
      { prompt: "Inspect the API", placement: "right", draft: true },
      host,
    );
    expect(host.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: true }),
      "app-lead-right",
      { direction: "right", besideSessionId: "lead" },
    );
    await handleAgentApp(
      source,
      "down",
      "sessions.start",
      {
        prompt: "Review the UI",
        placement: "down",
        besideSessionId: "app-lead-right",
      },
      host,
    );
    expect(host.start).toHaveBeenLastCalledWith(expect.anything(), "app-lead-down", {
      direction: "down",
      besideSessionId: "app-lead-right",
    });
  });

  it("rejects invalid pane placement before starting", async () => {
    const { source, host } = fixture();
    for (const input of [
      { prompt: "A", placement: "left" },
      { prompt: "A", besideSessionId: "other" },
      { prompt: "A", placement: "down", besideSessionId: 42 },
    ]) {
      await expect(
        handleAgentApp(source, "invalid", "sessions.start", input, host),
      ).rejects.toThrow();
    }
    expect(host.start).not.toHaveBeenCalled();
  });

  it("inherits the caller's permission mode unless start overrides it", async () => {
    const { source, host } = fixture();
    source.runtimeMode = "auto";
    await handleAgentApp(
      source,
      "inherited-mode",
      "sessions.start",
      { prompt: "Review this" },
      host,
    );
    expect(host.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ runtimeMode: "auto" }),
      "app-lead-inherited-mode",
    );
    await handleAgentApp(
      source,
      "explicit-mode",
      "sessions.start",
      { prompt: "Review this", runtimeMode: "full-access" },
      host,
    );
    expect(host.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ runtimeMode: "full-access" }),
      "app-lead-explicit-mode",
    );
  });

  it("starts with an unsent draft and can immediately move the new session into a folder", async () => {
    const { source, host } = fixture();
    const result = (await handleAgentApp(
      source,
      "draft-launch",
      "sessions.start",
      {
        prompt: "Test prompt",
        model: "codex:test",
        draft: true,
      },
      host,
    )) as { id: string; submitted: boolean; draft: boolean };
    expect(result).toMatchObject({
      id: "app-lead-draft-launch",
      submitted: false,
      draft: true,
    });
    expect(host.start).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Test prompt", draft: true }),
      result.id,
    );
    host.sessions = vi.fn(async () => [
      {
        id: result.id,
        title: "Test prompt",
        harness: "codex",
        model: "codex:test",
        busy: false,
        hasDraft: true,
      },
    ]);
    const moved = await handleAgentApp(
      source,
      "folder",
      "folders.move",
      { sessionId: result.id, newFolderName: "test" },
      host,
    );
    expect(moved).toMatchObject({ sessionId: result.id, folderName: "test" });
  });

  it("rejects invalid model settings before starting a session", async () => {
    const { source, host } = fixture();
    await expect(
      handleAgentApp(
        source,
        "bad",
        "sessions.start",
        {
          prompt: "Hello",
          effort: "ultra",
        },
        host,
      ),
    ).rejects.toThrow("Invalid model setting effort");
    expect(host.start).not.toHaveBeenCalled();
    await expect(
      handleAgentApp(
        source,
        "bad-draft",
        "sessions.start",
        { prompt: "Hello", draft: "true" },
        host,
      ),
    ).rejects.toThrow("draft must be a boolean");
    await expect(handleAgentApp(source, "unexpected", "toString", {}, host)).rejects.toThrow(
      "Unknown app action",
    );
  });

  it("moves an existing project session into a sidebar folder", async () => {
    const { source, host } = fixture();
    saveSessionFolders(source.cwd, [
      {
        id: "folder-1",
        name: "Research",
        sessionIds: ["lead"],
        collapsed: false,
      },
    ]);
    expect(
      await handleAgentApp(
        source,
        "move",
        "folders.move",
        {
          sessionId: "other",
          folderId: "folder-1",
        },
        host,
      ),
    ).toMatchObject({ folderId: "folder-1", sessionId: "other" });
    expect(loadSessionFolders(source.cwd)[0]?.sessionIds).toEqual(["lead", "other"]);
  });

  it("creates a folder during a move and rejects unknown sessions", async () => {
    const { source, host } = fixture();
    await expect(
      handleAgentApp(
        source,
        "bad-move",
        "folders.move",
        {
          sessionId: "missing",
          newFolderName: "Research",
        },
        host,
      ),
    ).rejects.toThrow("Session was not found");
    const moved = (await handleAgentApp(
      source,
      "new-folder",
      "folders.move",
      {
        sessionId: "other",
        newFolderName: "Research",
      },
      host,
    )) as { folderId: string; folderName: string };
    expect(moved.folderName).toBe("Research");
    expect(loadSessionFolders(source.cwd)[0]).toMatchObject({
      id: moved.folderId,
      sessionIds: ["other"],
    });
  });

  it("lists short note previews and reads one full note on request", async () => {
    const { source, host } = fixture();
    const listed = (await handleAgentApp(source, "list", "notes.list", {}, host)) as {
      notes: Array<{ preview: string; body?: string }>;
    };
    expect(listed.notes[0]?.preview).toBe("First paragraph.\n\nSecond paragraph.");
    expect(listed.notes[0]).not.toHaveProperty("body");
    expect(notePreview("A".repeat(500))).toHaveLength(400);
    expect(await handleAgentApp(source, "read", "notes.read", { id: "n1" }, host)).toMatchObject({
      body: note.body,
    });
  });

  it("creates a note with source metadata and reuses the same request ID safely", async () => {
    const { source, host } = fixture();
    let created: Note | null = null;
    host.note = vi.fn(async (id) => (id === created?.id ? created : null));
    host.saveNote = vi.fn(async (input) => {
      created = { ...note, ...input };
      return created;
    });
    const input = { body: "# Work plan\n\nNext steps", tags: ["#Work"] };
    const saved = await handleAgentApp(source, "create-1", "notes.write", input, host);
    expect(saved).toMatchObject({
      id: "app-lead-create-1",
      title: "Work plan",
      body: input.body,
      tags: ["work"],
      sourceSessionId: source.id,
      sourceCwd: source.cwd,
    });
    expect(await handleAgentApp(source, "create-1", "notes.write", input, host)).toEqual(saved);
    expect(host.saveNote).toHaveBeenCalledTimes(1);
    await expect(
      handleAgentApp(
        source,
        "create-1",
        "notes.write",
        {
          body: "Different body",
        },
        host,
      ),
    ).rejects.toThrow("Request ID was already used");
  });

  it("edits only supplied note fields and refuses missing or malformed notes", async () => {
    const { source, host } = fixture();
    const changed = await handleAgentApp(
      source,
      "edit-1",
      "notes.write",
      {
        id: "n1",
        body: "Updated body",
      },
      host,
    );
    expect(changed).toMatchObject({
      id: "n1",
      title: note.title,
      body: "Updated body",
      tags: note.tags,
    });
    expect(host.saveNote).toHaveBeenCalledWith({
      id: "n1",
      expectedUpdatedAt: note.updatedAt,
      title: note.title,
      body: "Updated body",
      tags: note.tags,
    });
    await expect(
      handleAgentApp(
        source,
        "edit-2",
        "notes.write",
        {
          id: "missing",
          body: "x",
        },
        host,
      ),
    ).rejects.toThrow("Note was not found");
    await expect(
      handleAgentApp(
        source,
        "edit-3",
        "notes.write",
        {
          id: "n1",
        },
        host,
      ),
    ).rejects.toThrow("Supply title, body or tags");
    await expect(
      handleAgentApp(
        source,
        "edit-4",
        "notes.write",
        {
          id: "n1",
          tags: "work",
        },
        host,
      ),
    ).rejects.toThrow("tags must be an array");
    await expect(
      handleAgentApp(
        source,
        "create-2",
        "notes.write",
        {
          title: "Empty",
        },
        host,
      ),
    ).rejects.toThrow("body is required");
  });
});
