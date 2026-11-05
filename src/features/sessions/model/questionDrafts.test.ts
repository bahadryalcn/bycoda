import { afterEach, describe, expect, it, vi } from "vitest";
import {
  associateQuestionDraft,
  discardQuestionDraft,
  readQuestionDraft,
  writeQuestionDraft,
  reserveQuestionDraft,
  resolveQuestionDraft,
  questionDraftKey,
  subscribeQuestionDraftCapacity,
  getQuestionDraftCapacitySnapshot,
  QUESTION_DRAFT_LIMITS,
  type QuestionDraft,
  type QuestionDraftReservation,
} from "./questionDrafts";
import { beginParentInputClosure, captureParentInputs } from "../data/parentInputClosure";
import type { UserQuestionPrompt } from "./userQuestion";

const prompt: UserQuestionPrompt = {
  requestId: 1,
  callId: "question-1",
  providerTurnId: "turn-1",
  questions: [
    { id: "scope", prompt: "Which scope?", allowCustom: true, multiSelect: false, options: [] },
  ],
};
const draft: QuestionDraft = {
  step: 0,
  answers: {},
  custom: { scope: "Keep this unfinished answer" },
};
const cleanup: (() => void)[] = [];
function own(scope: string, question = prompt) {
  cleanup.push(() => resolveQuestionDraft(scope, question));
  return question;
}
function reserve(scope: string, question = prompt, root = scope) {
  own(scope, question);
  const result = reserveQuestionDraft(scope, question, root);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  cleanup.push(() => result.value.release());
  return result.value;
}
afterEach(() => {
  for (const release of cleanup.splice(0).reverse()) release();
});

