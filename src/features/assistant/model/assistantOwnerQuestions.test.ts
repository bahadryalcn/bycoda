import { expect, it, vi } from "vitest";
import {
  AssistantOwnerQuestionDraft,
  ownerQuestionDraftScope,
  ownerQuestionPrompt,
  ownerQuestionVisible,
  pendingOwnerQuestions,
  type OwnerQuestionPort,
  type OwnerQuestionRequest,
} from "./assistantOwnerQuestions";
import {
  AssistantOwnerQuestionSchema,
  AssistantOwnerQuestionAnswerSchema,
  AssistantOwnerQuestionSnoozeSchema,
  type AssistantOwnerQuestion,
  type AssistantOwnerQuestionReceipt,
} from "../../../shared/model/assistantOwnerQuestions";
function question(): AssistantOwnerQuestion {
  return AssistantOwnerQuestionSchema.parse({
    id: "canonical-question",
    version: 2,
    jobId: "job",
    projectIds: ["p"],
    sourceToken: "a".repeat(64),
    origin: "chief",
    prompt: {
      requestId: 7,
      occurrenceId: "host-occurrence",
      title: "Plan choice",
      behavior: "nonBlocking",
      questions: [
        {
          id: "host-question",
          prompt: "Choose the scope",
          multiSelect: false,
          allowCustom: true,
          options: [
            { id: "host-option-a", label: "Focused" },
            { id: "host-option-b", label: "Other" },
          ],
        },
      ],
    },
    status: "open",
    createdAt: 1,
    updatedAt: 2,
  });
}
function fixture() {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  let current: AssistantOwnerQuestion | null = question(),
    allowed = true,
    dropAck = false;
  const calls: { input: OwnerQuestionRequest; environmentId: string }[] = [],
    receipts = new Map<string, AssistantOwnerQuestionReceipt>();
  const request: OwnerQuestionPort = async (input, environmentId) => {
    calls.push({ input: structuredClone(input), environmentId });
    expect(environmentId).toBe("original-host");
    if (input.op === "questions.get")
      return {
        ownerQuestion: current,
        ...(receipts.has(input.requestId ?? "")
          ? { ownerQuestionReceipt: receipts.get(input.requestId!) }
          : {}),
      };
    const parsed =
      input.op === "questions.answer"
        ? AssistantOwnerQuestionAnswerSchema.parse(input)
        : AssistantOwnerQuestionSnoozeSchema.parse(input);
    expect(pendingOwnerQuestions(storage, environmentId)).toHaveLength(1);
    if (!current || current.version !== parsed.expectedVersion) throw new Error("stale");
    const receipt: AssistantOwnerQuestionReceipt = {
      requestId: parsed.requestId,
      kind: parsed.op === "questions.answer" ? "answer" : "snooze",
      version: current.version + 1,
      at: 10,
      input: parsed,
    };
    receipts.set(parsed.requestId, receipt);
    current = {
      ...current,
      version: receipt.version,
      updatedAt: 10,
      lastOwnerAction: receipt,
      ...(parsed.op === "questions.answer"
        ? {
            status: "answered",
            answer: {
              requestId: parsed.requestId,
              answers: parsed.answers,
              ...(parsed.custom ? { custom: parsed.custom } : {}),
              answeredAt: 10,
              version: receipt.version,
            },
          }
        : { status: "snoozed", snoozedUntil: parsed.until }),
    };
    if (dropAck) throw new Error("lost acknowledgement");
    return { ownerQuestion: current, ownerQuestionReceipt: receipt };
  };
  const model = () =>
    new AssistantOwnerQuestionDraft(
      question(),
      "original-host",
      storage,
      () => "owner-request",
      () => allowed,
    );
  return {
    values,
    storage,
    calls,
    request,
    model,
    receipts,
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
    set allowed(value: boolean) {
      allowed = value;
    },
    set dropAck(value: boolean) {
      dropAck = value;
    },
  };
}
const answer = { kind: "answered" as const, answers: { "host-question": ["host-option-a"] } };
it("uses canonical semantic IDs and durable exact owner intent through the finite shared API schemas", async () => {
  const f = fixture(),
    draft = f.model();
  draft.saveDraft({ step: 0, answers: answer.answers, custom: {} });
  const result = await draft.submit(answer, f.request, 3600000);
  expect(result.status).toBe("answered");
  expect(f.calls.map((call) => call.input.op)).toEqual(["questions.get", "questions.answer"]);
  expect(f.calls[1].input).toMatchObject({
    id: "canonical-question",
    expectedVersion: 2,
    requestId: "owner-request",
    answers: answer.answers,
  });
  expect(pendingOwnerQuestions(f.storage, "original-host")).toEqual([]);
  expect(draft.intentPending).toBe(false);
  expect(ownerQuestionPrompt(question()).questions[0].options[1]).toMatchObject({
    id: "host-option-b",
    label: "Other",
    literal: true,
  });
});
it("restores a lost-ACK intent and resolves its exact receipt without sending the answer again", async () => {
  const f = fixture();
  f.dropAck = true;
  await expect(f.model().submit(answer, f.request, 3600000)).rejects.toThrow(
    "lost acknowledgement",
  );
  const restored = f.model();
  expect(restored.intentPending).toBe(true);
  expect(pendingOwnerQuestions(f.storage, "different-host")).toEqual([]);
  expect((await restored.retry(f.request)).answer?.answers).toEqual(answer.answers);
  expect(f.calls.filter((call) => call.input.op === "questions.answer")).toHaveLength(1);
});
it("retries unchanged unaccepted canonical input with the same request and frozen payload only on explicit Retry", async () => {
  const f = fixture(),
    offline = vi.fn<OwnerQuestionPort>().mockRejectedValue(new Error("offline"));
  await expect(f.model().submit(answer, offline, 3600000)).rejects.toThrow("offline");
  const restored = f.model();
  expect(() =>
    restored.submit({ ...answer, answers: { "host-question": ["host-option-b"] } }, f.request, 999),
  ).toThrow("unconfirmed");
  await restored.retry(f.request);
  expect(f.calls[1].input).toMatchObject({ requestId: "owner-request", answers: answer.answers });
});
it("does not resurrect missing, changed, stale-source or foreign question identities", async () => {
  for (const patch of [
    null,
    { ...question(), version: 3 },
    { ...question(), sourceCurrent: false },
    { ...question(), projectIds: ["foreign"] },
  ]) {
    const f = fixture();
    f.current = patch;
    await expect(f.model().submit(answer, f.request, 3600000)).rejects.toThrow();
    expect(f.calls.filter((call) => call.input.op !== "questions.get")).toEqual([]);
    expect(pendingOwnerQuestions(f.storage, "original-host")).toHaveLength(1);
  }
});
it("checks live visibility again after a deferred read before any write or acknowledgement disclosure", async () => {
  const f = fixture(),
    request: OwnerQuestionPort = async () => {
      f.allowed = false;
      return { ownerQuestion: f.current };
    };
  await expect(f.model().submit(answer, request, 3600000)).rejects.toThrow("visibility changed");
  expect(f.calls).toEqual([]);
});
it("refuses forged option IDs, duplicate answers and disallowed custom text before any RPC", () => {
  for (const reply of [
    { ...answer, answers: { "host-question": ["guessed"] } },
    { ...answer, answers: { "host-question": ["host-option-a", "host-option-a"] } },
    { ...answer, answers: { foreign: ["host-option-a"] } },
    { ...answer, answers: {} },
  ]) {
    const f = fixture();
    expect(() => f.model().submit(reply, f.request, 3600000)).toThrow();
    expect(f.calls).toEqual([]);
  }
  const f = fixture(),
    q = question();
  q.prompt.questions[0].allowCustom = false;
  const draft = new AssistantOwnerQuestionDraft(
    q,
    "original-host",
    f.storage,
    () => "owner-request",
    () => true,
  );
  expect(() =>
    draft.submit(
      { ...answer, custom: { "host-question": "permission grant" } },
      f.request,
      3600000,
    ),
  ).toThrow();
  expect(f.calls).toEqual([]);
});
it("maps Later only to a stable snooze intent and verifies an older exact receipt after later state changes", async () => {
  const f = fixture();
  f.dropAck = true;
  await expect(f.model().submit({ kind: "skipped" }, f.request, 3600000)).rejects.toThrow();
  const old = f.current!;
  f.current = {
    ...old,
    version: old.version + 1,
    status: "open",
    snoozedUntil: undefined,
    lastOwnerAction: undefined,
  };
  const result = await f.model().retry(f.request);
  expect(result.status).toBe("open");
  expect(f.calls.filter((call) => call.input.op === "questions.snooze")).toHaveLength(1);
  expect(f.calls.some((call) => call.input.op === "questions.answer")).toBe(false);
});
it("keeps pending input when a receipt belongs to another payload and prevents another renderer overwriting it", async () => {
  const f = fixture(),
    first = f.model(),
    other = f.model();
  f.dropAck = true;
  await expect(first.submit(answer, f.request, 3600000)).rejects.toThrow();
  expect(() =>
    other.submit(
      { ...answer, answers: { "host-question": ["host-option-b"] } },
      f.request,
      3600000,
    ),
  ).toThrow("unconfirmed");
  const receipt = f.receipts.get("owner-request")!;
  f.receipts.set("owner-request", {
    ...receipt,
    input: {
      op: "questions.snooze",
      id: "canonical-question",
      expectedVersion: 2,
      requestId: "owner-request",
      until: 1,
    },
  });
  f.current = { ...f.current!, lastOwnerAction: undefined };
  await expect(f.model().retry(f.request)).rejects.toThrow("changed with its work");
  expect(pendingOwnerQuestions(f.storage, "original-host")).toHaveLength(1);
});
it("separates drafts by actual environment and question version and never dispatches when durable storage fails", () => {
  const f = fixture();
  expect(ownerQuestionDraftScope("original-host", question())).not.toBe(
    ownerQuestionDraftScope("other", question()),
  );
  expect(ownerQuestionDraftScope("original-host", question())).not.toBe(
    ownerQuestionDraftScope("original-host", { ...question(), version: 3 }),
  );
  const draft = f.model();
  f.storage.setItem = () => {
    throw new Error("quota");
  };
  expect(() => draft.submit(answer, f.request, 3600000)).toThrow("could not be saved");
  expect(f.calls).toEqual([]);
});
it("conceals mixed and unknown contributors while allowing only verified global proposal shapes", () => {
  expect(ownerQuestionVisible({ ...question(), projectIds: ["p", "hidden"] }, ["p"])).toBe(false);
  expect(ownerQuestionVisible({ ...question(), projectIds: [] }, ["p"])).toBe(false);
  expect(
    ownerQuestionVisible(
      {
        ...question(),
        jobId: null,
        origin: "voice-proposal",
        threadId: "global-thread",
        ownerMessageId: "accepted-owner",
        projectIds: [],
      },
      [],
    ),
  ).toBe(true);
});
