/** The Providers page tabs, in display order. */
export const PROVIDERS_TABS = ["providers", "defaults", "models", "decision"] as const;
export type ProvidersTab = (typeof PROVIDERS_TABS)[number];

/** The tab that holds a searched setting; undefined leaves the current tab. */
export function providersTabForSetting(id: string | null): ProvidersTab | undefined {
  if (!id) return undefined;
  if (id === "agent-clis") return "defaults";
  if (id === "enabled-models") return "models";
  if (id === "decision-models") return "decision";
  if (
    id === "harness-updates" ||
    id === "claude-hooks" ||
    id === "antigravity-account" ||
    id === "provider-accounts" ||
    id.startsWith("cli-path-") ||
    id.startsWith("terminal-account-profiles") ||
    id.startsWith("acp-")
  ) {
    return "providers";
  }
  return undefined;
}
