import {
  encodeMinutes,
  emptyMinutes,
  setMinute,
  type ActivityDay,
} from "@bycoda/account-contracts/activity";
import { describe, expect, it } from "vitest";
import {
  SYNC_HISTORY_DAYS,
  HOUR_MS,
  backoffDelay,
  chunkDays,
  classifyFailure,
  fingerprint,
  nextWakeDelay,
  pendingDays,
} from "./syncModel";

const day = (date: string, minutes: number[], deviceId = "local"): ActivityDay => {
  const map = emptyMinutes();
  for (const minute of minutes) setMinute(map, minute);
  return { date, timeZone: "UTC", deviceId, minutes: encodeMinutes(map) };
};

describe("pendingDays", () => {
  it("re-keys to the account device and merges duplicate dates", () => {
    const result = pendingDays(
      [day("2026-11-08", [1, 2]), day("2026-11-08", [2, 3])],
      "dev_1",
      "2026-11-08",
      {},
    );
    expect(result).toEqual([day("2026-11-08", [1, 2, 3], "dev_1")]);
  });

  it("covers the whole 400-day store and skips unreasonable future dates", () => {
    const oldest = "2025-10-05"; // 2026-11-08 minus 399 days
    const result = pendingDays(
      [day("2025-10-04", [1]), day(oldest, [1]), day("2026-11-09", [1]), day("2026-11-12", [1])],
      "d",
      "2026-11-08",
      {},
    );
    expect(result.map((entry) => entry.date)).toEqual([oldest, "2026-11-09"]);
    expect(SYNC_HISTORY_DAYS).toBe(400);
  });

  it("skips days that match the watermark and re-sends changed ones", () => {
    const sent = day("2026-11-07", [5], "d");
    const watermark = { "2026-11-07": fingerprint(sent.minutes) };
    const result = pendingDays(
      [day("2026-11-07", [5]), day("2026-11-08", [5])],
      "d",
      "2026-11-08",
      watermark,
    );
    expect(result.map((entry) => entry.date)).toEqual(["2026-11-08"]);
    const grown = pendingDays([day("2026-11-07", [5, 6])], "d", "2026-11-08", watermark);
    expect(grown).toHaveLength(1);
  });
});

describe("chunkDays", () => {
  it("splits at 62 days per request", () => {
    const many = Array.from({ length: 130 }, (_, i) => day("2026-01-01", [i % 100]));
    expect(chunkDays(many).map((chunk) => chunk.length)).toEqual([62, 62, 6]);
  });
});

describe("backoff", () => {
  it("doubles from 30 s up to one hour with jitter", () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, mid))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ]);
    expect(backoffDelay(20, mid)).toBe(HOUR_MS);
    expect(backoffDelay(1, () => 0)).toBe(24_000);
    expect(backoffDelay(1, () => 0.999)).toBeLessThanOrEqual(36_000);
  });
});

describe("nextWakeDelay", () => {
  it("is hourly, but wakes at the end of the local day", () => {
    const noon = new Date(2026, 10, 8, 12, 0, 0).getTime();
    expect(nextWakeDelay(noon, 0)).toBe(HOUR_MS);
    const lateEvening = new Date(2026, 10, 8, 23, 40, 0).getTime();
    expect(nextWakeDelay(lateEvening, 0)).toBe(20 * 60_000 + 5_000);
  });

  it("backs off after failures", () => {
    expect(nextWakeDelay(0, 2, () => 0.5)).toBe(60_000);
  });
});

describe("classifyFailure", () => {
  it("stops for a revoked, deactivated or unknown device and retries everything else", () => {
    expect(classifyFailure({ code: "device_revoked" })).toBe("stop");
    expect(classifyFailure({ code: "not_found" })).toBe("stop");
    expect(classifyFailure({ code: "account_deactivated" })).toBe("stop");
    expect(classifyFailure({ code: "internal" })).toBe("retry");
    expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("retry");
  });
});
