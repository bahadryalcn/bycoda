/** The Providers page tabs, in display order. */
export const PROVIDERS_TABS = ["providers", "defaults", "cli", "models", "decision"] as const;
export type ProvidersTab = (typeof PROVIDERS_TABS)[number];

/** The tab that holds a searched setting; undefined leaves the current tab. */
export function providersTabForSetting(id: string | null): ProvidersTab | undefined {
  if (!id) return undefined;
  if (["models-chat", "default-provider", "agent-clis"].includes(id)) return "defaults";
  if (id === "harness-updates" || id.startsWith("cli-path-")) return "cli";
  if (id === "enabled-models") return "models";
  if (id === "decision-models") return "decision";
  if (
    id === "claude-hooks" ||
    id === "antigravity-account" ||
    id === "provider-accounts" ||
    id.startsWith("terminal-account-profiles") ||
    id.startsWith("acp-")
  ) {
    return "providers";
  }
  return undefined;
}
