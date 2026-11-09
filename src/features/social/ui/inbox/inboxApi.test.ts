import { describe, expect, it, vi } from "vitest";
import { inboxApi, sendInboxReply } from "./inboxApi";
import type { SocialClient } from "../../model/socialClient";

type Call = { action: string; input?: Record<string, unknown>; requestId?: string };

/** Records every request and answers per action; a missing answer resolves to undefined. */
function recorder(
  answers: Partial<Record<string, (input?: Record<string, unknown>) => unknown>> = {},
) {
  const calls: Call[] = [];
  const request = vi.fn(
    async (action: string, input?: Record<string, unknown>, requestId?: string) => {
      calls.push({ action, input, requestId });
      const answer = answers[action];
      if (answer) return answer(input);
      return undefined;
    },
  );
  return {
    calls,
    call: request as unknown as <T>(
      a: string,
      i?: Record<string, unknown>,
      r?: string,
    ) => Promise<T>,
  };
}

const draft = { id: "draft-1", threadId: "t-1", text: "Hi", factIds: [] };

describe("sendInboxReply", () => {
  it("drafts, approves the exact draft, queues the send and then marks the conversation replied", async () => {
    const rec = recorder({ "replies.draft": () => draft });
    await sendInboxReply(rec.call, { threadId: "t-1", text: "Hi", factIds: [] });

    expect(rec.calls.map((call) => call.action)).toEqual([
      "replies.draft",
      "drafts.approve",
      "replies.send",
      "inbox.setStatus",
    ]);
    expect(rec.calls[0].input).toEqual({ threadId: "t-1", text: "Hi", factIds: [] });
    // The draft is passed back unchanged, so the Host can compare the exact preview.
    expect(rec.calls[1].input).toEqual({ id: "draft-1", reviewedDraft: draft });
    expect(rec.calls[2].input).toEqual({ id: "draft-1" });
    expect(rec.calls[3].input).toEqual({ threadId: "t-1", status: "replied" });
  });

  it("uses a fresh request id for every write", async () => {
    const rec = recorder({ "replies.draft": () => draft });
    await sendInboxReply(rec.call, { threadId: "t-1", text: "Hi", factIds: [] });
    const ids = rec.calls.map((call) => call.requestId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stops before approval when the draft cannot be created", async () => {
    const rec = recorder({
      "replies.draft": () => {
        throw new Error("Draft preview changed.");
      },
    });
    await expect(
      sendInboxReply(rec.call, { threadId: "t-1", text: "Hi", factIds: [] }),
    ).rejects.toThrow("Draft preview changed.");
    expect(rec.calls.map((call) => call.action)).toEqual(["replies.draft"]);
  });

  it("does not fail a queued reply when the status update fails", async () => {
    const rec = recorder({
      "replies.draft": () => draft,
      "inbox.setStatus": () => {
        throw new Error("Conversation not found.");
      },
    });
    await expect(
      sendInboxReply(rec.call, { threadId: "t-1", text: "Hi", factIds: [] }),
    ).resolves.toBeUndefined();
    expect(rec.calls.at(-1)?.action).toBe("inbox.setStatus");
  });

  it("passes the verified fact ids of an AI suggestion into the draft", async () => {
    const rec = recorder({ "replies.draft": () => draft });
    await sendInboxReply(rec.call, { threadId: "t-1", text: "Hi", factIds: ["fact-1"] });
    expect(rec.calls[0].input).toEqual({ threadId: "t-1", text: "Hi", factIds: ["fact-1"] });
  });
});

describe("inboxApi reads and settings", () => {
  it("asks for the unified list with the page size and cursor", async () => {
    const rec = recorder({ "inbox.unified": () => ({ items: [], unreadable: [] }) });
    const api = inboxApi({ request: rec.call } as unknown as SocialClient);
    await api.unified({ status: "unread", accountId: "", query: "" }, "300|t-1");
    expect(rec.calls[0]).toMatchObject({
      action: "inbox.unified",
      input: { filter: { status: "unread" }, cursor: "300|t-1", limit: 50 },
    });
  });

  it("sends the auto-refresh choice as its own write", async () => {
    const rec = recorder({ "inbox.settings": () => ({ autoRefresh: false, intervals: {} }) });
    const api = inboxApi({ request: rec.call } as unknown as SocialClient);
    await api.setAutoRefresh(false);
    expect(rec.calls[0]).toMatchObject({ action: "inbox.settings", input: { autoRefresh: false } });
    expect(rec.calls[0].requestId).toBeTruthy();
  });
});
