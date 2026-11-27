import { t } from "../../../shared/i18n";
import type { RuntimeMode } from "../../sessions/public/session";

/** The translated access-mode name; call it while rendering so it follows the language. */
export function runtimeModeLabel(mode: RuntimeMode): string {
  switch (mode) {
    case "supervised":
      return t("Supervised");
    case "auto-accept-edits":
      return t("Auto-accept edits");
    case "auto":
      return t("Auto");
    case "full-access":
      return t("Full access");
  }
}

/** The translated one-sentence meaning of an access mode. */
export function runtimeModeHint(mode: RuntimeMode): string {
  switch (mode) {
    case "supervised":
      return t("Ask before commands and file changes.");
    case "auto-accept-edits":
      return t("Auto-approve edits, ask before other actions.");
    case "auto":
      return t("An AI reviewer can approve or deny actions.");
    case "full-access":
      return t(
        "Allow commands, edits, and supported MCP confirmations in non-plan turns without prompts.",
      );
  }
}
