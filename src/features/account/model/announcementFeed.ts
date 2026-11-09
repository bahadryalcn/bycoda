import type { Announcement } from "@bycoda/account-contracts";

const DISMISSED_KEY = "bycoda.account.announcements.dismissed.v1";
const MAX_REMEMBERED = 200;
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

export type AnnouncementSnapshot = {
  items: readonly Announcement[];
  /** Ids the user dismissed on this computer. */
  dismissed: readonly string[];
};

type FeedStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): FeedStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readDismissed(storage: FeedStorage | null): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Critical first, then newest first. */
export function sortAnnouncements(items: readonly Announcement[]): Announcement[] {
  return [...items].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

/** Active announcements the user has not dismissed here. */
export function unseenAnnouncements(snapshot: AnnouncementSnapshot): Announcement[] {
  const seen = new Set(snapshot.dismissed);
  return sortAnnouncements(snapshot.items.filter((item) => !seen.has(item.id)));
}

/**
 * The announcements of this window and which of them were dismissed. Dismissals are remembered
 * per id in local storage; snapshots are replaced, never mutated, for `useSyncExternalStore`.
 * shortcut: a dismissal in a second window shows here after the next restart, not live.
 */
export function createAnnouncementFeed(storage: FeedStorage | null = defaultStorage()) {
  let snapshot: AnnouncementSnapshot = { items: [], dismissed: readDismissed(storage) };
  const listeners = new Set<() => void>();
  const update = (next: AnnouncementSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setItems(items: readonly Announcement[]) {
      update({ ...snapshot, items });
    },
    clear() {
      if (snapshot.items.length > 0) update({ ...snapshot, items: [] });
    },
    dismiss(id: string) {
      if (snapshot.dismissed.includes(id)) return;
      const dismissed = [...snapshot.dismissed, id].slice(-MAX_REMEMBERED);
      try {
        storage?.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
      } catch {
        // -- storage full or blocked: the dismissal still holds until restart.
      }
      update({ ...snapshot, dismissed });
    },
  };
}
export type AnnouncementFeed = ReturnType<typeof createAnnouncementFeed>;
export const announcementFeed = createAnnouncementFeed();

export const ANNOUNCEMENT_POLL_MS = 3 * 60 * 60_000;

export type AnnouncementPollDeps = {
  feed: Pick<AnnouncementFeed, "setItems">;
  fetchItems: () => Promise<readonly Announcement[]>;
  intervalMs?: number;
  isOnline?: () => boolean;
};

/**
 * Fetches at start, when the connection returns and every few hours. Nothing runs while
 * offline or while a fetch is in flight; failures keep what was last shown. Callers start it
 * only for a signed-in account.
 */
export function startAnnouncementPolling(deps: AnnouncementPollDeps): () => void {
  const online =
    deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  let running = false;
  let stopped = false;
  const poll = () => {
    if (running || stopped || !online()) return;
    running = true;
    deps
      .fetchItems()
      .then((items) => {
        if (!stopped) deps.feed.setItems(items);
      })
      .catch(() => undefined) // -- background and cheap; the next tick tries again.
      .finally(() => {
        running = false;
      });
  };
  poll();
  const timer = setInterval(poll, deps.intervalMs ?? ANNOUNCEMENT_POLL_MS);
  if (typeof window !== "undefined") window.addEventListener("online", poll);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof window !== "undefined") window.removeEventListener("online", poll);
  };
}
