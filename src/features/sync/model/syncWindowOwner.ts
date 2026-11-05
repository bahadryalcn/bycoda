import { isTauri } from "@tauri-apps/api/core";

/** Web Locks span workspace WebViews with the same origin. Keep durable sync
 * alive in the background, but let only one supported window do automatic work.
 * Browser fallback keeps per-window coalescing when Web Locks are unavailable;
 * Native windows wait when ownership cannot be established. */
export function createSyncWindowOwner(
  acquired: () => void,
  locks: LockManager | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): { isOwner: () => boolean; stop: (drain?: Promise<boolean>) => void } {
  let stopped = false;
  const native = isTauri();
  let owner = !locks && !native;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  const notify = () =>
    queueMicrotask(() => {
      if (!stopped && owner) acquired();
    });
  const reportAcquireFailure = (error: unknown) => {
    console.warn("Sync ownership is unavailable; retry after the window recovers.", error);
  };
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
      if (!stopped) retry = setTimeout(() => void acquire().catch(reportAcquireFailure), 5_000);
    } catch (error) {
      if (native) {
        // A failed native ownership check is unknown, not proof of retirement.
        console.warn("Sync ownership is unavailable; retry after the window recovers.", error);
        if (!stopped) retry = setTimeout(() => { void acquire().catch(reportAcquireFailure); }, 5_000);
      } else {
        owner = true;
        notify();
      }
    }
  };
  if (locks) void acquire().catch(reportAcquireFailure);
  else if (owner) notify();
  else console.warn("Sync ownership is unavailable; retry after the window recovers.");
  return {
    isOwner: () => !stopped && owner,
    stop: (drain) => {
      stopped = true;
      owner = false;
      clearTimeout(retry);
      if (!drain) { release?.(); return; }
      void drain.then((settled) => {
        if (settled) release?.();
        else console.warn("Sync ownership remains held because a transport outcome is uncertain.");
      }, (error: unknown) => {
        console.warn("Sync ownership remains held because draining failed.", error);
      });
    },
  };
}
