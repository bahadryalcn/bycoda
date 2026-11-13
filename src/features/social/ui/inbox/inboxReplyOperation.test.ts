import { describe, expect, it, vi } from "vitest";
import { createInboxReplyOperation, resumeInboxReply } from "./inboxReplyOperation";

type RequestFn = <T>(
  action: string,
  body?: Record<string, unknown>,
  requestId?: string,
) => Promise<T>;

const input = { threadId: "t1", text: "My exact reply", factIds: ["verified-1"] };
const draft = { id: "d1", ...input };
const job = { id: "j1", draftId: "d1", status: "queued" };

/** Emulates Host receipts and the job read path, without any platform/account access. */
function transport(dropAction: string, afterCommit: boolean) {
  const receipts = new Map<string, unknown>();
  const commits: string[] = [];
  let drop = true;
  let queued = false;
  let failRead = false;
  const call = vi.fn(
    async (
      action: string,
      _body?: Record<string, unknown>,
      requestId?: string,
    ): Promise<unknown> => {
      if (action === "jobs.status") {
        if (failRead) throw new Error("Status offline");
        return { jobs: queued ? [job] : [], page: { offset: 0, limit: 100, total: +queued } };
      }
      if (!requestId) throw new Error("Missing write identity");
      if (receipts.has(requestId)) return receipts.get(requestId);
      const shouldDrop = drop && action === dropAction;
      if (shouldDrop && !afterCommit) {
        drop = false;
        throw new Error("Network lost");
      }
      const result = action === "replies.draft" ? draft : action === "replies.send" ? job : {};
      if (action === "replies.send") queued = true;
      commits.push(action);
      receipts.set(requestId, result);
      if (shouldDrop) {
        drop = false;
        throw new Error("Acknowledgement lost");
      }
      return result;
    },
  );
  return {
    call: call as unknown as RequestFn & Pick<typeof call, "mock">,
    commits,
    failRead: () => {
      failRead = true;
    },
  };
}

describe("reply operation recovery", () => {
  for (const stage of ["replies.draft", "drafts.approve", "replies.send"]) {
    for (const afterCommit of [false, true]) {
      it(`keeps one draft and send when ${stage} drops ${afterCommit ? "after" : "before"} acceptance`, async () => {
        const host = transport(stage, afterCommit);
        const operation = createInboxReplyOperation(input);
        await expect(resumeInboxReply(host.call, operation)).rejects.toThrow(/lost/);
        expect(operation.input).toEqual(input);
        await resumeInboxReply(host.call, operation);
        expect(operation.queued).toBe(true);
        expect(host.commits).toEqual([
          "replies.draft",
          "drafts.approve",
          "replies.send",
          "inbox.setStatus",
        ]);
        const repeated = host.call.mock.calls.filter(([action]) => action === stage);
        if (repeated.length > 1) expect(new Set(repeated.map((call) => call[2])).size).toBe(1);
        if (stage === "drafts.approve") {
          expect(repeated.every(([, body]) => body?.reviewedDraft === draft)).toBe(true);
        }
      });
    }
  }

  it("does not replay a send after a failed status lookup or lose its original facts", async () => {
    const host = transport("replies.send", true);
    const operation = createInboxReplyOperation(input);
    await expect(resumeInboxReply(host.call, operation)).rejects.toThrow("Acknowledgement lost");
    host.failRead();
    await expect(resumeInboxReply(host.call, operation)).rejects.toThrow("Status offline");
    expect(host.call.mock.calls.filter(([action]) => action === "replies.send")).toHaveLength(1);
    expect(operation.input.factIds).toEqual(["verified-1"]);
    expect(operation.queued).toBeUndefined();
  });

  it("never proceeds to send after a genuine approval refusal", async () => {
    const actions: string[] = [];
    const call = async <T>(action: string): Promise<T> => {
      actions.push(action);
      if (action === "replies.draft") return draft as T;
      throw new Error("Draft preview changed.");
    };
    const operation = createInboxReplyOperation(input);
    await expect(resumeInboxReply(call, operation)).rejects.toThrow("Draft preview changed.");
    await expect(resumeInboxReply(call, operation)).rejects.toThrow("Draft preview changed.");
    expect(actions).not.toContain("replies.send");
    expect(operation.draft).toBe(draft);
  });

  it("joins an in-flight operation and never resubmits a completed operation", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = transport("", false);
    const call = async <T>(
      action: string,
      body?: Record<string, unknown>,
      id?: string,
    ): Promise<T> => {
      await barrier;
      return host.call<T>(action, body, id);
    };
    const operation = createInboxReplyOperation(input);
    const first = resumeInboxReply(call, operation);
    expect(resumeInboxReply(call, operation)).toBe(first);
    release();
    await first;
    await resumeInboxReply(call, operation);
    expect(host.commits.filter((action) => action === "replies.send")).toHaveLength(1);
  });
});
