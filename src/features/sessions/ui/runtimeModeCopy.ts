import type { t as Translate } from "../../../shared/i18n";
import type { RuntimeMode } from "../model/session";

/**
 * Localized name and one-line meaning of an access mode. Literal `t()` keys keep the locale
 * extractor aware of them; `RUNTIME_MODE_LABEL` / `RUNTIME_MODE_HINT` stay the English source.
 */
export function runtimeModeCopy(
  t: typeof Translate,
  mode: RuntimeMode,
): { label: string; hint: string } {
  switch (mode) {
    case "supervised":
      return { label: t("Supervised"), hint: t("Ask before commands and file changes.") };
    case "auto-accept-edits":
      return {
        label: t("Auto-accept edits"),
        hint: t("Auto-approve edits, ask before other actions."),
      };
    case "auto":
      return { label: t("Auto"), hint: t("An AI reviewer can approve or deny actions.") };
    case "full-access":
      return {
        label: t("Full access"),
        hint: t(
          "Allow commands, edits, and supported MCP confirmations in non-plan turns without prompts.",
        ),
      };
  }
}
