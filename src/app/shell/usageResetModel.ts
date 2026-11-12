import type { useT } from "../../shared/i18n";
import type { CodexRateLimitResetOutcome } from "../../features/providers/model/rateLimitsFetch";
import type { RateLimitResetKind } from "../../features/providers/model/rateLimits";

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

export function resetOutcomeLabel(
  outcome: CodexRateLimitResetOutcome,
  t: TFunction,
  provider?: string,
): string {
  if (outcome === "reset") {
    return provider === "claude" ? t("Claude usage was reset.") : t("Codex usage was reset.");
  }
  if (outcome === "nothingToReset") return t("There’s no active usage to reset.");
  if (outcome === "noCredit") return t("No banked resets are available.");
  return t("That reset was already used.");
}

/** Short row name for a Claude reset; the provider title is a long campaign line. */
export function resetKindLabel(kind: RateLimitResetKind, t: TFunction): string {
  if (kind === "full") return t("Full limit reset");
  if (kind === "fable") return t("Fable limit reset");
  if (kind === "weekly") return t("Weekly limit reset");
  return t("5-hour limit reset");
}

export function isResetOutcome(value: ResetActionState): value is CodexRateLimitResetOutcome {
  return (
    value === "reset" ||
    value === "nothingToReset" ||
    value === "noCredit" ||
    value === "alreadyRedeemed"
  );
}
