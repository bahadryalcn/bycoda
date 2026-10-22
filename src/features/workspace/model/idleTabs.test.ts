import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { leaf, type WorkspaceTab } from "./layout";
import {
  emptyForeignTabIds,
  idleWorkspaceTabIds,
  isEmptyNewChat,
  sessionIsIdle,
  unlistedTabIds,
  type IdleTabInput,
} from "./idleTabs";

function session(id: string, patch: Partial<Session> = {}): Session {
  return { id, blocks: [], ...patch } as unknown as Session;
}

function tab(id: string, sessionIds: string[], patch: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    kind: "session",
    id,
    layout: { ...leaf(sessionIds[0]), tabIds: sessionIds },
    focusedId: sessionIds[0],
    editorPanes: [],
    terminalPanes: [],
    ...patch,
  } as WorkspaceTab;
}

function input(patch: Partial<IdleTabInput> = {}): IdleTabInput {
  return {
    tabs: [],
    sessions: [],
    activeTabId: "active",
    busySessionIds: new Set(),
    unseenFinishedIds: new Set(),
    dirtyFileIds: new Set(),
    hasComposerDraft: () => false,
    ...patch,
  };
}

describe("sessionIsIdle", () => {
  it("accepts a quiet session", () => {
    expect(sessionIsIdle(session("a"), input())).toBe(true);
  });

  it.each<[string, Partial<Session>]>([
    ["busy", { busy: true }],
    ["continuing elsewhere", { continuingElsewhere: true }],
    ["pending question", { pendingQuestion: { id: "q" } as unknown as Session["pendingQuestion"] }],
    ["background tasks", { backgroundTasks: ["task"] }],
    ["background agents", { backgroundAgents: 1 }],
    ["queued messages", { queuedMessages: [{ id: "m" }] as unknown as Session["queuedMessages"] }],
    ["streaming block", { blocks: [{ id: "b", role: "assistant", streaming: true }] as unknown as Session["blocks"] }],
    [
      "running tool",
      { blocks: [{ id: "b", role: "assistant", tool: { status: "in_progress" } }] as unknown as Session["blocks"] },
    ],
    [
      "pending approval",
      {
        blocks: [{ id: "b", role: "assistant", approval: { decided: false } }] as unknown as Session["blocks"],
      },
    ],
    [
      "unsent draft turn",
      { blocks: [{ id: "d", role: "user", text: "draft", draft: true }] as unknown as Session["blocks"] },
    ],
  ])("rejects a session with %s", (_label, patch) => {
    expect(sessionIsIdle(session("a", patch), input())).toBe(false);
  });

  it("rejects busy, unseen-finished and composer-draft sessions from the caller's sets", () => {
    expect(sessionIsIdle(session("a"), input({ busySessionIds: new Set(["a"]) }))).toBe(false);
    expect(sessionIsIdle(session("a"), input({ unseenFinishedIds: new Set(["a"]) }))).toBe(false);
    expect(sessionIsIdle(session("a"), input({ hasComposerDraft: () => true }))).toBe(false);
  });
});

describe("idleWorkspaceTabIds", () => {
  it("returns only quiet, non-active tabs", () => {
    const ids = idleWorkspaceTabIds(
      input({
        tabs: [tab("active", ["s1"]), tab("t2", ["s2"]), tab("t3", ["s3"]), tab("t4", ["s4"])],
        sessions: [session("s1"), session("s2"), session("s3", { busy: true }), session("s4")],
      }),
    );
    expect(ids).toEqual(["t2", "t4"]);
  });

  it("keeps a tab when any of its sessions is active", () => {
    const ids = idleWorkspaceTabIds(
      input({
        tabs: [tab("active", ["a"]), tab("split", ["x", "y"])],
        sessions: [session("a"), session("x"), session("y", { queuedMessages: [{ id: "m" }] as unknown as Session["queuedMessages"] })],
      }),
    );
    expect(ids).toEqual([]);
  });

  it("keeps tabs with dirty files, terminal panes or moves in flight", () => {
    const file = { id: "f1", path: "/a.ts" } as unknown as WorkspaceTab["editorPanes"][number]["files"][number];
    const sessions = [session("a"), session("b"), session("c"), session("d")];
    const ids = idleWorkspaceTabIds(
      input({
        tabs: [
          tab("active", ["z"]),
          tab("dirty", ["a"], { editorPanes: [{ id: "p", files: [file], activeFileId: "f1" } as never] }),
          tab("terminal", ["b"], { terminalPanes: [{ id: "t", files: [], activeFileId: "" } as never] }),
          tab("moving", ["c"]),
          tab("clean", ["d"]),
        ],
        sessions: [...sessions, session("z")],
        dirtyFileIds: new Set(["f1"]),
        movingTabIds: new Set(["moving"]),
      }),
    );
    expect(ids).toEqual(["clean"]);
  });

  it("keeps a tab whose session is not loaded", () => {
    expect(idleWorkspaceTabIds(input({ tabs: [tab("t", ["missing"])] }))).toEqual([]);
  });
});

