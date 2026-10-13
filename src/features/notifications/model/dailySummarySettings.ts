/** The once-a-day summary of background work: whether it is sent and when. */
const ENABLED_KEY = "bycoda.notifications.dailySummary.enabled";
const TIME_KEY = "bycoda.notifications.dailySummary.time";
const LAST_SENT_KEY = "bycoda.notifications.dailySummary.lastSent";

export const DAILY_SUMMARY_ENABLED_DEFAULT = true;
export const DAILY_SUMMARY_TIME_DEFAULT = "09:00";
export const DAILY_SUMMARY_CHANGE_EVENT = "bycoda:daily-summary-change";

/** Whole hours, 06:00 to 22:00. */
export const DAILY_SUMMARY_TIMES = Array.from(
  { length: 17 },
  (_, i) => `${String(i + 6).padStart(2, "0")}:00`,
);

export function isSummaryTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function loadDailySummaryEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw == null) return DAILY_SUMMARY_ENABLED_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return DAILY_SUMMARY_ENABLED_DEFAULT;
  }
}

export function loadDailySummaryTime(): string {
  try {
    const raw = localStorage.getItem(TIME_KEY);
    return isSummaryTime(raw) ? raw : DAILY_SUMMARY_TIME_DEFAULT;
  } catch {
    return DAILY_SUMMARY_TIME_DEFAULT;
  }
}

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DAILY_SUMMARY_CHANGE_EVENT));
}

export function saveDailySummaryEnabled(value: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  changed();
}

export function saveDailySummaryTime(value: string) {
  if (!isSummaryTime(value)) return;
  try {
    localStorage.setItem(TIME_KEY, value);
  } catch {
    // private mode / quota
  }
  changed();
}

/** When the daily summary last went out, or null. */
export function loadDailySummarySentAt(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_SENT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveDailySummarySentAt(at: number) {
  try {
    localStorage.setItem(LAST_SENT_KEY, String(at));
  } catch {
    // private mode / quota
  }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Whether the summary goes out now: it is on, today's chosen time has passed,
 * and none went out yet today. Opening the app late in the day sends it then;
 * a day that was missed entirely is not sent on top, since the one summary
 * covers everything since the last.
 */
export function dailySummaryDue({
  enabled,
  time,
  now,
  lastSentAt,
}: {
  enabled: boolean;
  time: string;
  now: number;
  lastSentAt: number | null;
}): boolean {
  if (!enabled || !isSummaryTime(time)) return false;
  const current = new Date(now);
  const [hours, minutes] = time.split(":").map(Number);
  const scheduled = new Date(current);
  scheduled.setHours(hours, minutes, 0, 0);
  if (current < scheduled) return false;
  return lastSentAt == null || !sameLocalDay(new Date(lastSentAt), current);
}

/** The period a summary covers: since the last one, or a day on first run. */
export function dailySummarySince(now: number, lastSentAt: number | null): number {
  return lastSentAt ?? now - 24 * 60 * 60 * 1000;
}
