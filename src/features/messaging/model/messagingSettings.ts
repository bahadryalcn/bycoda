/**
 * Asks the app shell to open Settings > Integrations on the messaging accounts.
 * The shell owns the settings surface; features only request it, like the MCP settings event.
 */
export const OPEN_MESSAGING_SETTINGS_EVENT = "bycoda:open-messaging-settings";

export function openMessagingSettings(): void {
  window.dispatchEvent(new Event(OPEN_MESSAGING_SETTINGS_EVENT));
}
