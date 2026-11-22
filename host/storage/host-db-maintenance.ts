import { perfMetrics } from "../diagnostics/perf-metrics";
import type { HostStore } from "../store";
import { capEventsGlobally, EVENT_BYTES_TOTAL, type EventRetentionResult } from "./event-retention";
import { compactHostDatabase } from "./host-db-compaction";
import { releaseRetiredNativeBufferTables } from "./retired-native-buffer-cleanup";
import { withShortBusyTimeout } from "./short-busy-timeout";

export const HOST_DB_MAINTENANCE_FIRST_DELAY_MS = 10 * 60 * 1000;
export const HOST_DB_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
/** About 64 MB of free pages per pass, only when the database uses
 * auto_vacuum=INCREMENTAL; the VACUUM in host-db-compaction.ts switches a file to it. */
const INCREMENTAL_VACUUM_PAGES = 16_384;
const METRIC = "storage.maintenance";
perfMetrics.register(METRIC);

export type HostDbMaintenanceResult = {
  events: EventRetentionResult;
  /** `PRAGMA wal_checkpoint(TRUNCATE)` result; absent when nothing was deleted. */
  checkpoint?: { busy: number; log: number; checkpointed: number };
  incrementalVacuum: boolean;
  /** Rows of the retired native buffer tables removed by this pass. */
  retiredRowsDeleted?: number;
  /** File sizes around the VACUUM this pass ran (host-db-compaction.ts). */
  vacuum?: { before: number; after: number };
};

async function reclaim(store: HostStore) {
  return store.db.storeScope(() =>
    withShortBusyTimeout(store.db, async () => {
      const mode = await store.db.prepare("PRAGMA auto_vacuum").get();
      const incrementalVacuum = Number(mode && Object.values(mode)[0]) === 2;
      if (incrementalVacuum)
        await store.db.prepare(`PRAGMA incremental_vacuum(${INCREMENTAL_VACUUM_PAGES})`).all();
      const row = await store.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      return {
        incrementalVacuum,
        checkpoint: {
          busy: Number(row?.busy ?? 0),
          log: Number(row?.log ?? 0),
          checkpointed: Number(row?.checkpointed ?? 0),
        },
      };
    }),
  );
}

/** One bounded pass: retired native buffer table release, global event cap, a VACUUM when
 * the file is mostly free and the Host is idle, then WAL truncation when the pass deleted
 * rows. See docs/reference/host-runtime.md. */
export function runHostDbMaintenance(
  store: HostStore,
  stopped: () => boolean = () => false,
  testing: { uptimeMs?: () => number; now?: () => number; batchRows?: number } = {},
): Promise<HostDbMaintenanceResult> {
  return perfMetrics.measure(METRIC, async () => {
    const events = await capEventsGlobally(
      store.db,
      (work) => store.transaction(work, "checkpoint"),
      { stopped },
    );
    // The retired tables can be large: release them in bounded batches over the first
    // passes (then DROP TABLE). Compaction waits for the last batch.
    const retired = await releaseRetiredNativeBufferTables(store, {
      stopped,
      ...(testing.batchRows ? { batchRows: testing.batchRows } : {}),
    });
    const vacuum = retired.done
      ? await compactHostDatabase(store, { ...testing, stopped })
      : undefined;
    const extra = {
      ...(retired.deletedRows ? { retiredRowsDeleted: retired.deletedRows } : {}),
      ...(vacuum ? { vacuum } : {}),
    };
    if ((!events.deletedRows && !retired.deletedRows) || stopped())
      return { events, incrementalVacuum: false, ...extra };
    return { events, ...extra, ...(await reclaim(store)) };
  });
}

/** Read-only diagnostics: what a pass would delete, without deleting it. */
export async function dryRunHostDbMaintenance(store: HostStore) {
  const row = await store.db.storeScope(() =>
    store.db.prepare("SELECT COALESCE(SUM(octet_length(payload)),0) AS bytes FROM events").get(),
  );
  const eventBytes = Number(row?.bytes ?? 0);
  return {
    eventBytes,
    eventBytesOverCap: Math.max(0, eventBytes - EVENT_BYTES_TOTAL),
  };
}

/** Runs off the request path: first pass 10 minutes after start, then hourly. */
export function scheduleHostDbMaintenance(
  store: HostStore,
  delays = { first: HOST_DB_MAINTENANCE_FIRST_DELAY_MS, every: HOST_DB_MAINTENANCE_INTERVAL_MS },
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      runHostDbMaintenance(store, () => stopped)
        .then((result) => {
          if (result.vacuum)
            console.info(
              `Host database VACUUM: ${result.vacuum.before} -> ${result.vacuum.after} bytes.`,
            );
          if (result.retiredRowsDeleted)
            console.info(`Released ${result.retiredRowsDeleted} retired native buffer rows.`);
          if (!result.events.deletedRows) return;
          console.info(
            `Host database maintenance removed ${result.events.deletedRows} event rows ` +
              `from ${result.events.sessions} sessions.`,
          );
        })
        .catch((error: unknown) => {
          if (!stopped) console.warn("Host database maintenance pass failed:", error);
        })
        .finally(() => {
          if (!stopped) schedule(delays.every);
        });
    }, delay);
    timer.unref?.();
  };
  schedule(delays.first);
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
