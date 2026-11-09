/** Asks the app to open Settings > Providers. */
export const OPEN_PROVIDER_SETTINGS_EVENT = "bycoda:open-provider-settings";

export function openProviderSettings(): void {
  window.dispatchEvent(new Event(OPEN_PROVIDER_SETTINGS_EVENT));
}
