import { expect, vi } from "vitest";
import type { HarnessEvent } from "../core/types";
import { requestedApproval } from "./approvalOccurrence.testSupport";

/** Drive actual adapter source callbacks; inspect the original causal work, never a fabricated row. */
export async function exerciseOverlappingApproval(input: {
  events: HarnessEvent[];
  requestId: number;
  allowBeforeDuplicate: boolean;
  ask: () => () => { pendingCausalWork: number };
  approve: (occurrenceId: string, decision: "allow" | "deny") => void;
  replies: () => unknown[];
  deniedResult: unknown;
  afterResponses?: () => void;
}): Promise<void> {
  const first = input.ask();
  const original = requestedApproval(input.events, input.requestId);
  expect(first().pendingCausalWork).toBeGreaterThan(0);
  if (input.allowBeforeDuplicate) input.approve(original.occurrenceId, "allow");
  // No await: an allow has resolved its Promise, but its deferred continuation has not run.
  const duplicate = input.ask();
  input.approve(original.occurrenceId, "allow");
  await vi.waitFor(() => expect(input.replies()).toHaveLength(2));
  expect(input.replies()).toEqual([
    { outcome: { outcome: "cancelled" } },
    { outcome: { outcome: "cancelled" } },
  ]);
  expect(
    input.events.filter(
      (event) => event.type === "approval.requested" && event.requestId === input.requestId,
    ),
  ).toHaveLength(1);
  expect(input.events).toContainEqual({
    type: "approval.resolved",
    requestId: input.requestId,
    occurrenceId: original.occurrenceId,
    decision: "cancelled",
  });
  input.afterResponses?.();
  await vi.waitFor(() => {
    expect(first().pendingCausalWork).toBe(0);
    expect(duplicate().pendingCausalWork).toBe(0);
  });

  // Once both actual handlers drain, sequential reuse is a new source occurrence.
  const next = input.ask();
  const current = requestedApproval(input.events, input.requestId);
  expect(current.occurrenceId).not.toBe(original.occurrenceId);
  input.approve(original.occurrenceId, "allow");
  await Promise.resolve();
  expect(input.replies()).toHaveLength(2);
  input.approve(current.occurrenceId, "deny");
  await vi.waitFor(() => expect(input.replies()).toHaveLength(3));
  expect(input.replies()[2]).toEqual(input.deniedResult);
  input.afterResponses?.();
  await vi.waitFor(() => expect(next().pendingCausalWork).toBe(0));
}

export async function exerciseApprovalActualWriteLifetime(input: {
  events: HarnessEvent[];
  requestId: number;
  cancelBeforeTimeout: boolean;
  ask: () => () => { pendingCausalWork: number };
  approve: (occurrenceId: string) => void;
  cancel: () => Promise<void>;
  holdWrites: (gate: (() => Promise<void>) | null) => void;
  replies: () => unknown[];
  closesOnUncancelledTimeout?: boolean;
}): Promise<void> {
  const releases: Array<() => void> = [];
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  input.holdWrites(() => new Promise<void>((resolve) => releases.push(resolve)));
  vi.useFakeTimers();
  try {
    const first = input.ask();
    const original = requestedApproval(input.events, input.requestId);
    input.approve(original.occurrenceId);
    await flush();
    expect(releases).toHaveLength(1);
    if (input.cancelBeforeTimeout) await input.cancel();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(first().pendingCausalWork).toBeGreaterThan(0);

    // The waiter has timed out; the actual write is still held in the bridge.
    const duplicate = input.ask();
    await flush();
    const closed = input.closesOnUncancelledTimeout && !input.cancelBeforeTimeout;
    expect(releases).toHaveLength(closed ? 1 : 2);
    expect(
      input.events.filter(
        (event) => event.type === "approval.requested" && event.requestId === input.requestId,
      ),
    ).toHaveLength(1);
    if (!closed) {
      expect(input.replies()[1]).toEqual({ outcome: { outcome: "cancelled" } });
      expect(input.events).toContainEqual({
        type: "approval.resolved",
        requestId: input.requestId,
        occurrenceId: original.occurrenceId,
        decision: "cancelled",
      });
    }

    input.holdWrites(null);
    for (const release of releases) release();
    await flush();
    expect(first().pendingCausalWork).toBe(0);
    expect(duplicate().pendingCausalWork).toBe(0);
  } finally {
    input.holdWrites(null);
    for (const release of releases) release();
    await flush();
    vi.useRealTimers();
  }
}
