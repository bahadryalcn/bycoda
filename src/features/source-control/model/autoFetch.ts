import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** How often the changes panel fetches while auto fetch is on. */
export const AUTO_FETCH_MS = 5 * 60 * 1000;

/** One global preference: every mounted repository panel and every window follows it. */
const CHANGE_EVENT = "bycoda:git-auto-fetch-change";
const stored = createStoredSetting<boolean>({
  key: "bycoda.gitAutoFetch",
  fallback: false,
  event: CHANGE_EVENT,
  storageEvents: true,
  parse: (raw) => raw === "1",
  serialize: (value) => (value ? "1" : "0"),
});

export const loadAutoFetch = stored.load;
export const subscribeAutoFetch = stored.subscribe;

/** Returns whether the choice was saved. A failed write keeps the previous value everywhere
 * (no broadcast), so the menu never shows a setting that is not stored. */
export function saveAutoFetch(enabled: boolean): boolean {
  return stored.save(enabled);
}
