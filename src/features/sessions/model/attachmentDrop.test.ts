import { expect, it } from "vitest";
import { attachmentDropVerdict } from "./attachmentDrop";
import { MAX_ATTACHMENTS } from "./attachments";

it("says what releasing the files does", () => {
  expect(attachmentDropVerdict(0, 0, null)).toEqual({ kind: "accept", label: "Attach files" });
  expect(attachmentDropVerdict(1, 0, null)).toEqual({ kind: "accept", label: "Attach 1 file" });
  expect(attachmentDropVerdict(4, 2, null)).toEqual({ kind: "accept", label: "Attach 4 files" });
});

it("says how many fit when the draft would overflow, and blocks a full draft", () => {
  expect(attachmentDropVerdict(25, 5, null)).toEqual({
    kind: "accept",
    label: `Attach ${MAX_ATTACHMENTS - 5} of 25 files`,
  });
  expect(attachmentDropVerdict(1, MAX_ATTACHMENTS, null)).toEqual({
    kind: "blocked",
    reason: `Attachment limit reached (${MAX_ATTACHMENTS})`,
  });
});

it("gives a reason for every block", () => {
  for (const [block, reason] of [
    ["unsupported", "This provider does not support attachments"],
    ["remote", "Explorer files cannot be attached to a remote session"],
    ["unavailable", "Attachments cannot be changed right now"],
    ["reading", "Wait for the current attachments to finish loading"],
  ] as const)
    expect(attachmentDropVerdict(2, 0, block)).toEqual({ kind: "blocked", reason });
});
