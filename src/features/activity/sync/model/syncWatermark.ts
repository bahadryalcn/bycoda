import { addDays } from "@bycoda/account-contracts/activity";
import { SYNC_HISTORY_DAYS, type Watermark } from "./syncModel";

const KEY = "bycoda.activity.sync.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Stored = { userId: string; deviceId: string; days: Watermark };

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Non-secret record of what was sent. A different account or device starts empty. */
export function readWatermark(
  userId: string,
  deviceId: string,
  storage: StorageLike | null = defaultStorage(),
): Watermark {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.userId !== userId || stored.deviceId !== deviceId) return {};
    if (typeof stored.days !== "object" || stored.days === null) return {};
    return Object.fromEntries(
      Object.entries(stored.days).filter(([, value]) => typeof value === "string"),
    );
  } catch {
    return {};
  }
}

export function writeWatermark(
  userId: string,
  deviceId: string,
  days: Watermark,
  today: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  const oldest = addDays(today, -SYNC_HISTORY_DAYS);
  const kept = Object.fromEntries(Object.entries(days).filter(([date]) => date >= oldest));
  try {
    storage?.setItem(KEY, JSON.stringify({ userId, deviceId, days: kept } satisfies Stored));
  } catch {
    // Losing the watermark only costs a harmless re-send.
  }
}
