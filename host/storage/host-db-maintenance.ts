import { perfMetrics } from "../diagnostics/perf-metrics";
import {
  collectOrphanNativeBufferBlobs,
  countOrphanNativeBufferBlobs,
  type NativeBufferBlobGcResult,
} from "../native-buffer/native-buffer-blob-gc";
import {
  releaseNativeBufferLegacyBatches,
  vacuumAfterNativeBufferLegacyRelease,
} from "../native-buffer/native-buffer-legacy-release";
import { nativeBufferGitStoreFor } from "../native-buffer/native-buffer-git-registry";
import type { HostStore } from "../store";
import { capEventsGlobally, EVENT_BYTES_TOTAL, type EventRetentionResult } from "./event-retention";
import { withShortBusyTimeout } from "./short-busy-timeout";

export const HOST_DB_MAINTENANCE_FIRST_DELAY_MS = 10 * 60 * 1000;
export const HOST_DB_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
/** About 64 MB of free pages per pass, only when the database already uses
 * auto_vacuum=INCREMENTAL; the mode of an existing database is never changed. */
const INCREMENTAL_VACUUM_PAGES = 16_384;
const METRIC = "storage.maintenance";
const GIT_GC_METRIC = "storage.nativeBufferGitGc";
perfMetrics.register(METRIC);
perfMetrics.register(GIT_GC_METRIC);

export type HostDbMaintenanceResult = {
  blobs: NativeBufferBlobGcResult;
  events: EventRetentionResult;
  /** `PRAGMA wal_checkpoint(TRUNCATE)` result; absent when nothing was deleted. */
  checkpoint?: { busy: number; log: number; checkpointed: number };
  incrementalVacuum: boolean;
  /** Legacy SQL native buffer rows removed by this pass (git store only). */
  legacyRowsDeleted?: number;
  /** The one-time VACUUM after the legacy release ran in this pass. */
  legacyVacuum?: { before: number; after: number };
};

// Native buffer history (`native-activity/buffer-history/...`) is deliberately not
// bounded here: every archived version stays a recovery source. listRecovery() pages
// all history manifests, readRecovery()/recoveryStatus() and verifyDelivery() read any
// exact older (reportId, reportVersion, snapshotDigest) through readCertificate(), and
// no method resolves dirty/unknown sources. Bounding it needs an owner-approved
// release rule, not a storage cap. Only unreferenced blobs are collected.

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

/** One bounded pass: orphan blob GC, global event cap, then WAL truncation when the
 * pass deleted rows. Never VACUUMs; see docs/reference/host-runtime.md. */
export function runHostDbMaintenance(
  store: HostStore,
  stopped: () => boolean = () => false,
  gitStore: { gc(): Promise<unknown> } | undefined = nativeBufferGitStoreFor(store),
  testing: { uptimeMs?: () => number } = {},
): Promise<HostDbMaintenanceResult> {
  return perfMetrics.measure(METRIC, async () => {
    const blobs = await collectOrphanNativeBufferBlobs(store, { stopped });
    const events = await capEventsGlobally(
      store.db,
      (work) => store.transaction(work, "checkpoint"),
      { stopped },
    );
    if (gitStore && !stopped())
      await perfMetrics
        .measure(GIT_GC_METRIC, () => gitStore.gc())
        .catch((error: unknown) => console.warn("Native buffer git gc failed:", error));
    // Legacy SQL content is worthless once the Host runs on the git store: release it in
    // bounded batches over the first passes, then VACUUM once when it is safe.
    const legacy = gitStore
      ? await releaseNativeBufferLegacyBatches(store, { stopped })
      : undefined;
    const legacyVacuum =
      legacy?.done && !stopped()
        ? await vacuumAfterNativeBufferLegacyRelease(store, { ...testing, stopped })
        : undefined;
    const extra = {
      ...(legacy ? { legacyRowsDeleted: legacy.deletedRows } : {}),
      ...(legacyVacuum ? { legacyVacuum } : {}),
    };
    if ((!blobs.deletedBlobs && !events.deletedRows && !legacy?.deletedRows) || stopped())
      return { blobs, events, incrementalVacuum: false, ...extra };
    return { blobs, events, ...extra, ...(await reclaim(store)) };
  });
}

/** Read-only diagnostics: what a pass would delete, without deleting it. */
export async function dryRunHostDbMaintenance(store: HostStore) {
  const blobs = await countOrphanNativeBufferBlobs(store);
  const row = await store.db.storeScope(() =>
    store.db.prepare("SELECT COALESCE(SUM(octet_length(payload)),0) AS bytes FROM events").get(),
  );
  const eventBytes = Number(row?.bytes ?? 0);
  return {
    orphanBlobs: blobs.orphanBlobs,
    orphanBlobBytes: blobs.orphanBytes,
    ...(blobs.skipped ? { blobsSkipped: blobs.skipped } : {}),
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
          if (result.legacyVacuum)
            console.info(
              `Host database VACUUM after native buffer legacy release: ` +
                `${result.legacyVacuum.before} -> ${result.legacyVacuum.after} bytes.`,
            );
          if (result.legacyRowsDeleted)
            console.info(`Released ${result.legacyRowsDeleted} legacy native buffer rows.`);
          if (!result.blobs.deletedBlobs && !result.events.deletedRows) return;
          console.info(
            `Host database maintenance removed ${result.blobs.deletedBlobs} native buffer blobs ` +
              `(${result.blobs.deletedBytes} bytes) and ${result.events.deletedRows} event rows ` +
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
