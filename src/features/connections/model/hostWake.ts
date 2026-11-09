/**
 * Wakes between the local host's heartbeat and the passes that follow it, so
 * neither polls on a timer. The heartbeat (`useDesktopLive`) reports what moved
 * on the host; the adopted-session mirror and the shared-queue dispatcher run
 * only on that, on focus/visibility, and on one slow safety pass.
 */

/** The heartbeat is at most `DESKTOP_LIVE_IDLE_MS` apart (even a throttled hidden
 * window answers within a minute), so an answer this recent means a mirror pass
 * does not need its own timer. */
export const ADOPTED_BEAT_FRESH_MS = 90_000;

let adoptedHeardAt = 0;
let adoptedWaker: ((ids: string[] | undefined) => void) | undefined;

/** One heartbeat answer of a host that reports adopted-session changes. */
export function noteAdoptedBeat(change: { ids: string[]; reset: boolean }, now = Date.now()): void {
  adoptedHeardAt = now;
  if (change.reset) adoptedWaker?.(undefined);
  else if (change.ids.length > 0) adoptedWaker?.(change.ids);
}

/** The heartbeat failed: the mirror may no longer rely on it, so it looks at the
 * host itself once (and, if the host is down, falls back to its own backoff). */
export function adoptedBeatFailed(): void {
  if (adoptedHeardAt === 0) return;
  adoptedHeardAt = 0;
  adoptedWaker?.(undefined);
}

/** Whether the host's heartbeat has recently told this desktop what moved. */
export function adoptedBeatFresh(now = Date.now()): boolean {
  return now - adoptedHeardAt < ADOPTED_BEAT_FRESH_MS;
}

/** The mirror's wake; `undefined` ids: any adopted session may have moved. */
export function setAdoptedWaker(waker: ((ids: string[] | undefined) => void) | undefined): void {
  adoptedWaker = waker;
  if (!waker) adoptedHeardAt = 0;
}

export const LOCAL_HOST_REACHABLE_EVENT = "bycoda:local-host-reachable";

/** The local host just became reachable (or is again): whatever waited for it can look. */
export function notifyLocalHostReachable(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_HOST_REACHABLE_EVENT));
}
