import { safeErrorDetail } from "../../integrations/harness/core/errorDetail";
import { t } from "../../shared/i18n";
import { errorText } from "../../shared/lib/errors";

/** What a workspace hook refused or failed at; the presenter picks the sentence from this. */
export type WorkspaceActionErrorCode =
  /** The local Host connection is not ready to refresh a conversation. */
  | "hostUnavailable"
  /** Another window already owns this conversation. */
  | "conversationOpenElsewhere"
  /** A window transfer reached a window that is closing. */
  | "transferDestinationClosed"
  /** The pane under the drop cannot receive a transfer yet. */
  | "transferPanelNotReady"
  /** The drop landed outside any tab group or panel. */
  | "transferNoDropTarget"
  /** The pane under the drop is itself moving to another window. */
  | "transferPanelMoving";

/**
 * A workspace hook failure with a stable `code`. `message` stays the English sentence for logs and
 * the native transfer protocol (`String(error)`), so `name` is left as `Error`; screens call
 * `presentWorkspaceActionError` instead of rendering `message`.
 */
export class WorkspaceActionError extends Error {
  readonly code: WorkspaceActionErrorCode;

  constructor(code: WorkspaceActionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** The translated sentence for a typed failure, or `undefined` for any other thrown value. */
export function workspaceActionErrorSentence(error: unknown): string | undefined {
  if (!(error instanceof WorkspaceActionError)) return undefined;
  switch (error.code) {
    case "hostUnavailable":
      return t("Host unavailable. Try again.");
    case "conversationOpenElsewhere":
      return t("This conversation is already open in another window.");
    case "transferDestinationClosed":
      return t("The destination window is no longer ready.");
    case "transferPanelNotReady":
      return t("This panel is not ready to receive a transfer.");
    case "transferNoDropTarget":
      return t("Drop the tab on a tab group or a panel to place it in this window.");
    case "transferPanelMoving":
      return t("This panel is moving to another window. Wait for that move to finish.");
  }
}

/**
 * The line a screen shows for a failed workspace action, in the current language. A typed failure
 * gets its translated sentence; anything else gets the translated `fallback` followed by the
 * original text as redacted, bounded detail so the cause stays visible without leaking secrets.
 */
export function presentWorkspaceActionError(error: unknown, fallback: string): string {
  const sentence = workspaceActionErrorSentence(error);
  if (sentence) return sentence;
  const detail = safeErrorDetail(errorText(error ?? ""));
  return detail ? `${fallback} ${detail}` : fallback;
}
