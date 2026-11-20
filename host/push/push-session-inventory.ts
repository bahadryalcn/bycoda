import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";

/**
 * Longest a cached inventory is reused without a change signal. It bounds what no signal reports
 * (a desktop database edit, a branch switch in an unwatched checkout).
 */
export const PUSH_INVENTORY_SAFETY_MS = 20_000;
/** Same bounded fan-out as `inbox.list`: each project list may read desktop state. */
const LIST_CONCURRENCY = 4;

type Options = {
  projectIds: () => Promise<string[]>;
  list: (projectId: string) => Promise<HostSessionSummary[]>;
  /** Calls `changed` on any store or desktop change and returns the unsubscribe. */
  watch: (changed: () => void) => () => void;
  now?: () => number;
  safetyMs?: number;
};

/**
 * Every top-level conversation on this Host for the push scan. The scan runs on a short timer, but
 * the project lists are only read again after a store/desktop change or the safety interval, so an
 * idle Host with many projects does not re-list all of them every tick.
 */
export function createPushSessionInventory(options: Options) {
  const now = options.now ?? monotonicNow;
  const safetyMs = options.safetyMs ?? PUSH_INVENTORY_SAFETY_MS;
  let cached: { sessions: HostSessionSummary[]; at: number } | undefined;
  let dirty = true;
  let unwatch: (() => void) | undefined;

  async function scan(): Promise<HostSessionSummary[]> {
    const projectIds = await options.projectIds();
    const lists: HostSessionSummary[][] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LIST_CONCURRENCY, projectIds.length) }, async () => {
        for (;;) {
          const index = next++;
          if (index >= projectIds.length) return;
          lists[index] = await options.list(projectIds[index]);
        }
      }),
    );
    return lists.flat();
  }

  return {
    async read(): Promise<HostSessionSummary[]> {
      // Subscribed on first use: a Host with no registered phone never listens.
      unwatch ??= options.watch(() => {
        dirty = true;
      });
      if (cached && !dirty && elapsedSince(cached.at, now()) < safetyMs) return cached.sessions;
      // Cleared before the read, so a change that lands while it runs keeps the next read fresh.
      dirty = false;
      const at = now();
      try {
        const sessions = await scan();
        cached = { sessions, at };
        return sessions;
      } catch (error) {
        // A failed read is never reused as an empty or partial inventory.
        dirty = true;
        throw error;
      }
    },
    /** Stops listening and forgets the cache; a later read subscribes again. */
    close(): void {
      unwatch?.();
      unwatch = undefined;
      cached = undefined;
      dirty = true;
    },
  };
}
