export const NOTIFICATION_SEEN_KEY = "bycoda.notifications.seenAt.v1";
export const NOTIFICATION_SEEN_EVENT = "bycoda:notification-seen-change";

/** Used while storage is unavailable so the marker still works for this window. */
let memorySeenAt: number | null = null;

function parseSeenAt(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Epoch ms of the last time the owner looked at notifications. First run (or garbage) stamps "now",
 * so entries logged before this marker existed are not counted as new.
 */
export function readNotificationSeenAt(now?: number): number {
  try {
    const stored = parseSeenAt(localStorage.getItem(NOTIFICATION_SEEN_KEY));
    if (stored !== null) {
      memorySeenAt = stored;
      return stored;
    }
    const initial = memorySeenAt ?? now ?? Date.now();
    localStorage.setItem(NOTIFICATION_SEEN_KEY, String(initial));
    memorySeenAt = initial;
    return initial;
  } catch {
    memorySeenAt ??= now ?? Date.now();
    return memorySeenAt;
  }
}

/** Moves the marker forward only; notifies subscribers when it changed. */
export function markNotificationsSeen(at?: number): void {
  const current = readNotificationSeenAt();
  const next = Math.max(current, at ?? Date.now());
  if (next === current) return;
  memorySeenAt = next;
  try {
    localStorage.setItem(NOTIFICATION_SEEN_KEY, String(next));
  } catch {
    // Storage is unavailable; the in-memory marker still applies to this window.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATION_SEEN_EVENT));
}

export function subscribeNotificationSeen(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === NOTIFICATION_SEEN_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(NOTIFICATION_SEEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(NOTIFICATION_SEEN_EVENT, onChange);
  };
}

export function countUnseenNotifications(
  entries: readonly { occurredAt: number }[],
  seenAt: number,
): number {
  return entries.filter((entry) => entry.occurredAt > seenAt).length;
}
