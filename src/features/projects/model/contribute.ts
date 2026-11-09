/**
 * Local state of the "contribute to bycoda" invitation: when the user first used the app, on
 * how many distinct days, and what they answered. Nothing here leaves the device.
 */
export const CONTRIBUTE_KEY = "bycoda.contribute.v1";
export const CONTRIBUTE_MIN_AGE_DAYS = 7;
export const CONTRIBUTE_MIN_ACTIVE_DAYS = 5;
export const CONTRIBUTE_LATER_DAYS = 30;
/** "Later" asks again after 30 days, at most twice more (three showings in all). */
export const CONTRIBUTE_MAX_LATER = 2;

const DAY_MS = 86_400_000;

export type ContributeState = {
  /** Epoch ms of the first recorded use; null before any. */
  firstSeen: number | null;
  /** Distinct local days with app use. */
  activeDays: number;
  /** The local day last counted, `YYYY-MM-DD`. */
  lastDay: string | null;
  /** Times the user answered "Later". */
  later: number;
  /** Earliest epoch ms of the next showing after "Later". */
  nextAt: number | null;
  /** "never": declined; "done": cloned and opened. Both end the invitation. */
  closed: "never" | "done" | null;
};

export const EMPTY_CONTRIBUTE_STATE: ContributeState = {
  firstSeen: null,
  activeDays: 0,
  lastDay: null,
  later: 0,
  nextAt: null,
  closed: null,
};

type Store = Pick<Storage, "getItem" | "setItem">;

const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const time = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function readContributeState(store: Store | null = defaultStore()): ContributeState {
  try {
    const raw = store?.getItem(CONTRIBUTE_KEY);
    if (!raw) return EMPTY_CONTRIBUTE_STATE;
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      firstSeen: time(value.firstSeen),
      activeDays: count(value.activeDays),
      lastDay: typeof value.lastDay === "string" ? value.lastDay : null,
      later: count(value.later),
      nextAt: time(value.nextAt),
      closed: value.closed === "never" || value.closed === "done" ? value.closed : null,
    };
  } catch {
    return EMPTY_CONTRIBUTE_STATE;
  }
}

function write(state: ContributeState, store: Store | null): ContributeState {
  try {
    store?.setItem(CONTRIBUTE_KEY, JSON.stringify(state));
  } catch {
    // -- storage can be blocked; the invitation then simply does not advance.
  }
  return state;
}

function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Counts today as a day of use; the first call also records the first-seen time. */
export function recordContributeUse(
  now: Date = new Date(),
  store: Store | null = defaultStore(),
): ContributeState {
  const state = readContributeState(store);
  const day = localDay(now);
  if (state.firstSeen !== null && state.lastDay === day) return state;
  return write(
    {
      ...state,
      firstSeen: state.firstSeen ?? now.getTime(),
      activeDays: state.activeDays + 1,
      lastDay: day,
    },
    store,
  );
}

/** Seen for a week, used on five different days, not answered for good, not snoozed. */
export function shouldPromptContribute(state: ContributeState, now: number): boolean {
  if (state.closed !== null || state.firstSeen === null) return false;
  if (now - state.firstSeen < CONTRIBUTE_MIN_AGE_DAYS * DAY_MS) return false;
  if (state.activeDays < CONTRIBUTE_MIN_ACTIVE_DAYS) return false;
  if (state.later > CONTRIBUTE_MAX_LATER) return false;
  return state.nextAt === null || now >= state.nextAt;
}

/** "Later": asks again after 30 days; after the third "Later" it stops for good. */
export function answerContributeLater(
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): ContributeState {
  const state = readContributeState(store);
  const later = state.later + 1;
  return write(
    later > CONTRIBUTE_MAX_LATER
      ? { ...state, later, closed: "never", nextAt: null }
      : { ...state, later, nextAt: now + CONTRIBUTE_LATER_DAYS * DAY_MS },
    store,
  );
}

export function answerContributeNever(store: Store | null = defaultStore()): ContributeState {
  return write({ ...readContributeState(store), closed: "never", nextAt: null }, store);
}

export function markContributeDone(store: Store | null = defaultStore()): ContributeState {
  return write({ ...readContributeState(store), closed: "done", nextAt: null }, store);
}
