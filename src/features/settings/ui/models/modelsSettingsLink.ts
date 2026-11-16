/** Models tabs in display order; anchors are stable across Settings navigation. */
export const MODELS_TABS = ["order", "roles", "chat", "delegation"] as const;
export type ModelsTab = (typeof MODELS_TABS)[number];
export const OPEN_MODELS_SETTINGS_EVENT = "bycoda:open-models-settings";
export const modelsTabAnchor = (tab: ModelsTab) => `models-${tab}`;

/** Open Models through the workspace's existing openSettings surface owner. */
export function openModelsSettings(tab: ModelsTab = "order") {
  window.dispatchEvent(new CustomEvent(OPEN_MODELS_SETTINGS_EVENT, { detail: tab }));
}
