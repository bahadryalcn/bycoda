import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** The one-time statistics choice: `null` means the user has not been asked yet. */
export type StatsChoice = "on" | "off" | null;
export type StatsConsent = { choice: StatsChoice; decidedAt: string | null };

/** Replaced the boolean `bycoda.account.anonymousStats`, which is still read once. */
const CONSENT_KEY = "bycoda.account.anonymousStats.consent.v2";
const LEGACY_KEY = "bycoda.account.anonymousStats";
const PROMPT_KEY = "bycoda.account.anonymousStats.prompted";
const LAST_PING_KEY = "bycoda.account.anonymousStats.lastPing";
const INSTALL_ID_KEY = "bycoda.account.installId";
const CHANGE_EVENT = "bycoda:anonymous-stats-change";

/** The reminder stops after this many dismissals; statistics then stay off. */
export const MAX_STATS_PROMPTS = 3;

const NOT_ASKED: StatsConsent = { choice: null, decidedAt: null };

function parseConsent(raw: string): StatsConsent {
  try {
    const value = JSON.parse(raw) as { choice?: unknown; decidedAt?: unknown };
    if (value.choice !== "on" && value.choice !== "off") return NOT_ASKED;
    const decidedAt = typeof value.decidedAt === "string" ? value.decidedAt : null;
    return { choice: value.choice, decidedAt };
  } catch {
    return NOT_ASKED;
  }
}

const consent = createStoredSetting<StatsConsent>({
  key: CONSENT_KEY,
  fallback: NOT_ASKED,
  event: CHANGE_EVENT,
  storageEvents: true,
  parse: parseConsent,
  serialize: (value) => JSON.stringify(value),
});

/**
 * An explicit `true` from the old boolean counts as yes. The old `false` was also what the
 * default wrote, so it is not an answer: the user is asked once.
 */
export function migrateLegacyConsent(raw: string | null): StatsConsent {
  return raw === "1" || raw === "true" ? { choice: "on", decidedAt: null } : NOT_ASKED;
}

export function getStatsConsent(): StatsConsent {
  try {
    if (localStorage.getItem(CONSENT_KEY) !== null) return consent.load();
    return migrateLegacyConsent(localStorage.getItem(LEGACY_KEY));
  } catch {
    return NOT_ASKED;
  }
}

/** Primitive snapshot for `useSyncExternalStore`. */
export const getStatsChoice = (): StatsChoice => getStatsConsent().choice;

export function setStatsChoice(choice: "on" | "off", now: () => Date = () => new Date()): void {
  consent.save({ choice, decidedAt: now().toISOString() });
}

/**
 * Optional anonymous daily signal (random install id, app version, OS, channel, date; no
 * content). Off until the user says yes; stored on this computer only and needs no account.
 */
export function isAnonymousStatsEnabled(): boolean {
  return getStatsChoice() === "on";
}

export function setAnonymousStatsEnabled(enabled: boolean): void {
  setStatsChoice(enabled ? "on" : "off");
}

export const subscribeAnonymousStats = consent.subscribe;

function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeText(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function statsPromptCount(): number {
  const count = Number(readText(PROMPT_KEY));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/** Counts one time the question was put to the user. */
export function recordStatsPromptShown(): void {
  writeText(PROMPT_KEY, String(statsPromptCount() + 1));
}

/** One-time prompt for users who were never asked: until answered, at most three launches. */
export function shouldPromptForStats(): boolean {
  return getStatsChoice() === null && statsPromptCount() < MAX_STATS_PROMPTS;
}

export const getLastPingDate = (): string | null => readText(LAST_PING_KEY);
export function setLastPingDate(date: string): void {
  writeText(LAST_PING_KEY, date);
}

/**
 * Random, created once and never regenerated or derived from hardware or the account.
 * `null` when it cannot be stored, so nothing is sent with an id that would not persist.
 */
export function installationId(): string | null {
  const existing = readText(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.();
  return id && writeText(INSTALL_ID_KEY, id) ? id : null;
}
