import { safeErrorDetail } from "../../../integrations/harness/core/errorDetail";
import { t } from "../../../shared/i18n";

/** Why a side conversation stopped before an answer; the sheet picks the sentence from this. */
export const BTW_ERROR_CODES = [
  /** The source chat has no project working directory to run in. */
  "workingDirectoryRequired",
  /** The Codex side thread has no usable model. */
  "codexModelUnavailable",
  /** The account that owns the provider thread was removed or is unknown. */
  "accountUnavailable",
  /** The completed turn this question is anchored to was removed. */
  "turnUnavailable",
  /** The app reloaded while the request was running. */
  "interrupted",
  /** The provider finished without any answer text. */
  "emptyAnswer",
] as const;

export type BtwErrorCode = (typeof BTW_ERROR_CODES)[number];

export function isBtwErrorCode(value: unknown): value is BtwErrorCode {
  return BTW_ERROR_CODES.includes(value as BtwErrorCode);
}

/**
 * A side conversation refusal with a stable `code`. `message` stays the English sentence for logs
 * and tests; the sheet presents `code`, never `message`.
 */
export class BtwThreadError extends Error {
  readonly code: BtwErrorCode;

  constructor(code: BtwErrorCode, message: string) {
    super(message);
    this.name = "BtwThreadError";
    this.code = code;
  }
}

/** The code of a typed refusal, or `undefined` for any other thrown value. */
export function btwErrorCodeOf(error: unknown): BtwErrorCode | undefined {
  return error instanceof BtwThreadError ? error.code : undefined;
}

/**
 * The line the side-question sheet shows for a failed thread, in the current language. A stored
 * code gets its translated sentence. Without one (a provider failure, or a thread saved before
 * codes existed) the translated generic sentence is followed by the stored text as redacted,
 * bounded detail, so the provider's own explanation stays visible.
 */
export function presentBtwThreadError(
  thread: { error?: string; errorCode?: BtwErrorCode },
  providerTitle: string,
): string {
  switch (thread.errorCode) {
    case "workingDirectoryRequired":
      return t("A project working directory is required for this question.");
    case "codexModelUnavailable":
      return t("The selected Codex model is unavailable.");
    case "accountUnavailable":
      return t(
        "The account owning this side conversation is unavailable or unknown. Start a new side conversation to continue with the current account.",
      );
    case "turnUnavailable":
      return t("The completed turn is no longer available.");
    case "interrupted":
      return t("This by-the-way request was interrupted before reload.");
    case "emptyAnswer":
      return t("{p0} returned an empty side answer.", { p0: providerTitle });
    case undefined:
      break;
  }
  const summary = t("{p0} could not answer this side question.", { p0: providerTitle });
  const detail = safeErrorDetail(thread.error);
  return detail ? `${summary} ${detail}` : summary;
}
