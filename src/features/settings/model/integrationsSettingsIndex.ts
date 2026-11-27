import { t } from "../../../shared/i18n/core";
import { isPausedMessagingProvider } from "../../messaging/public/messagingProviders";
import type { SettingsEntry } from "./settings";

/** Searchable Integrations cards; each `id` is a provider tab and its card's setting id. */
const INTEGRATION_CARDS: [id: string, label: () => string, keywords: string][] = [
  ["github", () => t("GitHub"), "gh cli connect pull request sign in inbox"],
  ["gitlab", () => t("GitLab"), "token self-managed merge request connect inbox"],
  [
    "azuredevops",
    () => t("Azure DevOps"),
    "azure devops boards repos pull request pat organization connect",
  ],
  ["jira", () => t("Jira"), "atlassian cloud site email api token issues projects connect"],
  ["linear", () => t("Linear"), "api key issues teams connect"],
  [
    "email",
    () => t("Email"),
    "mail gmail google sign in yahoo icloud imap smtp app password inbox reply e-posta",
  ],
  ["slack", () => t("Slack"), "sign in bot token xoxb workspace channel direct message reply"],
  ["discord", () => t("Discord"), "bot token channel id server message reply"],
  [
    "teams",
    () => t("Microsoft Teams"),
    "teams microsoft chat office 365 sign in device code reply",
  ],
];

export const INTEGRATIONS_SETTINGS_INDEX: SettingsEntry[] = INTEGRATION_CARDS
  // Paused messaging providers keep their entries but are not offered.
  .filter(([id]) => !isPausedMessagingProvider(id))
  .map(([id, label, keywords]) => ({
    id,
    section: "integrations" as const,
    get label() {
      return label();
    },
    keywords,
  }));

/** Labels of controls inside an Integrations card, searched in both UI and source language. */
export function integrationsControlLabels(): Record<string, readonly string[]> {
  return {
    jira: [t("Inbox scope"), t("Refresh boards"), t("Account configuration")],
    linear: [t("Inbox scope"), t("Refresh teams"), t("Account configuration")],
    gitlab: [t("Account configuration"), t("Save and test connection")],
    azuredevops: [t("Account configuration"), t("Save and test connection")],
    email: [
      t("Add account"),
      t("Email address"),
      t("Sign in with Google"),
      t("Password or app password"),
      t("Server settings"),
    ],
    slack: [t("Sign in with Slack"), t("Slack bot token"), t("Add workspace")],
    discord: [t("Discord bot token"), t("Channel IDs")],
    teams: [t("Sign in with Microsoft"), t("Tenant")],
  };
}
