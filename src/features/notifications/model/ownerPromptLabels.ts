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

/**
 * Titles of owner prompts come from the native side as "bycoda — <what is asked>". The source
 * prefix is dropped (the row names the conversation or Room instead) and the fixed set the app
 * sends is translated; any other text passes through unchanged.
 */
export function ownerPromptTitle(t: typeof appT, title: string): string {
  const asked = title.replace(/^bycoda — /, "");
  switch (asked) {
    case "Application operation approval":
      return t("Application operation approval");
    case "Delegated operation":
      return t("Delegated operation");
    case "Desktop action approval":
      return t("Desktop action approval");
    case "Inbox operation approval":
      return t("Inbox operation approval");
    case "Jira read approval":
      return t("Jira read approval");
    case "MCP tool approval":
      return t("MCP tool approval");
    case "Rebuild Room privacy":
      return t("Rebuild Room privacy");
    case "Room delegation":
      return t("Room delegation");
    case "Secret request":
      return t("Secret request");
    case "Task operation approval":
      return t("Task operation approval");
    default:
      return asked;
  }
}
