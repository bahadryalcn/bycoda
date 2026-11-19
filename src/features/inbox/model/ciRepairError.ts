import { safeErrorDetail } from "../../../integrations/harness/core/errorDetail";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";

/** Why a CI repair run could not start in the chosen project chat. */
export type CiRepairStartErrorCode =
  /** The pull request has no local project to run in. */
  | "projectRequired"
  /** The chosen chat is gone, belongs to another project, or cannot take a repair prompt. */
  | "chatMismatch"
  /** The chosen chat is running, switching provider or preparing a handoff. */
  | "chatBusy"
  /** The signed-in account changed after the checks were loaded. */
  | "accountChanged";

/**
 * A refused CI repair start with a stable `code`. `message` stays the English sentence for logs and
 * tests; the repair form calls `presentCiRepairError` instead of rendering it.
 */
export class CiRepairStartError extends Error {
  readonly code: CiRepairStartErrorCode;

  constructor(code: CiRepairStartErrorCode, message: string) {
    super(message);
    this.name = "CiRepairStartError";
    this.code = code;
  }
}

/**
 * The line the repair form shows for a failed start, in the current language. Refusals get a
 * translated sentence; any other failure (evidence loading, submit) gets a translated summary
 * followed by the original text as redacted, bounded detail.
 */
export function presentCiRepairError(reason: unknown): string {
  if (reason instanceof CiRepairStartError) {
    switch (reason.code) {
      case "projectRequired":
        return t("Choose a local project for this PR first.");
      case "chatMismatch":
        return t("Choose a chat from this project.");
      case "chatBusy":
        return t("This chat is busy. Choose another chat or start a new one.");
      case "accountChanged":
        return t("Account changed; reload checks before repairing.");
    }
  }
  const summary = t("Could not start the CI repair.");
  const detail = safeErrorDetail(errorText(reason ?? ""));
  return detail ? `${summary} ${detail}` : summary;
}
