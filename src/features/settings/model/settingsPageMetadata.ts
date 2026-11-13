import type { SettingsSectionId } from "./settings";

/**
 * How a page wants to be presented. `bounded`: short preferences and forms in a readable
 * track over the work context. `wide`: collections, tables and analytics that need a
 * usable width. `workspace`: list/detail libraries that own the full height and are
 * the pages worth maximizing. A hint only: the embedding surface decides the geometry
 * and a page never remounts when it changes.
 */
export type SettingsPresentation = "bounded" | "wide" | "workspace";

/** Pages that persist every change themselves; the header says so once. */
export const AUTOMATIC_SAVE_SECTIONS: readonly string[] = [
  "tools",
  "browser",
  "devices",
  "logs",
  "devServers",
  "general",
  "appearance",
  "workspace",
  "chat",
  "voice",
  "terminal",
];

const SETTINGS_PRESENTATION: Record<SettingsSectionId, SettingsPresentation> = {
  tools: "bounded",
  browser: "bounded",
  devices: "bounded",
  logs: "bounded",
  devServers: "bounded",
  general: "bounded",
  appearance: "bounded",
  workspace: "bounded",
  terminal: "bounded",
  chat: "bounded",
  voice: "bounded",
  notifications: "bounded",
  permissions: "bounded",
  groupLock: "bounded",
  policies: "bounded",
  providers: "wide",
  models: "wide",
  work: "wide",
  mcp: "wide",
  connections: "wide",
  inbox: "bounded",
  integrations: "bounded",
  account: "bounded",
  secrets: "bounded",
  crews: "wide",
  keybindings: "wide",
  skills: "workspace",
  archive: "bounded",
  worktrees: "workspace",
};

export function settingsSectionPresentation(id: SettingsSectionId): SettingsPresentation {
  return SETTINGS_PRESENTATION[id] ?? "bounded";
}
