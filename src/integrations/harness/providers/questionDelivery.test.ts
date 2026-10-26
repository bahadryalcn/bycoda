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
