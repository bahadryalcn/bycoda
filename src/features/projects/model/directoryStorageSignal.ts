/** Stored state the mobile project directory is built from: rail, archive, groups, lock,
 * tab-group appearance and session layout. Matched by prefix so new keys are covered too. */
export const DIRECTORY_STORAGE_PREFIXES = [
  "bycoda.recentProjects",
  "bycoda.projectRail",
  "bycoda.archivedProjects",
  "bycoda.projectGroup",
  "bycoda.groupLock",
  "bycoda.sessionFolders",
  "bycoda.sessionOrder",
  "bycoda:tab-group",
];

let generation = 0;
let installed:
  | { setItem: Storage["setItem"]; removeItem: Storage["removeItem"]; clear: Storage["clear"] }
  | undefined;

function watches(key: string | null): boolean {
  return key === null || DIRECTORY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Wraps the storage writers once; this window's writes bump the counter, and the
 * `storage` event does for other windows. A write that throws changes nothing, so
 * the bump after it only costs one extra rebuild. */
function install(): void {
  if (installed || typeof Storage === "undefined" || typeof window === "undefined") return;
  const proto = Storage.prototype;
  const { setItem, removeItem, clear } = proto;
  const wrapped = {
    setItem(this: Storage, key: string, value: string) {
      try {
        return setItem.call(this, key, value);
      } finally {
        if (watches(String(key))) generation += 1;
      }
    },
    removeItem(this: Storage, key: string) {
      try {
        return removeItem.call(this, key);
      } finally {
        if (watches(String(key))) generation += 1;
      }
    },
    clear(this: Storage) {
      try {
        return clear.call(this);
      } finally {
        generation += 1;
      }
    },
  };
  proto.setItem = wrapped.setItem;
  proto.removeItem = wrapped.removeItem;
  proto.clear = wrapped.clear;
  installed = wrapped;
  window.addEventListener("storage", (event: StorageEvent) => {
    // A cleared store arrives with a null key.
    if (watches(event.key)) generation += 1;
  });
}

/**
 * Counter that moves whenever a stored directory input may have changed, in this
 * window or another. `undefined` means changes cannot be observed (storage is
 * unreadable, or another script replaced the writers), so callers must read storage.
 */
export function directoryStorageGeneration(): number | undefined {
  install();
  if (!installed) return undefined;
  const proto = Storage.prototype;
  if (
    proto.setItem !== installed.setItem ||
    proto.removeItem !== installed.removeItem ||
    proto.clear !== installed.clear
  )
    return undefined;
  try {
    void localStorage.length; // Throws when storage is blocked.
  } catch {
    return undefined;
  }
  return generation;
}