describe("isEmptyNewChat", () => {
  it("accepts a chat that was never typed in", () => {
    expect(isEmptyNewChat(session("a"))).toBe(true);
  });

  it.each<[string, Partial<Session>]>([
    ["a user turn", { blocks: [{ id: "u", role: "user", text: "hi" }] as unknown as Session["blocks"] }],
    ["an assistant turn", { blocks: [{ id: "a", role: "assistant", text: "hi" }] as unknown as Session["blocks"] }],
    ["an unsent draft turn", { blocks: [{ id: "d", role: "user", text: "", draft: true }] as unknown as Session["blocks"] }],
    ["a provider conversation", { providerSessionId: "thread-1" }],
    ["a pending provider switch", { pendingSwitch: {} as unknown as Session["pendingSwitch"] }],
    ["a seeded composer text", { composerSeed: "Summarise the repo" }],
    ["an inbox card", { inboxCard: {} as unknown as Session["inboxCard"] }],
    ["a note card", { noteCard: {} as unknown as Session["noteCard"] }],
    ["an automation", { automationId: "auto-1" }],
    ["a linked work item", { linkedWorkItem: {} as unknown as Session["linkedWorkItem"] }],
    ["a transcript still paging in", { historyLoading: true }],
    ["a failed transcript load", { historyLoadError: "boom" }],
    ["rewind history", { rewindHistory: [{}] as unknown as Session["rewindHistory"] }],
  ])("rejects a chat with %s", (_label, patch) => {
    expect(isEmptyNewChat(session("a", patch))).toBe(false);
  });
});

describe("unlistedTabIds", () => {
  it("keeps only candidate tabs none of whose sessions are in the saved list", () => {
    const tabs = [tab("saved", ["a"]), tab("unsaved", ["b"]), tab("mixed", ["c", "d"])];
    expect(unlistedTabIds(["saved", "unsaved", "mixed"], tabs, new Set(["a", "d"]))).toEqual([
      "unsaved",
    ]);
  });

  it("drops a candidate that no longer has a tab", () => {
    expect(unlistedTabIds(["gone"], [], new Set())).toEqual([]);
  });
});

describe("emptyForeignTabIds", () => {
  const foreign = "/work/alpha";
  const current = "/work/beta";
  const at = (id: string, cwd: string, patch: Partial<Session> = {}) => session(id, { cwd, ...patch });

  it("closes only empty new chats of other projects", () => {
    const ids = emptyForeignTabIds(
      input({
        tabs: [
          tab("active", ["a"]),
          tab("here", ["b"]),
          tab("empty-foreign", ["c"]),
          tab("used-foreign", ["d"]),
          tab("empty-foreign-2", ["e"]),
        ],
        sessions: [
          at("a", foreign),
          at("b", current),
          at("c", foreign),
          at("d", foreign, { blocks: [{ id: "u", role: "user", text: "hi" }] as unknown as Session["blocks"] }),
          at("e", "/work/gamma"),
        ],
      }),
      current,
    );
    expect(ids).toEqual(["empty-foreign", "empty-foreign-2"]);
  });

  it("keeps a foreign tab with a typed or attached but unsent message", () => {
    const ids = emptyForeignTabIds(
      input({
        tabs: [tab("typed", ["a"]), tab("attached", ["b"]), tab("blank", ["c"])],
        sessions: [at("a", foreign), at("b", foreign), at("c", foreign)],
        hasComposerDraft: (sessionId) => sessionId !== "c" && sessionId !== "x",
      }),
      current,
    );
    expect(ids).toEqual(["blank"]);
  });

  it("keeps a foreign tab whose session is busy, or that has editors or terminals", () => {
    const ids = emptyForeignTabIds(
      input({
        tabs: [
          tab("active", ["z"]),
          tab("busy", ["a"]),
          tab("editor", ["b"], { editorPanes: [{ id: "p", files: [], activeFileId: "" } as never] }),
          tab("terminal", ["c"], { terminalPanes: [{ id: "t", files: [], activeFileId: "" } as never] }),
          tab("moving", ["d"]),
          tab("pending", ["e"]),
        ],
        sessions: [
          at("z", current),
          at("a", foreign),
          at("b", foreign),
          at("c", foreign),
          at("d", foreign),
          at("e", foreign),
        ],
        busySessionIds: new Set(["a"]),
        movingTabIds: new Set(["moving"]),
      }),
      current,
    );
    // Only the untouched control tab is closed.
    expect(ids).toEqual(["pending"]);
  });

  it("closes a remote tab only when the caller vouches for each of its sessions", () => {
    const remote = "remote://machine-1/work/alpha";
    const tabs = [
      tab("active", ["z"]),
      tab("unsent", ["a"]),
      tab("bound", ["b"]),
      tab("typed", ["c"]),
    ];
    const sessions = [at("z", current), at("a", remote), at("b", remote), at("c", remote)];
    const vouched = new Set(["a", "b", "c"]);
    const withPredicate = emptyForeignTabIds(
      input({ tabs, sessions, hasComposerDraft: (id) => id === "c" }),
      current,
      (session) => vouched.has(session.id) && session.id !== "b",
    );
    expect(withPredicate).toEqual(["unsent"]);
    expect(emptyForeignTabIds(input({ tabs, sessions }), current)).toEqual([]);
  });

  it("never returns tabs without a project path", () => {
    expect(
      emptyForeignTabIds(
        input({ tabs: [tab("home", ["a"])], sessions: [at("a", "~")] }),
        current,
      ),
    ).toEqual([]);
  });
});
