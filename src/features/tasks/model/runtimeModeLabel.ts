import { t } from "../../../shared/i18n";
import type { RuntimeMode } from "../../sessions/public/session";

/** The access mode's name in the current language; one literal key per mode for the locale check. */
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
