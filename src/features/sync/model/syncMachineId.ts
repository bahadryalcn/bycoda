const KEY = "bycoda.sync.machineId";
let cached: string | null = null;

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `machine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  );
}

/** This desktop's stable id within the synced library, created once. Every
 * participating machine needs one, including the one a host runs on, so a
 * project's per-machine path map can tell them apart. */
export function localMachineId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return cached;
    }
  } catch {
    // private mode / quota: fall through to an unsaved id for this session
  }
  const fresh = randomId();
  try {
    localStorage.setItem(KEY, fresh);
  } catch {
    // ignored; this session keeps its id in memory only
  }
  cached = fresh;
  return cached;
}
