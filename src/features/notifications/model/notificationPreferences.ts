export const NOTIFICATION_CATEGORIES = [
  { id: "pullRequests", label: "Pull requests / Merge requests" },
  { id: "issues", label: "Issues and Linear tasks" },
  { id: "agentFinished", label: "Agent finished" },
  { id: "agentInput", label: "Agent approvals and questions" },
  { id: "agentFailed", label: "Agent failures and usage limits" },
  { id: "reminders", label: "Reminders" },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["id"];
export const NOTIFICATION_MUTE_HOURS = [1, 4, 8] as const;
export type NotificationSubject = {
  projectId: string;
  category: NotificationCategory;
  occurredAt?: number;
};
export type ProjectNotificationPreference = {
  disabled: NotificationCategory[];
  /** null means muted until manually resumed; absent means no override. */
  mutedUntil?: number | null;
  /** Suppress delayed activity from before a manual resume. */
  resumedAt?: number;
  enabledAfter?: Partial<Record<NotificationCategory, number>>;
};
type Preferences = Record<string, ProjectNotificationPreference>;
const KEY = "bycoda.projectNotifications.v1";
const CHANGE = "bycoda:project-notifications-change";
let lastKnownPreferences: Preferences = {};
/** The latest read failed, so `lastKnownPreferences` is not an authoritative record. */
let preferencesReadFailed = false;

/** `after` is the last suppressed millisecond, shared with native delivery. */
export type ProjectNotificationRule = { enabled: boolean; after: number };

export function getProjectNotificationRule(
  projectId: string,
  category: NotificationCategory,
): ProjectNotificationRule {
  const preference = loadNotificationPreferences()[projectId];
  if (!preference) return { enabled: true, after: 0 };
  return {
    enabled: preference.mutedUntil !== null && !preference.disabled.includes(category),
    after: Math.max(
      preference.resumedAt ?? 0,
      // A scheduled event at the deadline belongs to the resumed interval.
      (preference.mutedUntil ?? 1) - 1,
      preference.enabledAfter?.[category] ?? 0,
    ),
  };
}

export function loadNotificationPreferences(): Preferences {
  return readNotificationPreferences(false);
}

/**
 * Whether project preferences could be read. When `unavailable`, the values
 * returned by `loadNotificationPreferences` are the last known (or defaults),
 * not the stored choices, and edits are refused until a read succeeds.
 */
export function notificationPreferencesStatus(): "ready" | "unavailable" {
  readNotificationPreferences(false);
  return preferencesReadFailed ? "unavailable" : "ready";
}

/** Re-reads storage and tells subscribers; returns the resulting status. */
export function retryNotificationPreferencesRead(): "ready" | "unavailable" {
  const status = notificationPreferencesStatus();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
  return status;
}

function readNotificationPreferences(strict: boolean): Preferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Project notification preferences are unavailable.");
    }
    const entries = Object.entries(parsed).flatMap(([id, value]) => {
      if (!id || !value || typeof value !== "object" || Array.isArray(value)) return [];
      const disabled = Array.isArray(value.disabled)
        ? NOTIFICATION_CATEGORIES.map(({ id }) => id).filter((category) =>
            value.disabled.includes(category),
          )
        : [];
      const mutedUntil = value.mutedUntil;
      const validMute =
        mutedUntil === null ||
        (typeof mutedUntil === "number" && Number.isFinite(mutedUntil) && mutedUntil >= 0);
      const resumedAt = value.resumedAt;
      const enabledAfter = Object.fromEntries(
        NOTIFICATION_CATEGORIES.flatMap(({ id: category }) => {
          const timestamp = value.enabledAfter?.[category];
          return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0
            ? [[category, timestamp]]
            : [];
        }),
      );
      return [
        [
          id,
          {
            disabled,
            ...(validMute ? { mutedUntil } : {}),
            ...(typeof resumedAt === "number" && Number.isFinite(resumedAt) && resumedAt >= 0
              ? { resumedAt }
              : {}),
            ...(Object.keys(enabledAfter).length ? { enabledAfter } : {}),
          },
        ],
      ];
    });
    lastKnownPreferences = Object.fromEntries(entries);
    preferencesReadFailed = false;
    return lastKnownPreferences;
  } catch (error) {
    preferencesReadFailed = true;
    // Read-only consumers retain known data. Mutations must never merge into
    // defaults after a failed read and overwrite recoverable preferences.
    if (strict) throw error;
    return lastKnownPreferences;
  }
}

