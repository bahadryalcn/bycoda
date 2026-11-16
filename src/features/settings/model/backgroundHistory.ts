const KEY = "bycoda.chatBackgroundHistory.v1";
const EVENT = "bycoda:background-history";

export function loadBackgroundHistory(target = "global"): string[] {
  try {
    const history: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const paths =
      history && typeof history === "object" ? (history as Record<string, unknown>)[target] : null;
    return Array.isArray(paths)
      ? paths.filter((path): path is string => typeof path === "string" && !!path).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

/** History must be durable before replacing or disabling the current selection. */
export function rememberBackground(paths: (string | null)[], target = "global") {
  const raw = localStorage.getItem(KEY);
  const stored: unknown = raw ? JSON.parse(raw) : {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    throw new Error("Background history is unreadable");
  const history = stored as Record<string, unknown>;
  history[target] = [
    ...new Set([
      ...paths.filter((path): path is string => !!path),
      ...loadBackgroundHistory(target),
    ]),
  ].slice(0, 30);
  localStorage.setItem(KEY, JSON.stringify(history));
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeBackgroundHistory(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
