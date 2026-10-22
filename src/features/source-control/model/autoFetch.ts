const KEY = "bycoda.gitAutoFetch";

/** How often the changes panel fetches while auto fetch is on. */
export const AUTO_FETCH_MS = 5 * 60 * 1000;

export function loadAutoFetch(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAutoFetch(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts for this window only */
  }
}
