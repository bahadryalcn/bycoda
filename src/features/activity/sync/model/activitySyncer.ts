import { dateTimeFormat } from "../../../../shared/lib/intl";
import { localDateFor, type ActivityDay } from "@bycoda/account-contracts/activity";
import {
  chunkDays,
  classifyFailure,
  fingerprint,
  nextWakeDelay,
  pendingDays,
  syncWindow,
} from "./syncModel";
import { readWatermark, writeWatermark, type StorageLike } from "./syncWatermark";

export type SyncIdentity = { userId: string; deviceId: string };

export type SyncDeps = {
  /** The signed-in account with its registered device; `null` when signed out. */
  identity: () => SyncIdentity | null;
  listDays: (range: { from: string; to: string }) => Promise<ActivityDay[]>;
  upload: (days: ActivityDay[]) => Promise<void>;
  /** Called with every upload failure, for example to route `device_revoked` to the account. */
  onError?: (error: unknown) => void;
  now?: () => number;
  timeZone?: () => string;
  storage?: StorageLike | null;
  random?: () => number;
};

export type SyncResult = "signed-out" | "sent" | "nothing-to-send" | "failed" | "stopped" | "busy";

const keyOf = (identity: SyncIdentity) => `${identity.userId}:${identity.deviceId}`;

/**
 * Sends local day maps to the account. Signed out sends (and reads) nothing. Re-sending is
 * harmless (the service ORs maps), so the watermark only saves traffic. A failure keeps all
 * local data and schedules a retry with exponential backoff; a revoked or unknown device
 * stops sync until the identity changes.
 */
export function createActivitySyncer(deps: SyncDeps) {
  const now = deps.now ?? Date.now;
  const zone = deps.timeZone ?? (() => dateTimeFormat().resolvedOptions().timeZone);
  let failures = 0;
  let running = false;
  let stoppedFor: string | null = null;

  return {
    /** Delay before the next run: backoff after a failure, else hourly or at local day end. */
    nextDelayMs: () => nextWakeDelay(now(), failures, deps.random),
    failureCount: () => failures,
    /** Forget the backoff, for example when the network came back. */
    resetBackoff: () => {
      failures = 0;
    },

    async run(): Promise<SyncResult> {
      const identity = deps.identity();
      if (!identity) return "signed-out";
      const key = keyOf(identity);
      if (stoppedFor === key) return "stopped";
      if (running) return "busy";
      running = true;
      try {
        const today = localDateFor(new Date(now()), zone());
        const watermark = readWatermark(identity.userId, identity.deviceId, deps.storage);
        const local = await deps.listDays(syncWindow(today));
        // The account may have changed while reading; never send under a stale identity.
        const current = deps.identity();
        if (!current || keyOf(current) !== key) return "signed-out";
        const pending = pendingDays(local, identity.deviceId, today, watermark);
        if (pending.length === 0) {
          failures = 0;
          return "nothing-to-send";
        }
        for (const batch of chunkDays(pending)) {
          await deps.upload(batch);
          for (const day of batch) watermark[day.date] = fingerprint(day.minutes);
          writeWatermark(identity.userId, identity.deviceId, watermark, today, deps.storage);
        }
        failures = 0;
        return "sent";
      } catch (error) {
        deps.onError?.(error);
        if (classifyFailure(error) === "stop") {
          stoppedFor = key;
          return "stopped";
        }
        failures += 1;
        return "failed";
      } finally {
        running = false;
      }
    },
  };
}
export type ActivitySyncer = ReturnType<typeof createActivitySyncer>;
