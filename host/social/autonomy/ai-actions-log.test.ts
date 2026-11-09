import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAction } from "../../../src/features/social/model/autonomy";
import type { SocialJob } from "../../../src/features/social/model/social";
import type { SocialPrincipal } from "../social";
import type { SocialAudienceStore } from "../store/social-audience-store";
import {
  aiActionSummary,
  aiActionUndo,
  isWriteAction,
  newAiAction,
  recordAiAction,
  recordAiWrite,
  recordAutonomousDispatch,
} from "./ai-actions-log";

afterEach(() => vi.restoreAllMocks());

function store(write: (action: AiAction) => Promise<void> = async () => undefined) {
  const rows: AiAction[] = [];
  return {
    rows,
    store: {
      putAiAction: async (action: AiAction) => {
        await write(action);
        rows.push(action);
        return action;
      },
    } as unknown as SocialAudienceStore,
  };
}

const session: SocialPrincipal = {
  kind: "session",
  actorId: "session:ai",
  sessionId: "s1",
  provider: "codex",
  projectId: "p1",
};
const owner: SocialPrincipal = { kind: "owner", actorId: "owner:me", provider: "owner" };

describe("isWriteAction", () => {
  it("treats reads and inspections as non-writes", () => {
    for (const read of [
      "inbox.list",
      "thread.read",
      "contacts.search",
      "jobs.status",
      "snapshot",
      "autonomy.get",
      "ai.summary",
    ])
      expect(isWriteAction(read)).toBe(false);
  });

  it("treats sends, drafts, stops and list changes as writes", () => {
    for (const write of [
      "replies.send",
      "replies.draft",
      "messages.send",
      "ai.stop",
      "lists.addMembers",
      "campaigns.create",
    ])
      expect(isWriteAction(write)).toBe(true);
  });
});

describe("recordAiWrite", () => {
  it("records a non-owner write with its actor and account", async () => {
    const { rows, store: s } = store();
    await recordAiWrite(s, session, "replies.send", "acc-1", { id: "d1" }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: "session:ai",
      accountId: "acc-1",
      action: "replies.send",
      status: "done",
      at: 5,
    });
  });

  it("does not record owner writes or reads", async () => {
    const { rows, store: s } = store();
    await recordAiWrite(s, owner, "replies.send", "acc-1", {}, 5);
    await recordAiWrite(s, session, "inbox.list", undefined, {}, 5);
    expect(rows).toHaveLength(0);
  });
});

describe("recordAiAction", () => {
  it("never throws to the caller and reports only a sanitized message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store: s } = store(async () => {
      throw new Error("disk full token=abcdefghijklmnopqrstuvwxyz0123456789");
    });
    await expect(
      recordAiAction(s, newAiAction({ actor: "a", action: "replies.send", at: 1 })),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("summaries, undo and autonomous dispatch", () => {
  it("summarises the action, account and a short target without content", () => {
    expect(aiActionSummary("replies.send", "acc-1", "x".repeat(200))).toBe(
      `replies.send · account acc-1 · ${"x".repeat(80)}`,
    );
  });

  it("offers undo only where a reverse action exists", () => {
    expect(aiActionUndo("lists.addMembers", { listId: "l" })).toEqual({
      action: "lists.removeMembers",
      input: { listId: "l" },
    });
    expect(aiActionUndo("publish.send", {})).toBeUndefined();
  });

  it("records a dispatch only for jobs with an autonomy approval", async () => {
    const { rows, store: s } = store();
    const base = { kind: "reply", actorId: "session:ai", accountId: "acc-1" } as SocialJob;
    await recordAutonomousDispatch(s, base, 1);
    await recordAutonomousDispatch(
      s,
      { ...base, approval: { kind: "autonomy", accountId: "acc-1", version: 2 } } as SocialJob,
      2,
    );
    expect(rows.map((row) => row.action)).toEqual(["autonomy.reply"]);
  });
});
