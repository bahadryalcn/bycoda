import { errorText } from "../../../shared/lib/errors";
import { t } from "../../../shared/i18n";
import {
  AttachmentFailureError,
  type AttachmentFailure,
} from "../../sessions/public/attachmentFailure";

/** Stable code returned by `quick_composer_capture` when macOS withholds Screen Recording. */
const SCREEN_RECORDING_DENIED = "screen-recording-permission-required";

/** A failure shown in the composer: its copy, and the recovery UI the failure calls for. */
export type QuickNotice = {
  /** The visible sentence (translated): what could not be done, or a warning written for users. */
  title: string;
  /** Raw reason behind the failure; it only appears behind Details. */
  message?: string;
  recovery?: "screen-recording";
};

function attachmentFailureMessage(failure: AttachmentFailure): string {
  switch (failure) {
    case "selection-too-large":
      return t("The selected file list is too large to attach.");
    case "image-too-large":
      return t("That image is too large to attach.");
    case "provider-changed":
      return t(
        "The provider changed before these files were attached. Your selection is kept; try again.",
      );
  }
}

/**
 * Maps a thrown value to the composer notice. Typed failures and the Host's
 * stable capture code choose the copy; any other error shows its own message.
 */
export function captureNotice(reason: unknown): QuickNotice {
  if (reason instanceof AttachmentFailureError) {
    return { title: attachmentFailureMessage(reason.failure) };
  }
  const code = errorText(reason);
  if (code === SCREEN_RECORDING_DENIED) {
    return {
      title: t(
        "Screenshots need Screen Recording access. Review access to set it up, then try again.",
      ),
      recovery: "screen-recording",
    };
  }
  return { title: t("Could not read attachments."), message: code };
}
