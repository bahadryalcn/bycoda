import { expect, it } from "vitest";
import {
  approvalOccurrenceForEvent,
  createApprovalOccurrenceId,
  isApprovalOccurrenceId,
} from "./approvalOccurrence";

it("issues a canonical occurrence for the source event and preserves it only for that actual event", () => {
  const first = {},
    second = {};
  const value = approvalOccurrenceForEvent(first);
  expect(isApprovalOccurrenceId(value)).toBe(true);
  expect(approvalOccurrenceForEvent(first)).toBe(value);
  expect(approvalOccurrenceForEvent(second)).not.toBe(value);
  expect(approvalOccurrenceForEvent({ occurrenceId: value })).toBe(value);
  expect(createApprovalOccurrenceId()).not.toBe(value);
});

it("refuses malformed supplied provenance rather than minting a replacement", () => {
  for (const occurrenceId of [
    "",
    "request-1",
    "00000000-0000-0000-0000-000000000000",
    " " + createApprovalOccurrenceId(),
    1,
    null,
  ]) {
    expect(isApprovalOccurrenceId(occurrenceId)).toBe(false);
    expect(() => approvalOccurrenceForEvent({ occurrenceId })).toThrow(
      "Invalid approval occurrence",
    );
  }
});
