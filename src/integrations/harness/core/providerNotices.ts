import { t } from "../../../shared/i18n/core";

/**
 * Application-owned status and error copy that several provider adapters emit.
 * Each function translates at call time so a row follows the language chosen
 * when it is emitted. Provider text (error details, tool names, model ids)
 * is never a message key; pass it as a `{pN}` value or append it untouched.
 */

/** A queued message was stopped before the provider received it. */
export function messageStoppedBeforeSentText(): string {
  return t("The message was stopped before it was sent.");
}

/** The saved provider conversation could not be resumed; the app rebuilds context. */
export function savedConversationUnavailableText(): string {
  return t(
    "The saved provider conversation is unavailable. Starting a new session; the app will restore conversation context.",
  );
}

/** Compaction failed; `reason` is the provider's own diagnostic, kept verbatim. */
export function compactionFailedText(reason?: string): string {
  return reason
    ? t("Could not compact context: {p0}", { p0: reason })
    : t("Could not compact context");
}

/** A follow-up arrived after the provider turn it targeted had ended. */
export function turnFinishedFollowUpText(): string {
  return t("The previous turn has finished. Send this follow-up as a new message.");
}
