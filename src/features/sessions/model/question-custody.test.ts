import { beforeEach, expect, it, vi } from "vitest";
import type { Attachment } from "./session";
import { buildQuestionReply } from "./userQuestion";
import {
  listQuestionAttachmentDrafts,
  pendingQuestionAttachment,
  prepareOwnedQuestionAttachment,
  reconcileQuestionAttachment,
  releaseQuestionAttachments,
  retainQuestionAttachments,
  runQuestionAttachmentEffect,
} from "./questionAttachments";

const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native }));

const blob: Attachment = {
  id: "file",
  name: "note.txt",
  mimeType: "text/plain",
  kind: "file",
  size: 1,
  data: "YQ==",
};
beforeEach(() => {
  native.mockReset();
});

it("reserves the original operation before creating bytes and retains before delivery", async () => {
  const pending = pendingQuestionAttachment(blob, "draft", "session", "question");
  native.mockImplementation(async (command: string) =>
    command === "create_question_attachment" ? { state: "created", path: "owned/path" } : undefined,
  );
  const ready = await prepareOwnedQuestionAttachment(blob, pending);
  await retainQuestionAttachments([ready]);
  expect(native.mock.calls.map(([command]) => command)).toEqual([
    "reserve_question_attachment",
    "create_question_attachment",
    "retain_question_attachment",
  ]);
  expect(native.mock.calls[0][1]).toMatchObject({
    operationId: pending.questionCustody!.operationId,
    claimId: pending.questionCustody!.claimId,
    sessionId: "session",
    questionId: "question",
  });
  expect(ready).toMatchObject({ path: "owned/path", questionCustody: pending.questionCustody });
});

it("reconciles the same operation and leaves an uncertain release in the draft", async () => {
  const pending = pendingQuestionAttachment(blob, "draft", "session", "question");
  native.mockResolvedValueOnce({ state: "created", path: "owned/path" });
  const ready = (await reconcileQuestionAttachment(pending))!;
  expect(native.mock.calls[0][1]).toMatchObject({
    operationId: pending.questionCustody!.operationId,
    claimId: pending.questionCustody!.claimId,
  });
  native.mockRejectedValueOnce(new Error("cleanup uncertain"));
  await expect(releaseQuestionAttachments([ready])).rejects.toThrow("cleanup uncertain");
  expect(ready.path).toBe("owned/path");
});

it("never releases a user-picked external file", async () => {
  await releaseQuestionAttachments([{ ...blob, data: undefined, path: "external/file" }]);
  expect(native).not.toHaveBeenCalled();
});

it("keeps local custody credentials out of the provider reply", () => {
  const file = {
    ...pendingQuestionAttachment(blob, "draft", "session", "question"),
    path: "owned/path",
    missing: undefined,
  };
  const reply = buildQuestionReply(
    [{ id: "q", prompt: "Question", allowCustom: true, multiSelect: false, options: [] }],
    {},
    {},
    { q: [file] },
  );
  if (reply.kind !== "answered") throw new Error("Expected answer");
  expect(reply.attachments?.q[0]).not.toHaveProperty("questionCustody");
});

it("reconstructs the exact pending operation and holds retained delivery unknown", async () => {
  native.mockResolvedValueOnce([
    {
      fileId: "file",
      name: "note.txt",
      mimeType: "text/plain",
      kind: "file",
      size: 1,
      operationId: "operation",
      claimId: "claim",
      retained: true,
    },
  ]);
  const prompt = {
    requestId: 4,
    occurrenceId: "original-occurrence",
    callId: "turn",
    questions: [
      { id: "q", prompt: "Question", allowCustom: true, multiSelect: false, options: [] },
    ],
  };
  const [entry] = await listQuestionAttachmentDrafts("session", "draft", prompt);
  expect(native).toHaveBeenCalledWith("list_question_attachment_drafts", {
    sessionId: "session",
    questionId: JSON.stringify(["original-occurrence", null, "turn", 4, "q"]),
  });
  expect(entry).toMatchObject({
    questionId: "q",
    retained: true,
    file: {
      missing: true,
      questionCustody: { operationId: "operation", claimId: "claim", sessionId: "session" },
    },
  });
});

it("does not dispatch before retention and never removes a draft on failed release", async () => {
  const file = pendingQuestionAttachment(blob, "draft", "session", "question");
  const pin = Promise.withResolvers<void>();
  native.mockReturnValueOnce(pin.promise);
  const commit = vi.fn();
  const busy = vi.fn();
  const error = vi.fn();
  const flight = { current: false };
  runQuestionAttachmentEffect([file], "retain", commit, busy, error, flight);
  expect(commit).not.toHaveBeenCalled();
  pin.resolve();
  await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(flight.current).toBe(false));
  commit.mockClear();
  native.mockRejectedValueOnce(new Error("cleanup failed"));
  runQuestionAttachmentEffect([file], "release", commit, busy, error, flight);
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith("cleanup failed"));
  expect(commit).not.toHaveBeenCalled();
});

it("does not look up legacy attachment custody without an original run", async () => {
  const prompt = {
    requestId: 4,
    callId: "reused",
    questions: [
      { id: "q", prompt: "Question", allowCustom: true, multiSelect: false, options: [] },
    ],
  };
  expect(await listQuestionAttachmentDrafts("session", "draft", prompt)).toEqual([]);
  expect(native).not.toHaveBeenCalled();
});
