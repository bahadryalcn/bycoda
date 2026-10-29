import { describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../core/types";
import {
  deliverQuestionReply,
  QuestionReplyValidationError,
  type QuestionDelivery,
} from "./questionDelivery";

const answer = { kind: "answered" as const, answers: { scope: ["local"] } };
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("question reply transport", () => {
  it("keeps the question pending until the write completes and sends duplicate clicks once", async () => {
    let complete!: () => void;
    const events: HarnessEvent[] = [];
    const accepted = vi.fn();
    const deliver = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending: QuestionDelivery = { deliver };
    const send = () =>
      deliverQuestionReply(
        pending,
        7,
        answer,
        (event) => events.push(event),
        () => true,
        accepted,
      );
    send();
    send();
    await flush();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "question.updated", requestId: 7, delivery: "sending" }]);
    expect(accepted).not.toHaveBeenCalled();
    complete();
    await flush();
    expect(accepted).toHaveBeenCalledOnce();
  });

  it("holds an uncertain write without resending or claiming delivery", async () => {
    const events: HarnessEvent[] = [];
    const accepted = vi.fn();
    const deliver = vi.fn(async () => {
      throw new Error("transport dropped after write");
    });
    const pending: QuestionDelivery = { deliver };
    const send = () =>
      deliverQuestionReply(
        pending,
        7,
        answer,
        (event) => events.push(event),
        () => true,
        accepted,
      );
    send();
    await flush();
    send();
    await flush();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(accepted).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "question.updated",
      requestId: 7,
      delivery: "unknown",
    });
    expect(JSON.stringify(events)).not.toContain("transport dropped");
  });

  it("allows correcting locally rejected form values without losing the question", async () => {
    const events: HarnessEvent[] = [];
    const accepted = vi.fn();
    const deliver = vi
      .fn<NonNullable<QuestionDelivery["deliver"]>>()
      .mockRejectedValueOnce(new QuestionReplyValidationError("Choose a listed option."))
      .mockResolvedValueOnce(undefined);
    const pending: QuestionDelivery = { deliver };
    const send = () =>
      deliverQuestionReply(
        pending,
        7,
        answer,
        (event) => events.push(event),
        () => true,
        accepted,
      );
    send();
    await flush();
    expect(events.at(-1)).toMatchObject({ delivery: "failed" });
    send();
    await flush();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(accepted).toHaveBeenCalledOnce();
  });

  it("ignores late writes after cancellation replaces the request", async () => {
    let complete!: () => void;
    let current = true;
    const accepted = vi.fn();
    const pending: QuestionDelivery = {
      deliver: () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    };
    deliverQuestionReply(
      pending,
      7,
      answer,
      () => undefined,
      () => current,
      accepted,
    );
    await flush();
    current = false;
    complete();
    await flush();
    expect(accepted).not.toHaveBeenCalled();
  });
});

it("retains a queued question's original source through a held reply and late retirement", async () => {
  const api = await import("../core/nativeOutputDelivery");
  const { nativeOutputFrame } = await import("../core/nativeOutputDelivery.testSupport");
  const event: Extract<HarnessEvent, { type: "question.asked" }> = {
    type: "question.asked",
    requestId: 91,
    title: "Choose",
    questions: [],
  };
  const inspect = nativeOutputFrame("question-causal", "question", () =>
    api.captureNativeOutputCurrentEvent(event),
  );
  const origin = api.getNativeOutputEventOrigin(event);
  expect(origin).not.toBeNull();
  let release!: () => void;
  let current = true;
  const accepted = vi.fn();
  const emitted: HarnessEvent[] = [];
  const pending: QuestionDelivery = {
    event,
    deliver: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  };
  deliverQuestionReply(
    pending,
    91,
    answer,
    (next) => {
      api.captureNativeOutputEvent("question-causal", next);
      emitted.push(next);
    },
    () => current,
    accepted,
  );
  expect(inspect().pendingCausalWork).toBe(1);
  await flush();
  expect(api.getNativeOutputEventOrigin(emitted[0])).toBe(origin);
  current = false;
  expect(inspect().pendingCausalWork).toBe(1);
  release();
  await flush();
  expect(accepted).not.toHaveBeenCalled();
  expect(inspect()).toMatchObject({
    pendingCausalWork: 0,
    unavailableReason: "additional-input-unsealed",
    applicationThrough: null,
  });
});

it("presents queued questions using their creation origin outside the parser scope", async () => {
  const api = await import("../core/nativeOutputDelivery");
  const { nativeOutputFrame } = await import("../core/nativeOutputDelivery.testSupport");
  const { showNextQueuedQuestion } = await import("./questionDelivery");
  const first: Extract<HarnessEvent, { type: "question.asked" }> = {
    type: "question.asked",
    requestId: 1,
    title: "First",
    questions: [],
  };
  const second: Extract<HarnessEvent, { type: "question.asked" }> = {
    type: "question.asked",
    requestId: 2,
    title: "Second",
    questions: [],
  };
  nativeOutputFrame("question-queue", "first", () => api.captureNativeOutputCurrentEvent(first));
  nativeOutputFrame("question-queue", "second", () => api.captureNativeOutputCurrentEvent(second));
  const original = api.getNativeOutputEventOrigin(second);
  const seen: HarnessEvent[] = [];
  const live = {
    questions: new Map<number, QuestionDelivery>([
      [1, { event: first }],
      [2, { event: second }],
    ]),
    visibleQuestionId: undefined as number | undefined,
    cancelled: false,
    muteUpdates: false,
    onEvent: (event: HarnessEvent) => {
      api.captureNativeOutputEvent("question-queue", event);
      seen.push(event);
    },
  };
  showNextQueuedQuestion(live);
  live.questions.delete(1);
  showNextQueuedQuestion(live);
  expect(seen).toEqual([first, second]);
  expect(api.getNativeOutputEventOrigin(second)).toBe(original);
  expect(api.getNativeOutputEventOrigin(first)).not.toBe(original);
});
