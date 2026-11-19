import { afterEach, beforeEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../shared/i18n";
import {
  WorkspaceActionError,
  presentWorkspaceActionError,
  workspaceActionErrorSentence,
  type WorkspaceActionErrorCode,
} from "./workspaceActionError";
import { rejectedTransferMessage, unknownTransferResultMessage } from "./windowTransferNotice";

beforeEach(async () => {
  await setLanguagePreference("en");
});
afterEach(async () => {
  await setLanguagePreference("en");
});

const CODES: WorkspaceActionErrorCode[] = [
  "hostUnavailable",
  "conversationOpenElsewhere",
  "transferDestinationClosed",
  "transferPanelNotReady",
  "transferNoDropTarget",
  "transferPanelMoving",
];

it("presents every code as a sentence that does not depend on the English message", async () => {
  const english = CODES.map((code) =>
    workspaceActionErrorSentence(new WorkspaceActionError(code, "raw english text")),
  );
  expect(english.every((sentence) => sentence && sentence !== "raw english text")).toBe(true);
  await setLanguagePreference("tr");
  const turkish = CODES.map((code) =>
    workspaceActionErrorSentence(new WorkspaceActionError(code, "raw english text")),
  );
  turkish.forEach((sentence, index) => expect(sentence).not.toBe(english[index]));
});

it("keeps the English message and the Error name for logs and the native transfer protocol", () => {
  const error = new WorkspaceActionError(
    "transferPanelNotReady",
    "This panel is not ready to receive a transfer.",
  );
  expect(String(error)).toBe("Error: This panel is not ready to receive a transfer.");
});

it("translates a typed transfer refusal inside the rejection notice", async () => {
  const error = new WorkspaceActionError(
    "transferPanelNotReady",
    "This panel is not ready to receive a transfer.",
  );
  expect(rejectedTransferMessage(error)).toBe(
    "The tab could not be placed in this window. This panel is not ready to receive a transfer. It stays in its original window.",
  );
  await setLanguagePreference("tr");
  expect(rejectedTransferMessage(error)).not.toContain("This panel");
  expect(unknownTransferResultMessage()).not.toContain("transfer result");
});

it("shows an untyped transfer reason only as redacted, bounded text", () => {
  const message = rejectedTransferMessage(
    new Error("native failed token=abc123secretvalue see https://example.com/log?id=1"),
  );
  expect(message).not.toContain("abc123secretvalue");
  expect(message).not.toContain("https://");
  expect(message).toContain("native failed");
});

it("keeps an untyped cause as redacted detail under the translated fallback", () => {
  expect(
    presentWorkspaceActionError(new Error("socket closed"), "Could not open this conversation."),
  ).toBe("Could not open this conversation. socket closed");
  expect(presentWorkspaceActionError("", "Could not open this conversation.")).toBe(
    "Could not open this conversation.",
  );
  expect(
    presentWorkspaceActionError(
      new Error("failed token=abc123secretvalue"),
      "Could not stop this conversation.",
    ),
  ).not.toContain("abc123secretvalue");
});
