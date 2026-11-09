import { AccountContext } from "@bycoda/account-contracts";

/** The cached account is trusted this long while the service is unreachable. */
export const ACCOUNT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_KEY = "bycoda.account.cache.v1";
const DEVICES_KEY = "bycoda.account.devices.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AccountCache = {
  context: AccountContext;
  deviceId: string | null;
  verifiedAt: number;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The last server-confirmed account view. Non-secret: profile, entitlement summary and the
 * device id. Tokens never come here; they live in the OS credential store.
 */
export function readAccountCache(
  now: number,
  storage: StorageLike | null = defaultStorage(),
): AccountCache | null {
  try {
    const raw = storage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      verifiedAt?: unknown;
      deviceId?: unknown;
      context?: unknown;
    };
    const context = AccountContext.safeParse(parsed.context);
    const verifiedAt = typeof parsed.verifiedAt === "number" ? parsed.verifiedAt : NaN;
    if (!context.success || !Number.isFinite(verifiedAt)) {
      clearAccountCache(storage);
      return null;
    }
    // A clock set back does not extend trust: a future timestamp counts as expired.
    if (verifiedAt > now || now - verifiedAt > ACCOUNT_CACHE_TTL_MS) {
      clearAccountCache(storage);
      return null;
    }
    return {
      context: context.data,
      verifiedAt,
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : null,
    };
  } catch {
    return null;
  }
}

export function writeAccountCache(
  cache: AccountCache,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A full or blocked store only costs the offline view.
  }
}

export function clearAccountCache(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(CACHE_KEY);
  } catch {
    // Nothing else to clear.
  }
}

function readDevices(storage: StorageLike | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DEVICES_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The device id the service issued to this computer for one account. Kept per user so a
 * second account on the same computer never reuses another account's id, and kept across
 * sign-out so signing back in refreshes the same device row.
 */
export function readDeviceId(
  userId: string,
  storage: StorageLike | null = defaultStorage(),
): string | null {
  return readDevices(storage)[userId] ?? null;
}

export function writeDeviceId(
  userId: string,
  deviceId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(DEVICES_KEY, JSON.stringify({ ...readDevices(storage), [userId]: deviceId }));
  } catch {
    // The service will issue a new id next time.
  }
}
