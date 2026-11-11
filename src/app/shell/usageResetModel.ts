import type { useT } from "../../shared/i18n";
import type { CodexRateLimitResetOutcome } from "../../features/providers/model/rateLimitsFetch";

/** Same fields as `Date#toLocaleString()` with no options. */
export const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

type TFunction = ReturnType<typeof useT>;

export type ResetActionState =
  | "idle"
  | "confirming"
  | "using"
  | CodexRateLimitResetOutcome
  | "error";

export function resetOutcomeLabel(outcome: CodexRateLimitResetOutcome, t: TFunction): string {
  if (outcome === "reset") return t("Codex usage was reset.");
  if (outcome === "nothingToReset") return t("There’s no active usage to reset.");
  if (outcome === "noCredit") return t("No banked resets are available.");
  return t("That reset was already used.");
}

export function isResetOutcome(value: ResetActionState): value is CodexRateLimitResetOutcome {
  return (
    value === "reset" ||
    value === "nothingToReset" ||
    value === "noCredit" ||
    value === "alreadyRedeemed"
  );
}
