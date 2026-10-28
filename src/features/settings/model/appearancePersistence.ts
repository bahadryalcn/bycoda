/** Appearance keeps an applied window fallback while reporting an unsuccessful durable write. */
export type AppearanceSaveIssue = {
  key: string;
  settingId: string;
  applied: boolean;
};

type PendingSave = AppearanceSaveIssue & {
  value: string | null;
  notify: () => void;
  retry?: () => boolean;
};
const pending = new Map<string, PendingSave>();
let snapshot: readonly AppearanceSaveIssue[] = [];
const listeners = new Set<() => void>();

function changed() {
  snapshot = [...pending.values()].map(({ key, settingId, applied }) => ({
    key,
    settingId,
    applied,
  }));
  listeners.forEach((listener) => listener());
}

export function readAppearanceValue(key: string): string | null {
  const fallback = pending.get(key);
  return fallback?.applied ? fallback.value : localStorage.getItem(key);
}

export function writeAppearanceValue(
  key: string,
  value: string | null,
  settingId: string,
  notify: () => void,
  applied = true,
  retry?: () => boolean,
): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    pending.delete(key);
    changed();
    notify();
    return true;
  } catch {
    pending.set(key, { key, value, settingId, applied, notify, retry });
    changed();
    // Subscribers must see the current window fallback, not an old durable value.
    if (applied) notify();
    return false;
  }
}

export function retryAppearanceSave(key: string): boolean {
  const save = pending.get(key);
  if (!save) return true;
  if (save.retry) return save.retry();
  return writeAppearanceValue(save.key, save.value, save.settingId, save.notify, save.applied);
}

export function registerAppearanceSaveFailure(issue: PendingSave) {
  pending.set(issue.key, issue);
  changed();
}

/** A sibling write supersedes the local fallback; it must not be replayed over new intent. */
export function acceptAppearanceStorageChange(key: string | null) {
  if (key === null) pending.clear();
  else pending.delete(key);
  changed();
}

export const readAppearanceSaveIssues = () => snapshot;
export function subscribeAppearanceSaveIssues(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
