import type { t as appT } from "../../../shared/i18n";

/**
 * Button labels of owner prompts come from the native side as English text. The fixed set the
 * app sends is translated here; any other text passes through unchanged.
 */
export function ownerPromptLabel(t: typeof appT, label: string): string {
  switch (label) {
    case "Allow":
      return t("Allow");
    case "Allow this read":
      return t("Allow this read");
    case "Approve exact delegation":
      return t("Approve exact delegation");
    case "Approve exact operation":
      return t("Approve exact operation");
    case "Approve this exact operation":
      return t("Approve this exact operation");
    case "Approve this operation":
      return t("Approve this operation");
    case "Approve this tool":
      return t("Approve this tool");
    case "Cancel":
      return t("Cancel");
    case "Rebuild protection":
      return t("Rebuild protection");
    case "Run this exact command":
      return t("Run this exact command");
    case "Save secret":
      return t("Save secret");
    default:
      return label;
  }
}