describe("bounded question drafts", () => {
  it("keeps exact immutable answers scoped to the original semantic question", () => {
    own("owner");
    const input = {
      step: 0,
      answers: { scope: ["__custom__"] },
      custom: { scope: " \r\nİ😀\t " },
      delivery: undefined,
    };
    expect(writeQuestionDraft("owner", prompt, input).ok).toBe(true);
    input.custom.scope = "mutated after acceptance";
    const retained = readQuestionDraft("owner", prompt)!;
    expect(retained.custom.scope).toBe(" \r\nİ😀\t ");
    expect(Object.hasOwn(retained, "delivery")).toBe(true);
    expect(Object.isFrozen(retained.custom)).toBe(true);
    expect(readQuestionDraft("other-session", prompt)).toBeUndefined();
    expect(readQuestionDraft(undefined, prompt)).toBeUndefined();
    for (const changed of [
      { ...prompt, providerTurnId: "next-turn" },
      { ...prompt, callId: "next-call" },
      { ...prompt, questions: [{ ...prompt.questions[0], header: "New decision" }] },
      { ...prompt, questions: [{ ...prompt.questions[0], preserveCustomWhitespace: true }] },
    ])
      expect(readQuestionDraft("owner", changed)).toBeUndefined();
  });

  it("refuses the 65th lineage without eviction and reacts to explicit release", () => {
    const notify = vi.fn();
    cleanup.push(subscribeQuestionDraftCapacity(notify));
    const start = getQuestionDraftCapacitySnapshot();
    for (let requestId = 100; requestId < 164; requestId++) {
      const question = own("bounded", { ...prompt, requestId });
      expect(writeQuestionDraft("bounded", question, draft).ok).toBe(true);
    }
    const last = own("bounded", { ...prompt, requestId: 164 });
    expect(writeQuestionDraft("bounded", last, draft)).toEqual({ ok: false, reason: "capacity" });
    expect(readQuestionDraft("bounded", { ...prompt, requestId: 100 })).toEqual(draft);
    expect(readQuestionDraft("bounded", last)).toBeUndefined();
    expect(discardQuestionDraft("bounded", { ...prompt, requestId: 101 }).ok).toBe(true);
    expect(getQuestionDraftCapacitySnapshot()).toBeGreaterThan(start);
    expect(notify).toHaveBeenCalled();
    expect(writeQuestionDraft("bounded", last, draft).ok).toBe(true);
    expect(readQuestionDraft("bounded", { ...prompt, requestId: 100 })).toEqual(draft);
  });

  it("charges mounted empty lineages before input and releases only untouched empties", () => {
    const leases: QuestionDraftReservation[] = [];
    for (let requestId = 200; requestId < 264; requestId++)
      leases.push(reserve("empty", { ...prompt, requestId }));
    const next = own("empty", { ...prompt, requestId: 264 });
    expect(reserveQuestionDraft("empty", next, "empty")).toEqual({ ok: false, reason: "capacity" });
    leases[0].release();
    const accepted = reserveQuestionDraft("empty", next, "empty");
    expect(accepted.ok).toBe(true);
    if (accepted.ok) cleanup.push(accepted.value.release);
    expect(leases[1].write({ step: 0, answers: {}, custom: { scope: "" } }).ok).toBe(true);
    leases[1].release();
    expect(readQuestionDraft("empty", { ...prompt, requestId: 201 })).toEqual({
      step: 0,
      answers: {},
      custom: { scope: "" },
    });
  });

  it("bounds bytes across all lineages and never overwrites a refused existing answer", () => {
    const text = "é".repeat(180_000);
    let accepted = 0;
    for (let requestId = 300; requestId < 340; requestId++) {
      const question = own("bytes", { ...prompt, requestId });
      const result = writeQuestionDraft("bytes", question, { ...draft, custom: { scope: text } });
      if (!result.ok) {
        expect(result.reason).toBe("capacity");
        break;
      }
      accepted++;
    }
    expect(accepted).toBeGreaterThan(1);
    expect(accepted).toBeLessThan(QUESTION_DRAFT_LIMITS.lineages);
    const first = { ...prompt, requestId: 300 };
    expect(
      writeQuestionDraft("bytes", first, {
        ...draft,
        custom: { scope: "x".repeat(QUESTION_DRAFT_LIMITS.lineageBytes) },
      }),
    ).toEqual({ ok: false, reason: "size" });
    expect(readQuestionDraft("bytes", first)?.custom.scope).toBe(text);
    expect(writeQuestionDraft("bytes", first, draft).ok).toBe(true);
    const next = own("bytes", { ...prompt, requestId: 341 });
    expect(writeQuestionDraft("bytes", next, { ...draft, custom: { scope: text } }).ok).toBe(true);
  });

  it("does not invoke invalid getters, normalize Unicode or drop a prior answer", () => {
    own("invalid");
    writeQuestionDraft("invalid", prompt, draft);
    const getter = vi.fn(() => "unexpected");
    const custom = Object.defineProperty({}, "scope", { enumerable: true, get: getter });
    expect(writeQuestionDraft("invalid", prompt, { ...draft, custom })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(
      writeQuestionDraft("invalid", prompt, { ...draft, custom: { scope: "\ud800" } }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(readQuestionDraft("invalid", prompt)).toEqual(draft);
  });

  it("retains sending and unknown data until authoritative resolution, never ordinary discard", () => {
    const lease = reserve("pending");
    expect(lease.write({ ...draft, delivery: "sending", pendingAction: "answer" }).ok).toBe(true);
    lease.release();
    expect(discardQuestionDraft("pending", prompt)).toEqual({ ok: false, reason: "pending" });
    expect(lease.write({ ...draft, delivery: "unknown", pendingAction: "answer" }).ok).toBe(true);
    expect(writeQuestionDraft("pending", prompt, draft)).toEqual({ ok: false, reason: "pending" });
    expect(discardQuestionDraft("pending", prompt)).toEqual({ ok: false, reason: "pending" });
    const replacement = {
      ...prompt,
      questions: [{ ...prompt.questions[0], prompt: "Different meaning" }],
    };
    expect(reserveQuestionDraft("pending", replacement, "pending")).toEqual({
      ok: false,
      reason: "pending",
    });
    expect(readQuestionDraft("pending", prompt)?.delivery).toBe("unknown");
    resolveQuestionDraft("pending", replacement);
    expect(readQuestionDraft("pending", prompt)).toBeUndefined();
    expect(lease.current()).toBe(false);
  });

  it("keeps semantic prompt ABA separate while transport feedback refreshes the same lineage", () => {
    const withOptions = own("semantic", {
      ...prompt,
      questions: [
        {
          ...prompt.questions[0],
          options: [{ id: "a", label: "A", description: "Original", literal: true }],
        },
      ],
    });
    const changed = own("semantic", {
      ...withOptions,
      questions: [
        {
          ...withOptions.questions[0],
          options: [{ ...withOptions.questions[0].options[0], description: "Changed consequence" }],
        },
      ],
    });
    writeQuestionDraft("semantic", withOptions, draft);
    expect(questionDraftKey("semantic", changed)).not.toBe(
      questionDraftKey("semantic", withOptions),
    );
    expect(readQuestionDraft("semantic", changed)).toBeUndefined();
    writeQuestionDraft("semantic", changed, { ...draft, custom: { scope: "different answer" } });
    expect(readQuestionDraft("semantic", withOptions)).toEqual(draft);
    const feedback = {
      ...withOptions,
      delivery: "failed" as const,
      error: "Transport failed",
      autoResolveAt: 123,
    };
    expect(questionDraftKey("semantic", feedback)).toBe(questionDraftKey("semantic", withOptions));
    expect(readQuestionDraft("semantic", feedback)).toEqual(draft);
    resolveQuestionDraft("semantic", withOptions);
    expect(readQuestionDraft("semantic", changed)).toBeUndefined();
  });

  it("does not reuse a question draft across distinct occurrences", () => {
    const original = { ...prompt, occurrenceId: "occurrence-a" };
    const replacement = { ...prompt, occurrenceId: "occurrence-b" };
    expect(questionDraftKey("scope", original)).not.toBe(questionDraftKey("scope", replacement));
  });

  it("retains original Parent ownership, exact oldest bytes and invalidates captures on discard", async () => {
    const stops: (() => void)[] = [];
    for (let requestId = 400; requestId < 464; requestId++) {
      const question = own("cache", { ...prompt, requestId });
      const stop = associateQuestionDraft("cache", question, "logical-root");
      if (stop) {
        stops.push(stop);
        cleanup.push(stop);
      }
      expect(
        writeQuestionDraft("cache", question, {
          ...draft,
          custom: { scope: ` ${requestId}\r\n😀 ` },
        }).ok,
      ).toBe(true);
    }
    for (const stop of stops) stop();
    const overflow = own("cache", { ...prompt, requestId: 464 });
    expect(associateQuestionDraft("cache", overflow, "foreign-root")).toBeUndefined();
    const captured = await captureParentInputs("logical-root");
    cleanup.push(captured.release);
    expect(captured.snapshots).toHaveLength(64);
    expect(captured.snapshots[0].snapshot.draft).toMatchObject({
      custom: { scope: " 400\r\n😀 " },
    });
    expect(captured.current()).toBe(true);
    expect((await captureParentInputs("foreign-root")).snapshots).toEqual([]);
    discardQuestionDraft("cache", { ...prompt, requestId: 400 });
    expect(captured.current()).toBe(false);
  });

  it("allows only original admitted cache continuations during closure and keeps explicit resolution external", async () => {
    const lease = reserve("closed-cache", prompt, "closed-root");
    lease.write(draft);
    const close = beginParentInputClosure("closed-root", { owner: {}, timeoutMs: 1000 });
    cleanup.push(close.release);
    expect(lease.write({ ...draft, custom: { scope: "fresh forbidden" } })).toEqual({
      ok: false,
      reason: "closed",
    });
    const cut = await close.capture();
    cleanup.push(cut.release);
    expect(cut.current()).toBe(true);
    resolveQuestionDraft("closed-cache", prompt);
    expect(cut.current()).toBe(false);
    expect(lease.current()).toBe(false);
  });

  it("keeps legacy unscoped writes ephemeral and private empty StrictMode owners independent", () => {
    expect(writeQuestionDraft(undefined, prompt, draft).ok).toBe(true);
    expect(readQuestionDraft(undefined, prompt)).toBeUndefined();
    const owner = {};
    const first = reserveQuestionDraft(undefined, prompt, undefined, owner);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    first.value.release();
    const replay = reserveQuestionDraft(undefined, prompt, undefined, owner);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.read()).toEqual({ step: 0, answers: {}, custom: {} });
      replay.value.release();
    }
  });
});
