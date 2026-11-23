import { t } from "../../../shared/i18n/core";
import type { SettingsSectionId } from "./settings";

export type SettingsGroupId =
  | "account"
  | "app"
  | "conversation"
  | "models"
  | "workspace"
  | "connections"
  | "privacy"
  | "tools"
  | "help";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  {
    id: "account",
    get label() {
      return t("Account");
    },
  },
  {
    id: "app",
    get label() {
      return t("App");
    },
  },
  {
    id: "conversation",
    get label() {
      return t("Conversation");
    },
  },
  {
    id: "models",
    get label() {
      return t("Models");
    },
  },
  {
    id: "workspace",
    get label() {
      return t("Workspace");
    },
  },
  {
    id: "connections",
    get label() {
      return t("Connections");
    },
  },
  {
    id: "privacy",
    get label() {
      return t("Privacy");
    },
  },
  {
    id: "tools",
    get label() {
      return t("Tools");
    },
  },
  {
    id: "help",
    get label() {
      return t("Help");
    },
  },
];

/** Order of pages within each area, shared by the dialog and rail. */
export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = [
  "account",
  "general",
  "appearance",
  "keybindings",
  "chat",
  "voice",
  "notifications",
  "providers",
  "decisionModels",
  "usage",
  "workspace",
  "terminal",
  "worktrees",
  "connections",
  "integrations",
  "groupLock",
  "permissions",
  "secrets",
  "skills",
  "mcp",
  "tools",
  "policies",
  "archive",
];
