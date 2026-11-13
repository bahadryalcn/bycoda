/** Models tabs in display order; anchors are stable across Settings navigation. */
export const MODELS_TABS = ["order", "roles", "chat", "delegation"] as const;
export type ModelsTab = (typeof MODELS_TABS)[number];
export const OPEN_MODELS_SETTINGS_EVENT = "bycoda:open-models-settings";
export const modelsTabAnchor = (tab: ModelsTab) => `models-${tab}`;

export function modelsTabForSetting(id: string | null | undefined): ModelsTab | undefined {
  if (!id) return undefined;
  if (id === "agent-clis" || id === "default-provider") return "chat";
  if (["subagents", "advisor", "subagent-max-effort", "image-models"].includes(id))
    return "delegation";
  return MODELS_TABS.find((tab) => modelsTabAnchor(tab) === id);
}

/** Open Models through the workspace's existing openSettings surface owner. */
export function openModelsSettings(tab: ModelsTab = "order") {
  window.dispatchEvent(new CustomEvent(OPEN_MODELS_SETTINGS_EVENT, { detail: tab }));
}
