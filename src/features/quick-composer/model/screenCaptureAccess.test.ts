import { expect, it } from "vitest";
import { AttachmentFailureError } from "../../sessions/model/attachmentFailure";
import { captureNotice } from "./screenCaptureAccess";

const screenRecordingCopy =
  "Screenshots need Screen Recording access. Review access to set it up, then try again.";

it("maps a typed selection failure to localized copy, not its diagnostic text", () => {
  expect(
    captureNotice(
      new AttachmentFailureError(
        "selection-too-large",
        "The selected file paths exceed retained attachment capacity.",
      ),
    ),
  ).toEqual({ title: "The selected file list is too large to attach." });
});

it("maps typed image and provider failures to their own copy", () => {
  expect(
    captureNotice(new AttachmentFailureError("image-too-large", "The clipboard image exceeds.")),
  ).toEqual({ title: "That image is too large to attach." });
  expect(
    captureNotice(new AttachmentFailureError("provider-changed", "The provider changed.")),
  ).toEqual({
    title:
      "The provider changed before these files were attached. Your selection is kept; try again.",
  });
});

it("classifies the Host screen-recording code as recoverable, whatever its wording", () => {
  expect(captureNotice("screen-recording-permission-required")).toEqual({
    title: screenRecordingCopy,
    recovery: "screen-recording",
  });
  expect(captureNotice(new Error("screen-recording-permission-required")).recovery).toBe(
    "screen-recording",
  );
});

it("does not treat text equal to the recovery copy as a screen-recording block", () => {
  expect(captureNotice(new Error(screenRecordingCopy)).recovery).toBeUndefined();
});

it("shows any other failure's own message without a recovery action", () => {
  expect(captureNotice(new Error("Capture failed"))).toEqual({
    title: "Could not read attachments.",
    message: "Capture failed",
  });
});
