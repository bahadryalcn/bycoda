import { t } from "../../../shared/i18n";
/** Which moments notify, and whether the taskbar button signals them. */
export type NotificationEventSetting = "finished" | "input" | "failed" | "taskbar";

export const NOTIFICATION_EVENT_SETTINGS: ReadonlyArray<{
  id: NotificationEventSetting;
  label: string;
  description: string;
}> = [
  {
    id: "finished",
    get label() {
      return t("Agent finished");
    },
    get description() {
      return t("A turn ended, or only background commands are left running.");
    },
  },
  {
    id: "input",
    get label() {
      return t("Needs your input");
    },
    get description() {
      return t("An approval or a question is waiting.");
    },
  },
  {
    id: "failed",
    get label() {
      return t("Failed or usage limit");
    },
    get description() {
      return t("A turn errored or the provider's usage limit was reached.");
    },
  },
  {
    id: "taskbar",
    get label() {
      return t("Taskbar badge and flash");
    },
    get description() {
      return t("On Windows, count sessions that need you on the taskbar button.");
    },
  },
];

const KEY = "bycoda.notifications.events.v1";
export const NOTIFICATION_EVENTS_CHANGE = "bycoda:notification-events-change";

/** Every event is on once notifications themselves are enabled. */
export function loadNotificationEvents(): Record<NotificationEventSetting, boolean> {
  const events = { finished: true, input: true, failed: true, taskbar: true };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const id of Object.keys(events) as NotificationEventSetting[]) {
        const value = (parsed as Record<string, unknown>)[id];
        if (typeof value === "boolean") events[id] = value;
      }
    }
  } catch {
    // Unreadable storage keeps the defaults.
  }
  return events;
}

export function saveNotificationEvent(id: NotificationEventSetting, value: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadNotificationEvents(), [id]: value }));
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATION_EVENTS_CHANGE));
}
