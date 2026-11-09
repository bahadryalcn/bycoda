import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CACHE_TTL_MS,
  clearAccountCache,
  readAccountCache,
  readDeviceId,
  writeAccountCache,
  writeDeviceId,
} from "./accountCache";
import { ACCOUNT_CONTEXT, memoryStorage } from "./testFixtures";

const HOUR = 3_600_000;

describe("account cache", () => {
  it("returns the last verified view until it expires", () => {
    const storage = memoryStorage();
    writeAccountCache({ context: ACCOUNT_CONTEXT, deviceId: "dev_1", verifiedAt: 1_000 }, storage);
    expect(readAccountCache(1_000 + HOUR, storage)).toMatchObject({
      deviceId: "dev_1",
      verifiedAt: 1_000,
    });
    expect(readAccountCache(1_000 + ACCOUNT_CACHE_TTL_MS, storage)).not.toBeNull();
    expect(readAccountCache(1_000 + ACCOUNT_CACHE_TTL_MS + 1, storage)).toBeNull();
    // Expired entries are removed, not just ignored.
    expect(storage.data.size).toBe(0);
  });

  it("does not trust a timestamp from the future", () => {
    const storage = memoryStorage();
    writeAccountCache({ context: ACCOUNT_CONTEXT, deviceId: null, verifiedAt: 5_000 }, storage);
    expect(readAccountCache(1_000, storage)).toBeNull();
  });

  it("drops damaged or invalid entries", () => {
    const storage = memoryStorage({ "bycoda.account.cache.v1": "{not json" });
    expect(readAccountCache(0, storage)).toBeNull();
    const invalid = memoryStorage({
      "bycoda.account.cache.v1": JSON.stringify({ verifiedAt: 1, context: { user: {} } }),
    });
    expect(readAccountCache(2, invalid)).toBeNull();
    expect(invalid.data.size).toBe(0);
  });

  it("stores no token field", () => {
    const storage = memoryStorage();
    writeAccountCache({ context: ACCOUNT_CONTEXT, deviceId: "dev_1", verifiedAt: 1 }, storage);
    expect([...storage.data.values()].join("")).not.toMatch(/token/i);
  });

  it("keeps device ids per account and across clearing the cache", () => {
    const storage = memoryStorage();
    writeDeviceId("usr_1", "dev_a", storage);
    writeDeviceId("usr_2", "dev_b", storage);
    clearAccountCache(storage);
    expect(readDeviceId("usr_1", storage)).toBe("dev_a");
    expect(readDeviceId("usr_2", storage)).toBe("dev_b");
    expect(readDeviceId("usr_3", storage)).toBeNull();
  });

  it("works without any storage", () => {
    expect(readAccountCache(0, null)).toBeNull();
    expect(() =>
      writeAccountCache({ context: ACCOUNT_CONTEXT, deviceId: null, verifiedAt: 0 }, null),
    ).not.toThrow();
  });
});
