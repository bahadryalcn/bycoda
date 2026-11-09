import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import { applyHarnessEvent, applyHarnessEvents } from "./apply";
import type { HarnessEvent } from "./types";

function requested(
  occurrenceId = createApprovalOccurrenceId(),
): Extract<HarnessEvent, { type: "approval.requested" }> {
  return {
    type: "approval.requested",
    requestId: 7,
    occurrenceId,
    callId: "reused-provider-call",
    title: "Original command",
    kind: "execute",
  };
}

it("preserves source nonce and treats exact replay as the same original request, including after resolution", () => {
  const event = requested();
  const first = applyHarnessEvent(newSession("codex", "/repo"), event);
  expect(first.blocks[0].approval?.occurrenceId).toBe(event.occurrenceId);
  expect(applyHarnessEvent(first, event)).toBe(first);
  const resolved = applyHarnessEvent(first, {
    type: "approval.resolved",
    requestId: 7,
    occurrenceId: event.occurrenceId,
    decision: "allow",
  });
  expect(applyHarnessEvent(resolved, { ...event })).toBe(resolved);
});

it("keeps old history when a provider reuses both request ID and call ID, and resolves only the named occurrence", () => {
  const a = requested(),
    b = requested();
  let session = applyHarnessEvents(newSession("codex", "/repo"), [
    a,
    { type: "approval.resolved", requestId: 7, occurrenceId: a.occurrenceId, decision: "allow" },
    b,
  ]);
  expect(session.blocks).toHaveLength(2);
  session = applyHarnessEvent(session, {
    type: "approval.resolved",
    requestId: 7,
    occurrenceId: b.occurrenceId,
    decision: "deny",
  });
  expect(session.blocks.map((block) => block.approval)).toEqual([
    { requestId: 7, occurrenceId: a.occurrenceId, decided: "allow" },
    { requestId: 7, occurrenceId: b.occurrenceId, decided: "deny" },
  ]);
});

it("does not apply a delayed old resolution to the new same-ID request", () => {
  const a = requested(),
    b = requested();
  const current = applyHarnessEvents(newSession("codex", "/repo"), [a, b]);
  const resolved = applyHarnessEvent(current, {
    type: "approval.resolved",
    requestId: 7,
    occurrenceId: a.occurrenceId,
    decision: "cancelled",
  });
  expect(resolved.blocks[0].approval?.decided).toBe("cancelled");
  expect(resolved.blocks[1].approval?.decided).toBeUndefined();
  expect(
    applyHarnessEvent(resolved, {
      type: "approval.resolved",
      requestId: 7,
      occurrenceId: createApprovalOccurrenceId(),
      decision: "allow",
    }),
  ).toBe(resolved);
});

it("holds ambiguous legacy resolutions and never rewrites a previous decided request", () => {
  const a = requested(),
    b = requested();
  const ambiguous = applyHarnessEvents(newSession("codex", "/repo"), [a, b]);
  expect(
    applyHarnessEvent(ambiguous, { type: "approval.resolved", requestId: 7, decision: "deny" }),
  ).toBe(ambiguous);
  const oldResolved = applyHarnessEvent(ambiguous, {
    type: "approval.resolved",
    requestId: 7,
    occurrenceId: a.occurrenceId,
    decision: "allow",
  });
  const result = applyHarnessEvent(oldResolved, {
    type: "approval.resolved",
    requestId: 7,
    decision: "deny",
  });
  expect(result.blocks.map((block) => block.approval?.decided)).toEqual(["allow", "deny"]);
});

it("refuses malformed source provenance without replacing it", () => {
  const current = newSession("codex", "/repo");
  expect(() => applyHarnessEvent(current, requested("not-a-source-nonce"))).toThrow(
    "Invalid approval occurrence",
  );
  expect(() =>
    applyHarnessEvent(current, {
      type: "approval.resolved",
      requestId: 7,
      occurrenceId: "not-a-source-nonce",
      decision: "allow",
    }),
  ).toThrow("Invalid approval occurrence");
});
