export const OPEN_USAGE_GUIDE_EVENT = "bycoda:open-usage-guide";

export function openUsageGuide() {
  window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT));
}
