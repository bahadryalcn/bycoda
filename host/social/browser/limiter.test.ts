import { expect, it } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { BrowserSendLimiter, humanDelay, type BrowserLimiterStore } from "./limiter";

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);
const NEXT_DAY = Date.UTC(2026, 9, 27);

/** In-memory stand-in for the persisted counter and settings rows the limiter uses. */
function fakeStore() {
  const settings = new Map<string, string>();
  const counters = new Map<string, number>();
  const store: BrowserLimiterStore = {
    async getSetting(key) {
      return settings.get(key);
    },
    async putSetting(key, value) {
      settings.set(key, value);
    },
    async getCounter(accountId, action, day) {
      return counters.get(`${accountId}|${action}|${day}`) ?? 0;
    },
    async incrementCounter(accountId, action, day, by = 1) {
      const key = `${accountId}|${action}|${day}`;
      const next = (counters.get(key) ?? 0) + by;
      counters.set(key, next);
      return next;
    },
  };
  return { store, settings, counters };
}

function clock(start: number) {
  let at = start;
  return {
    now: () => at,
    set(next: number) {
      at = next;
    },
  };
}

it("enforces the minimum gap between browser sends for one account", async () => {
  const time = clock(T0);
  const limiter = new BrowserSendLimiter({ now: time.now });
  await limiter.reserve("account-a");
  await limiter.record("account-a");
  time.set(T0 + 10_000);
  await expect(limiter.reserve("account-a")).rejects.toMatchObject({
    code: "rate_limit",
    retryAt: T0 + 30_000,
  });
  // Another account is not paced by this one.
  await expect(limiter.reserve("account-b")).resolves.toBeUndefined();
  time.set(T0 + 30_000);
  await expect(limiter.reserve("account-a")).resolves.toBeUndefined();
});

it("keeps the gap and daily count across limiter instances when the store is shared", async () => {
  const { store, settings } = fakeStore();
  const first = new BrowserSendLimiter({ store, now: () => T0 });
  await first.record("account-a");
  expect(settings.get("rate:account-a")).toBe(String(T0));

  const restarted = new BrowserSendLimiter({ store, now: () => T0 + 5_000 });
  await expect(restarted.reserve("account-a")).rejects.toMatchObject({
    code: "rate_limit",
    retryAt: T0 + 30_000,
  });
});

it("refuses sends after the daily cap and resets at the next UTC day", async () => {
  const { store } = fakeStore();
  const time = clock(T0);
  const limiter = new BrowserSendLimiter({ store, now: time.now, dailyLimit: 1 });
  await limiter.record("account-a");

  time.set(T0 + 60_000);
  await expect(limiter.reserve("account-a")).rejects.toMatchObject({
    code: "rate_limit",
    retryAt: NEXT_DAY,
  });

  time.set(NEXT_DAY + 60_000);
  await expect(limiter.reserve("account-a")).resolves.toBeUndefined();
});

it("keeps only the in-memory gap when no store is configured", async () => {
  const time = clock(T0);
  const limiter = new BrowserSendLimiter({ now: time.now, dailyLimit: 1 });
  await limiter.record("account-a");
  time.set(T0 + 31_000);
  // Without a store there is no daily counter, so the cap cannot apply.
  await expect(limiter.reserve("account-a")).resolves.toBeUndefined();
  // A fresh instance has no memory and no persisted rows.
  await expect(
    new BrowserSendLimiter({ now: () => T0 }).reserve("account-a"),
  ).resolves.toBeUndefined();
});

it("forgets only the in-memory gap for a disconnected account", async () => {
  const time = clock(T0);
  const limiter = new BrowserSendLimiter({ now: time.now });
  await limiter.record("account-a");
  limiter.forget("account-a");
  time.set(T0 + 1_000);
  await expect(limiter.reserve("account-a")).resolves.toBeUndefined();
});

it("computes human delays inside the requested bounds", () => {
  expect(humanDelay(1_000, 3_000, () => 0)).toBe(1_000);
  expect(humanDelay(1_000, 3_000, () => 1)).toBe(3_000);
  expect(humanDelay(1_000, 3_000, () => 0.5)).toBe(2_000);
  expect(() => humanDelay(3_000, 1_000)).toThrow(RangeError);
  expect(() => humanDelay(-1, 1_000)).toThrow(RangeError);
});

it("raises a platform error for a refused send", async () => {
  const limiter = new BrowserSendLimiter({ now: () => T0 });
  await limiter.record("account-a");
  const error = await limiter.reserve("account-a").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SocialPlatformError);
});

it("refuses a send at an invalid clock reading before any counter is read or written", async () => {
  const { store, counters } = fakeStore();
  const limiter = new BrowserSendLimiter({ store, now: () => Number.NaN });
  await expect(limiter.reserve("acc-1")).rejects.toThrow(RangeError);
  expect(counters.size).toBe(0);
});