export function updateNotificationPreferences(
  projectIds: readonly string[],
  patch: Partial<ProjectNotificationPreference>,
) {
  const preferences = { ...readNotificationPreferences(true) };
  for (const id of projectIds) {
    const previous = preferences[id];
    const enabled =
      patch.disabled === undefined
        ? []
        : (previous?.disabled ?? []).filter((category) => !patch.disabled!.includes(category));
    const enabledAfter = enabled.length
      ? {
          ...previous?.enabledAfter,
          ...Object.fromEntries(enabled.map((category) => [category, Date.now()])),
        }
      : previous?.enabledAfter;
    const resuming =
      "mutedUntil" in patch && patch.mutedUntil === undefined && previous?.mutedUntil !== undefined;
    preferences[id] = {
      ...(previous ?? { disabled: [] }),
      ...patch,
      ...(resuming ? { resumedAt: Date.now() } : {}),
      ...(enabledAfter ? { enabledAfter } : {}),
    };
  }
  localStorage.setItem(KEY, JSON.stringify(preferences));
  lastKnownPreferences = preferences;
  preferencesReadFailed = false;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
}

export function allowsProjectNotification(subject: NotificationSubject, now = Date.now()): boolean {
  const rule = getProjectNotificationRule(subject.projectId, subject.category);
  return (
    rule.enabled &&
    now > rule.after &&
    (subject.occurredAt === undefined || subject.occurredAt > rule.after)
  );
}

export function isProjectMuted(
  preference: ProjectNotificationPreference,
  now = Date.now(),
): boolean {
  return preference.mutedUntil === null || (preference.mutedUntil ?? 0) > now;
}

/** Indicators reflect current preferences; unread history is never consumed. */
export function allowsProjectNotificationIndicator(
  subject: Pick<NotificationSubject, "projectId" | "category">,
  preferences = loadNotificationPreferences(),
  now = Date.now(),
): boolean {
  const preference = preferences[subject.projectId];
  return (
    !preference ||
    (!isProjectMuted(preference, now) && !preference.disabled.includes(subject.category))
  );
}

/** Include effective mute state so mounted controls update when a deadline passes. */
export function notificationPreferencesSnapshot(): string {
  const preferences = loadNotificationPreferences();
  return JSON.stringify({
    unavailable: preferencesReadFailed,
    preferences,
    muted: Object.keys(preferences).filter((id) => isProjectMuted(preferences[id])),
  });
}

export type NotificationPreferencesView = {
  preferences: Preferences;
  unavailable: boolean;
  /** Project ids muted when the snapshot was taken; the store re-notifies at each deadline. */
  muted: ReadonlySet<string>;
};

type ViewCache = {
  /** Stored text the view came from; undefined when storage could not be read. */
  raw: string | null | undefined;
  preferences: Preferences;
  view: NotificationPreferencesView;
  /** Muted ids stay the same until this earliest future mute deadline. */
  validUntil: number;
};

let viewCache: ViewCache | null = null;

function readRawPreferences(): string | null | undefined {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return undefined;
  }
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * The view of the current preferences, with one identity while the stored text
 * and the muted ids are unchanged (for `useSyncExternalStore`). Storage is parsed
 * only when its text changes; a passed mute deadline only recomputes muted ids.
 */
export function notificationPreferencesViewSnapshot(): NotificationPreferencesView {
  const raw = readRawPreferences();
  const cached = viewCache;
  // Unreadable storage is never trusted as unchanged, so it re-checks each call.
  const sameStored = cached !== null && raw !== undefined && cached.raw === raw;
  if (sameStored && Date.now() < cached.validUntil) return cached.view;
  const preferences = sameStored ? cached.preferences : loadNotificationPreferences();
  const unavailable = sameStored ? cached.view.unavailable : preferencesReadFailed;
  const now = Date.now();
  const muted = new Set<string>();
  let validUntil = Infinity;
  for (const [id, preference] of Object.entries(preferences)) {
    if (isProjectMuted(preference, now)) muted.add(id);
    if (typeof preference.mutedUntil === "number" && preference.mutedUntil > now)
      validUntil = Math.min(validUntil, preference.mutedUntil);
  }
  if (
    cached?.preferences === preferences &&
    cached.view.unavailable === unavailable &&
    sameIds(cached.view.muted, muted)
  ) {
    viewCache = { ...cached, raw, validUntil };
    return cached.view;
  }
  const view = { preferences, unavailable, muted };
  viewCache = { raw, preferences, view, validUntil };
  return view;
}

export function subscribeNotificationPreferences(listener: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const now = Date.now();
    const deadlines = Object.values(notificationPreferencesViewSnapshot().preferences)
      .map((preference) => preference.mutedUntil)
      .filter((deadline): deadline is number => typeof deadline === "number" && deadline > now);
    if (deadlines.length)
      timer = setTimeout(changed, Math.min(Math.min(...deadlines) - now, 2_147_483_647));
  };
  const changed = () => {
    schedule();
    listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) changed();
  };
  const onVisible = () => {
    if (!document.hidden) changed();
  };
  window.addEventListener(CHANGE, changed);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", changed);
  document.addEventListener("visibilitychange", onVisible);
  schedule();
  return () => {
    clearTimeout(timer);
    window.removeEventListener(CHANGE, changed);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", changed);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
