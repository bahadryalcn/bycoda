import { t } from "../../../shared/i18n/core";
import type { SettingsSectionId } from "./settings";

/**
 * Rail buckets. `account` is not a list group: the rail shows it as the avatar row at the
 * bottom of the list and of the in-dialog navigation.
 */
export type SettingsGroupId =
  | "app"
  | "agents"
  | "tools"
  | "code"
  | "connections"
  | "about"
  | "account";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  {
    id: "app",
    get label() {
      return t("App");
    },
  },
  {
    id: "agents",
    get label() {
      return t("Agents");
    },
  },
  {
    id: "tools",
    get label() {
      return t("Tools");
    },
  },
  {
    id: "code",
    get label() {
      return t("Code");
    },
  },
  {
    id: "connections",
    get label() {
      return t("Connections");
    },
  },
  {
    id: "about",
    get label() {
      return t("About");
    },
  },
  {
    id: "account",
    get label() {
      return t("Account");
    },
  },
];

/** Order of sections inside their group (the group itself is each section's `group`). */
export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = [
  "general",
  "appearance",
  "chat",
  "voice",
  "notifications",
  "permissions",
  "keybindings",
  "terminal",
  "groupLock",
  "providers",
  "usage",
  "work",
  "crews",
  "skills",
  "mcp",
  "secrets",
  "tools",
  "workspace",
  "worktrees",
  "connections",
  "integrations",
  "archive",
  "policies",
  "account",
];
