import { beforeEach, describe, expect, it } from "vitest";
import {
  beginReplySend,
  clearReplyDraft,
  prepareReplySend,
  readReplyDraft,
  replyDraftKey,
  resetReplyDraftsForTests,
  writeReplyDraftBody,
} from "./replyDrafts";

beforeEach(() => resetReplyDraftsForTests());

describe("reply drafts", () => {
  it("keeps drafts per account and thread", () => {
    const a = replyDraftKey("acc", "t1");
    const b = replyDraftKey("acc", "t2");
    const other = replyDraftKey("other", "t1");
    writeReplyDraftBody(a, "first");
    writeReplyDraftBody(b, "second");
    expect(readReplyDraft(a).body).toBe("first");
    expect(readReplyDraft(b).body).toBe("second");
    expect(readReplyDraft(other).body).toBe("");
  });

  it("reuses the request id across retries of the same text", () => {
    const key = replyDraftKey("acc", "t1");
    writeReplyDraftBody(key, "hello");
    let next = 0;
    const createId = () => `id-${++next}`;
    const first = beginReplySend(key, "hello", createId);
    const retry = beginReplySend(key, "hello", createId);
    expect(first).toBe("id-1");
    expect(retry).toBe("id-1");
  });

  it("uses a new id when the text changed after a failed attempt", () => {
    let next = 0;
    const createId = () => `id-${++next}`;
    const attempted = prepareReplySend(
      { body: "a", requestId: null, sentBody: null },
      "a",
      createId,
    );
    expect(attempted.requestId).toBe("id-1");
    expect(prepareReplySend(attempted, "a", createId)).toBe(attempted);
    expect(prepareReplySend(attempted, "a!", createId).requestId).toBe("id-2");
  });

  it("starts a fresh id after a successful send clears the draft", () => {
    const key = replyDraftKey("acc", "t1");
    let next = 0;
    const createId = () => `id-${++next}`;
    expect(beginReplySend(key, "hi", createId)).toBe("id-1");
    clearReplyDraft(key);
    expect(readReplyDraft(key)).toEqual({ body: "", requestId: null, sentBody: null });
    expect(beginReplySend(key, "hi", createId)).toBe("id-2");
  });

  it("keeps the pending id when the body is edited back to empty and refilled", () => {
    const key = replyDraftKey("acc", "t1");
    beginReplySend(key, "hi", () => "id-1");
    writeReplyDraftBody(key, "");
    expect(readReplyDraft(key).requestId).toBe("id-1");
    writeReplyDraftBody(key, "hi");
    expect(beginReplySend(key, "hi", () => "id-2")).toBe("id-1");
  });
});
