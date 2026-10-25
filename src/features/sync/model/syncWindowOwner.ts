/** Web Locks span workspace WebViews with the same origin. Keep durable sync
 * alive in the background, but let only one supported window do automatic work.
 * Older engines keep the existing per-window coalescing rather than risking an
 * unsafe storage lease or stopping sync altogether. */
export function createSyncWindowOwner(
  acquired: () => void,
  locks: LockManager | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): { isOwner: () => boolean; stop: () => void } {
  let stopped = false;
  let owner = !locks;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  const notify = () =>
    queueMicrotask(() => {
      if (!stopped && owner) acquired();
    });
  const acquire = async () => {
    try {
      await locks!.request("bycoda-library-sync", { ifAvailable: true }, async (lock) => {
        if (!lock || stopped) return;
        owner = true;
        notify();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        owner = false;
        release = undefined;
      });
      if (!stopped) retry = setTimeout(() => void acquire(), 5_000);
    } catch {
      // Missing/denied Web Locks must preserve background functionality.
      owner = true;
      notify();
    }
  };
  if (locks) void acquire();
  else notify();
  return {
    isOwner: () => !stopped && owner,
    stop: () => {
      stopped = true;
      owner = false;
      clearTimeout(retry);
      release?.();
    },
  };
}
