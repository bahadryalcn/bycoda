import type { ModelRoutingScope } from "../../../shared/model/host-contracts/model-routing";

type Kinds = Record<string, ModelRoutingScope>;

/** Waits before each retry of a failed send; the list is the retry bound. */
const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

export type ProjectKindsSender = {
  /** Writes the current map; a non-forced call is skipped when the Host already holds it. */
  send(force: boolean): void;
  /** Cancels the pending retry and ignores any write still in flight. */
  dispose(): void;
};

/** Key-order independent identity of a map, so equal maps always compare equal. */
export function projectKindsSignature(kinds: Kinds): string {
  return JSON.stringify(Object.entries(kinds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Keeps this computer's Host holding the current personal/work map. A send counts as done only
 * when `sync` reports success; a failed one stays retryable (bounded backoff, or the next send).
 * Only one write is in flight: a send during it is folded into one follow-up that reads the
 * newest map, and a stale write's outcome never stands in for the newer map.
 */
export function createProjectKindsSender(options: {
  current(): Kinds;
  /** Resolves true when the Host holds the map afterwards; false (or a rejection) is a failure. */
  sync(kinds: Kinds): Promise<boolean>;
  retryDelaysMs?: readonly number[];
}): ProjectKindsSender {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  // The signature the Host is known to hold; undefined after a failure, since its state is unknown.
  let synced: string | undefined;
  let inFlight = false;
  let queued = false;
  let disposed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const pump = async (force: boolean): Promise<void> => {
    if (disposed) return;
    const kinds = options.current();
    const signature = projectKindsSignature(kinds);
    if (!force && signature === synced) return;
    inFlight = true;
    let ok = false;
    try {
      ok = await options.sync(kinds);
    } catch (error) {
      console.warn("Project tag sync failed", error);
    }
    inFlight = false;
    synced = ok ? signature : undefined;
    if (ok) attempt = 0;
    if (disposed) return;
    if (queued) {
      queued = false;
      await pump(false);
      return;
    }
    if (!ok && attempt < delays.length) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void pump(false);
      }, delays[attempt++]);
    }
  };

  return {
    send(force) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      attempt = 0;
      if (inFlight) {
        queued = true;
        return;
      }
      void pump(force);
    },
    dispose() {
      disposed = true;
      clearTimeout(retryTimer);
      retryTimer = undefined;
    },
  };
}
