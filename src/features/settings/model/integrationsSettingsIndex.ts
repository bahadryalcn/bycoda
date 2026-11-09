import { t } from "../../../shared/i18n/core";
import { isPausedMessagingProvider } from "../../messaging/public/messagingProviders";
import type { SettingsEntry } from "./settings";

/** Searchable Integrations cards; each `id` is a provider tab and its card's setting id. */
export const INTEGRATIONS_SETTINGS_INDEX: SettingsEntry[] = [
  ["github", "GitHub", "gh cli connect pull request sign in inbox"],
  ["gitlab", "GitLab", "token self-managed merge request connect inbox"],
  [
    "azuredevops",
    "Azure DevOps",
    "azure devops boards repos pull request pat organization connect",
  ],
  ["jira", "Jira", "atlassian cloud site email api token issues projects connect"],
  ["linear", "Linear", "api key issues teams connect"],
  [
    "email",
    "Email",
    "mail gmail google sign in yahoo icloud imap smtp app password inbox reply e-posta",
  ],
  ["slack", "Slack", "sign in bot token xoxb workspace channel direct message reply"],
  ["discord", "Discord", "bot token channel id server message reply"],
  ["teams", "Microsoft Teams", "teams microsoft chat office 365 sign in device code reply"],
]
  // Paused messaging providers keep their entries but are not offered.
  .filter(([id]) => !isPausedMessagingProvider(id!))
  .map(([id, label, keywords]) => ({
    id: id!,
    section: "integrations" as const,
    get label() {
      return t(label!);
    },
    keywords,
  }));

/** Labels of controls inside an Integrations card, searched in both UI and source language. */
export const INTEGRATIONS_CONTROL_LABELS: Record<string, readonly string[]> = {
  jira: ["Inbox scope", "Refresh boards", "Account configuration"],
  linear: ["Inbox scope", "Refresh teams", "Account configuration"],
  gitlab: ["Account configuration", "Save and test connection"],
  azuredevops: ["Account configuration", "Save and test connection"],
  email: [
    "Add account",
    "Email address",
    "Sign in with Google",
    "Password or app password",
    "Server settings",
  ],
  slack: ["Sign in with Slack", "Slack bot token", "Add workspace"],
  discord: ["Discord bot token", "Channel IDs"],
  teams: ["Sign in with Microsoft", "Tenant"],
};
