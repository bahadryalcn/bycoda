const SHOWN_KEY = "bycoda.notifications.server.shown.v1";
const PENDING_READ_KEY = "bycoda.notifications.server.pendingRead.v1";
const BASE_KEY = "bycoda.notifications.server.base.v1";
const MAX_SHOWN = 200;
const MAX_PENDING = 100;

function readList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Unwritable storage means an item may be announced again after a restart.
  }
}

/** Dedupe keys of server items this computer announced or dropped, newest last. */
export function loadShownKeys(): Set<string> {
  return new Set(readList(SHOWN_KEY));
}

export function rememberShown(keys: readonly string[]): void {
  if (keys.length === 0) return;
  const merged = [...new Set([...readList(SHOWN_KEY), ...keys])];
  writeList(SHOWN_KEY, merged.slice(-MAX_SHOWN));
}

/** Ids of announced items waiting for the user to come back to the app before they count as read. */
export function loadPendingRead(): string[] {
  return readList(PENDING_READ_KEY);
}

export function savePendingRead(ids: readonly string[]): void {
  writeList(PENDING_READ_KEY, [...new Set(ids)].slice(-MAX_PENDING));
}

/** The settings both sides agreed on at the last sync, per user. */
export function loadSyncBase(userId: string): Record<string, string | boolean> | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${BASE_KEY}.${userId}`) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string | boolean>)
      : null;
  } catch {
    return null;
  }
}

export function saveSyncBase(userId: string, base: Record<string, string | boolean>): void {
  try {
    localStorage.setItem(`${BASE_KEY}.${userId}`, JSON.stringify(base));
  } catch {
    // Without a base the next sync treats the account as the source of truth.
  }
}
