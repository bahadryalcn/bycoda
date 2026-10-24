import { describe, expect, it } from "vitest";
import {
  followUpRefusalEvent,
  nextQueueStatus,
  planResume,
  queueState,
  type QueueFacts,
  type ResumeContext,
} from "./queueState";

const row = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  text: id,
  attachments: [],
  ...patch,
});
const idle: ResumeContext = { turnRunning: false, preparing: false, editing: false };

describe("queue state", () => {
  it.each<[string, QueueFacts, unknown]>([
    ["an empty queue", { messages: [], status: "paused" }, { kind: "active" }],
    ["no status", { messages: [row("a")] }, { kind: "active" }],
    ["active", { messages: [row("a")], status: "active" }, { kind: "active" }],
    ["paused by the owner", { messages: [row("a")], status: "paused" }, { kind: "paused" }],
    [
      "paused after a refused head",
      { messages: [row("a")], status: "paused", rejected: true },
      { kind: "held", reason: "rejected" },
    ],
    ["a resume in flight", { messages: [row("a")], status: "resuming" }, { kind: "resuming" }],
    ["restored", { messages: [row("a")], status: "restored" }, { kind: "restored" }],
    [
      "an unconfirmed journal",
      { messages: [row("a")], status: "active", unknownDelivery: true },
      { kind: "held", reason: "unknown" },
    ],
    [
      "a flagged row",
      { messages: [row("a"), row("b", { deliveryUnknown: true })], status: "paused" },
      { kind: "held", reason: "unknown" },
    ],
    [
      "a usage limit",
      { messages: [row("a")], status: "active", usageLimit: true },
      { kind: "held", reason: "usage-limit" },
    ],
    [
      "a conflict",
      { messages: [row("a")], status: "active", conflict: true },
      { kind: "held", reason: "conflict" },
    ],
    [
      "a drain lease held elsewhere",
      { messages: [row("a")], status: "active", leaseHeld: true },
      { kind: "held", reason: "lease" },
    ],
    [
      "a missing attachment",
      {
        messages: [row("a", { attachments: [{ id: "f", name: "f", missing: true }] })],
        status: "paused",
      },
      { kind: "held", reason: "missing-attachment" },
    ],
    [
      "unknown outranks every other hold",
      { messages: [row("a")], unknownDelivery: true, usageLimit: true, leaseHeld: true },
      { kind: "held", reason: "unknown" },
    ],
  ])("%s", (_name, facts, expected) => {
    expect(queueState(facts)).toEqual(expected);
  });
});

describe("queue status transitions", () => {
  it.each([
    ["active", "pause", "paused"],
    ["restored", "pause", "paused"],
    ["active", "reject", "paused"],
    ["active", "unknown", "paused"],
    ["restored", "reject", "restored"],
    ["paused", "resume", "active"],
    ["restored", "resume", "active"],
    ["paused", "resume-start", "resuming"],
    ["resuming", "resume-done", "active"],
    ["resuming", "resume-failed", "paused"],
  ] as const)("%s + %s -> %s", (status, event, expected) => {
    expect(nextQueueStatus(status, event)).toBe(expected);
  });

  it.each(["active", "paused", "restored", "resuming", undefined] as const)(
    "a coordination failure never changes %s",
    (status) => {
      expect(nextQueueStatus(status, "coordination")).toBe(status);
    },
  );

  it("a Stop or another Resume in between keeps its own status when a Resume settles", () => {
    expect(nextQueueStatus("paused", "resume-done")).toBe("paused");
    expect(nextQueueStatus("active", "resume-failed")).toBe("active");
  });
});

describe("Resume plan", () => {
  const plan = (facts: Partial<QueueFacts>, context: Partial<ResumeContext> = {}) =>
    planResume(queueState({ messages: [row("a")], ...facts }), { ...idle, ...context });

  it("always answers: every state has a plan that is not a thrown string", () => {
    // Resume is "set active and wake": never a synthetic "continue" message.
    expect(plan({ status: "paused" })).toEqual({ do: "release" });
    expect(plan({ status: "resuming" })).toEqual({ do: "release" });
    expect(plan({ status: "restored" })).toEqual({ do: "send-head" });
    expect(plan({ status: "active" })).toEqual({ do: "release" });
    expect(plan({ status: "paused", rejected: true })).toEqual({ do: "release" });
    expect(plan({ status: "active", conflict: true })).toEqual({ do: "release" });
    expect(plan({ status: "active", leaseHeld: true })).toEqual({ do: "release" });
  });

  it("asks for the inline delivery choice instead of failing on an unconfirmed send", () => {
    expect(plan({ status: "paused", unknownDelivery: true })).toEqual({ do: "review-delivery" });
    expect(plan({ status: "paused", unknownDelivery: true }, { preparing: true })).toEqual({
      do: "review-delivery",
    });
  });

  it("never plans a continue message, in any state, running or idle", () => {
    const states: Partial<QueueFacts>[] = [
      { status: "paused" },
      { status: "paused", rejected: true },
      { status: "resuming" },
      { status: "active" },
      { status: "active", conflict: true },
      { status: "active", leaseHeld: true },
    ];
    for (const facts of states)
      for (const turnRunning of [false, true])
        expect(plan(facts, { turnRunning })).toEqual({ do: "release" });
  });

  it("does not plan a continue message for a turn that is running here or elsewhere", () => {
    expect(plan({ status: "paused" }, { turnRunning: true })).toEqual({ do: "release" });
    expect(plan({ status: "restored" }, { turnRunning: true })).toEqual({ do: "release" });
  });

  it("explains what blocks it", () => {
    expect(plan({ status: "paused" }, { preparing: true })).toMatchObject({ do: "blocked" });
    expect(plan({ status: "paused", usageLimit: true })).toMatchObject({ do: "blocked" });
    expect(plan({ status: "paused" }, { editing: true })).toMatchObject({ do: "blocked" });
  });
});

describe("a follow-up the host did not take", () => {
  it("holds the queue only for an explicit refusal", () => {
    expect(
      followUpRefusalEvent("Host rejected request: The turn ended before steering arrived"),
    ).toBe("reject");
    expect(followUpRefusalEvent("Host rejected request: steering unavailable")).toBe("reject");
  });
  it("changes nothing when a desktop owns the turn, or when there is no refusal to read", () => {
    expect(
      followUpRefusalEvent(
        "Host rejected request: This desktop-owned turn cannot be redirected through the host. Queue the message or stop it first.",
      ),
    ).toBe("coordination");
    expect(
      followUpRefusalEvent(
        "Host rejected request: LEASE_HELD: This session is running in bycoda on that computer. Wait for it to finish.",
      ),
    ).toBe("coordination");
    expect(followUpRefusalEvent("Host unreachable")).toBe("coordination");
    expect(followUpRefusalEvent(undefined)).toBe("coordination");
  });
});
