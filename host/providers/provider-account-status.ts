import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import type { HostProviderAccountCatalog } from "./provider-accounts";

type ProbeStatus = "signedIn" | "signedOut" | "unknown";
type Probed = "claude" | "codex";
export type CatalogAccountStatus = "ready" | "signed-out" | "unknown";

const PROBED: readonly Probed[] = ["claude", "codex"];
const FRESH_MS = 5 * 60_000;
const FIRST_READ_WAIT_MS = 4_000;
const MAX_PARALLEL_PROBES = 3;

type Entry = { status?: Exclude<ProbeStatus, "unknown">; checkedAt?: number; pending?: Promise<void> };

/**
 * Last known sign-in state per provider account, refreshed in the background with bounded
 * concurrency so the model catalog never waits on more than one short first-read window.
 * An operational "unknown" probe keeps the previous definitive result.
 */
export function createProviderAccountStatusCache(deps: {
  probe(provider: Probed, accountId: string): Promise<ProbeStatus>;
  now?: () => number;
  firstReadWaitMs?: number;
}) {
  const now = deps.now ?? monotonicNow;
  const entries = new Map<string, Entry>();
  const queue: (() => Promise<void>)[] = [];
  let running = 0;
  const pump = () => {
    while (running < MAX_PARALLEL_PROBES && queue.length) {
      running++;
      void queue.shift()!().finally(() => {
        running--;
        pump();
      });
    }
  };
  const refresh = (provider: Probed, id: string, entry: Entry) => {
    entry.pending = new Promise<void>((resolve) => {
      queue.push(async () => {
        const status = await deps.probe(provider, id).catch((): ProbeStatus => "unknown");
        if (status !== "unknown") entry.status = status;
        entry.checkedAt = now();
        entry.pending = undefined;
        resolve();
      });
      pump();
    });
    return entry.pending;
  };

  return {
    async read(catalog: HostProviderAccountCatalog): Promise<Map<string, CatalogAccountStatus>> {
      const firstReads: Promise<void>[] = [];
      for (const provider of PROBED)
        for (const account of catalog[provider] ?? []) {
          const key = `${provider}\n${account.id}`;
          let entry = entries.get(key);
          if (!entry) entries.set(key, (entry = {}));
          const stale = entry.checkedAt === undefined || elapsedSince(entry.checkedAt, now()) >= FRESH_MS;
          const pending = entry.pending ?? (stale ? refresh(provider, account.id, entry) : undefined);
          if (pending && entry.status === undefined) firstReads.push(pending);
        }
      if (firstReads.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all(firstReads),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, deps.firstReadWaitMs ?? FIRST_READ_WAIT_MS);
          }),
        ]);
        clearTimeout(timer);
      }
      const result = new Map<string, CatalogAccountStatus>();
      for (const [key, entry] of entries)
        result.set(key, entry.status === "signedIn" ? "ready" : entry.status === "signedOut" ? "signed-out" : "unknown");
      return result;
    },
  };
}

/**
 * Picker catalog: signed-out Claude/Codex accounts are omitted so older clients that ignore
 * `status` also list only usable accounts. Routing keeps reading the full inventory, so a
 * session saved on a now signed-out account still resolves and shows its repair path.
 */
export function withProviderAccountStatus<T extends HostProviderAccountCatalog>(
  catalog: T,
  statuses: Map<string, CatalogAccountStatus>,
): T {
  const result: T = { ...catalog };
  for (const provider of PROBED) {
    const accounts = catalog[provider];
    if (!accounts) continue;
    result[provider] = accounts
      .map((account) => ({ ...account, status: statuses.get(`${provider}\n${account.id}`) ?? "unknown" }))
      .filter((account) => account.status !== "signed-out") as never;
  }
  return result;
}
