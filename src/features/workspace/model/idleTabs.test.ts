import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { leaf, type WorkspaceTab } from "./layout";
import { idleWorkspaceTabIds, sessionIsIdle, type IdleTabInput } from "./idleTabs";

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
