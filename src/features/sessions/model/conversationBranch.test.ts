import { describe, expect, it } from "vitest";
import {
  BRANCH_TITLE_MARK,
  branchBlockedReason,
  branchSessionFromReply,
  branchTitle,
} from "./conversationBranch";
import { formatSessionTitle, newSession, type Block, type Session } from "./session";

const blocks = (): Block[] => [
  { id: "u1", role: "user", text: "first question" },
  { id: "a1", role: "assistant", text: "first answer" },
  { id: "u2", role: "user", text: "second question" },
  { id: "t2", role: "tool", text: "read file" },
  { id: "a2", role: "assistant", text: "second answer" },
  { id: "u3", role: "user", text: "third question" },
  { id: "a3", role: "assistant", text: "third answer" },
];

const source = (overrides: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/work/project"),
  title: formatSessionTitle("claude", "Fix the parser"),
  providerSessionId: "provider-1",
  blocks: blocks(),
  ...overrides,
});

const turnOf = (session: Session, from: string, to: string) => {
  const start = session.blocks.findIndex((block) => block.id === from);
  const end = session.blocks.findIndex((block) => block.id === to);
  return session.blocks.slice(start, end + 1);
};

describe("branch from a reply", () => {
  it("keeps the history through the reply and nothing after it", () => {
    const original = source();
    const branch = branchSessionFromReply(original, turnOf(original, "u2", "a2"))!;
    expect(branch.blocks.slice(1).map((block) => block.id)).toEqual(["u1", "a1", "u2", "t2", "a2"]);
    expect(branch.pendingContextReplay).toContain("second answer");
    expect(branch.pendingContextReplay).not.toContain("third question");
  });

  it("starts a fresh provider session that replays the kept transcript, in the same place", () => {
    const original = source({ worktreeCwd: "/work/wt", branch: "feature" });
    const branch = branchSessionFromReply(original, turnOf(original, "u1", "a1"))!;
    expect(branch.id).not.toBe(original.id);
    expect(branch.providerSessionId).toBeUndefined();
    expect(branch.queuedMessages).toEqual([]);
    expect(branch.rewindHistory).toBeUndefined();
    expect(branch).toMatchObject({
      cwd: original.cwd,
      worktreeCwd: "/work/wt",
      harness: original.harness,
      model: original.model,
      branch: "feature",
    });
  });

  it("links back to the source turn and marks the title", () => {
    const original = source();
    const branch = branchSessionFromReply(original, turnOf(original, "u2", "a2"))!;
    expect(branch.blocks[0]).toMatchObject({
      role: "system",
      branchOrigin: { sessionId: original.id, blockId: "a2", title: "Fix the parser" },
    });
    expect(branch.title).toBe(formatSessionTitle("claude", `${BRANCH_TITLE_MARK} Fix the parser`));
    // Branching a branch does not stack marks.
    expect(branchTitle(branch)).toBe(branch.title);
  });

  it("leaves the original session exactly as it was", () => {
    const original = source({ queuedMessages: [] });
    const snapshot = structuredClone(original);
    branchSessionFromReply(original, turnOf(original, "u2", "a2"));
    expect(original).toEqual(snapshot);
    expect(original.blocks).toHaveLength(7);
    expect(original.providerSessionId).toBe("provider-1");
  });

  it("drops unsent drafts and the provider turn ids of the source", () => {
    const original = source({
      blocks: [
        { id: "u1", role: "user", text: "q", providerTurnId: "turn-1" },
        { id: "a1", role: "assistant", text: "a" },
        { id: "d1", role: "user", text: "unsent", draft: true },
      ],
    });
    const branch = branchSessionFromReply(original, [original.blocks[0], original.blocks[1]])!;
    expect(branch.blocks.some((block) => block.draft)).toBe(false);
    expect(branch.blocks.find((block) => block.id === "u1")?.providerTurnId).toBeUndefined();
  });

  describe("refusals", () => {
    const refused = (session: Session) => branchBlockedReason(session, session.blocks.slice(0, 2));
    it("refuses a Host-owned conversation", () => {
      expect(refused(source({ continuingElsewhere: true }))).toBe("host");
    });
    it("refuses a managed workspace and a removed working copy", () => {
      expect(refused(source({ workspaceId: "ws-1" }))).toBe("managed");
      expect(refused(source({ worktreeRemoved: true }))).toBe("removed");
    });
    it("refuses a transcript that is still loading", () => {
      expect(refused(source({ historyLoading: true }))).toBe("loading");
      expect(refused(source({ historyPartial: true }))).toBe("loading");
    });
    it("refuses an open approval inside the kept part, not before it", () => {
      const pending: Block = {
        id: "ap",
        role: "approval",
        text: "run",
        approval: { requestId: 1 } as Block["approval"],
      };
      const inside = source({ blocks: [...blocks().slice(0, 2), pending, ...blocks().slice(2)] });
      expect(branchBlockedReason(inside, turnOf(inside, "u3", "a3"))).toBe("approval");
      expect(branchBlockedReason(inside, turnOf(inside, "u1", "a1"))).toBeUndefined();
      expect(branchSessionFromReply(inside, turnOf(inside, "u3", "a3"))).toBeUndefined();
    });
    it("refuses a reply that is not in the transcript", () => {
      expect(branchBlockedReason(source(), [{ id: "gone", role: "assistant", text: "x" }])).toBe(
        "unavailable",
      );
    });
  });
});

describe("branch origin persistence", () => {
  it("survives the session store sanitizer and drops a malformed origin", async () => {
    const { sanitizeSessionForPersist } = await import("../data/sessionStore");
    const original = source();
    const branch = branchSessionFromReply(original, turnOf(original, "u1", "a1"))!;
    const saved = sanitizeSessionForPersist(branch);
    expect(saved.blocks[0].branchOrigin).toEqual(branch.blocks[0].branchOrigin);
    const broken = {
      ...branch,
      blocks: [{ ...branch.blocks[0], branchOrigin: { sessionId: "", blockId: "a1", title: "x" } }],
    };
    expect(sanitizeSessionForPersist(broken).blocks[0].branchOrigin).toBeUndefined();
  });
});
