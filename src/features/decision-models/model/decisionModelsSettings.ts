/** Asks the app to open Settings > Providers, where Decision models lives. */
export const OPEN_DECISION_MODELS_SETTINGS_EVENT = "bycoda:open-decision-models-settings";

export function openDecisionModelsSettings(): void {
  window.dispatchEvent(new Event(OPEN_DECISION_MODELS_SETTINGS_EVENT));
}
