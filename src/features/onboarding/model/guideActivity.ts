/** Things the user has done that no store can answer synchronously (a terminal opened, a diff read). */
export type GuideActivity = "terminal-opened" | "change-reviewed";

const ACTIVITY_KEY = "bycoda.guide.activity.v1";
const listeners = new Set<() => void>();

function parse(raw: string | null): GuideActivity[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (id): id is GuideActivity => id === "terminal-opened" || id === "change-reviewed",
        )
      : [];
  } catch {
    return [];
  }
}

export function loadGuideActivity(): GuideActivity[] {
  try {
    return parse(localStorage.getItem(ACTIVITY_KEY));
  } catch {
    return [];
  }
}

/** Stable string snapshot for `useSyncExternalStore`. */
export function getGuideActivitySnapshot(): string {
  return loadGuideActivity().join(",");
}

export function subscribeGuideActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remembers that the user did something once; later calls are free. */
export function recordGuideActivity(activity: GuideActivity): void {
  const current = loadGuideActivity();
  if (current.includes(activity)) return;
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify([...current, activity]));
  } catch {
    // Progress marks are optional; the guide still works without storage.
    return;
  }
  for (const listener of listeners) listener();
}
