import { redactDiagnosticText } from "@bycoda/account-contracts";
import { stripAnsi } from "../../../shared/lib/ansi";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { t } from "../../../shared/i18n";

/** The step that failed; `updater` is the CLI install, `version check` the verification after it. */
export type HarnessUpdateStage = "updater" | "version check";

/**
 * Structured, not a sentence: the UI words it with `t()` and the harness title. `detail` is the
 * process or probe text, redacted for display and never translated.
 */
export type HarnessUpdateFailure =
  | { kind: "stage"; stage: HarnessUpdateStage; detail: string }
  | { kind: "stillOn"; version: string; detail?: string }
  /** Another window is already updating this binary; nothing was started here. */
  | { kind: "busy" }
  /** The user cancelled the updater; the install is left as the CLI's updater left it. */
  | { kind: "cancelled" };

/** Exact error text `harness_update` returns when the binary is already updating. */
export const HARNESS_UPDATE_BUSY_ERROR = "harness_update: already updating";
/** Exact error text `harness_update` returns after a cancel. */
export const HARNESS_UPDATE_CANCELLED_ERROR = "harness_update: cancelled";

/**
 * Formats the translated headline and redacted process detail for the Details view and toast.
 */
export function describeHarnessUpdateFailure(
  harness: HarnessId,
  failure: HarnessUpdateFailure,
): { headline: string; detail?: string; toastMessage: string } {
  const title = HARNESS_TITLE[harness];
  if (failure.kind === "busy") {
    const headline = t("{p0} is already updating in another window.", { p0: title });
    return { headline, toastMessage: headline };
  }
  if (failure.kind === "cancelled") {
    const headline = t("{p0} update cancelled.", { p0: title });
    return { headline, toastMessage: headline };
  }
  const headline =
    failure.kind === "stillOn"
      ? t("{p0} is still on {p1} after updating.", { p0: title, p1: failure.version })
      : failure.stage === "updater"
        ? t("{p0} could not be updated.", { p0: title })
        : t("{p0} updated, but its version could not be verified.", { p0: title });
  const detail = redactDiagnosticText(stripAnsi(failure.detail ?? "")).trim();
  const oneLine = detail.replace(/\s+/g, " ");
  return {
    headline,
    ...(detail ? { detail } : {}),
    toastMessage: oneLine ? `${headline} ${oneLine}` : headline,
  };
}
