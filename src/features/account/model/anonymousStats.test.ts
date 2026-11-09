// @vitest-environment happy-dom
import { createMockAccountServer } from "@bycoda/account-contracts/mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STATS_PROMPTS,
  getStatsConsent,
  installationId,
  migrateLegacyConsent,
  recordStatsPromptShown,
  setAnonymousStatsEnabled,
  setStatsChoice,
  shouldPromptForStats,
} from "./accountPrivacy";
import { sendDailyPing, startAnonymousStats, localDay } from "./anonymousStats";

const LEGACY = "bycoda.account.anonymousStats";
const DAY = new Date(2026, 10, 8, 12);
const NEXT_DAY = new Date(2026, 10, 9, 0, 5);

function setup(options: { configured?: boolean; apiBaseUrl?: string | null; fail?: boolean } = {}) {
  const server = createMockAccountServer();
  const requests: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(String(init?.body ?? "null")),
    });
    if (options.fail) throw new TypeError("Failed to fetch");
    return server.fetch(input, init);
  }) as typeof fetch;
  const native = {
    status: vi.fn(async () => ({
      configured: options.configured ?? true,
      signedIn: false,
      apiBaseUrl: options.apiBaseUrl === undefined ? "https://api.test" : options.apiBaseUrl,
      environment: "staging" as const,
    })),
    deviceInfo: vi.fn(async () => ({
      name: "Ada's laptop",
      platform: "windows" as const,
      osVersion: "11",
      appVersion: "1.2.3",
      channel: "stable" as const,
    })),
  };
  return { requests, native, deps: { native, fetchImpl, now: () => DAY } };
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("statistics consent", () => {
  it("is not asked yet by default", () => {
    expect(getStatsConsent()).toEqual({ choice: null, decidedAt: null });
  });

  it("migrates an old explicit yes and treats the old default no as not asked", () => {
    expect(migrateLegacyConsent("1").choice).toBe("on");
    expect(migrateLegacyConsent("0").choice).toBeNull();
    expect(migrateLegacyConsent(null).choice).toBeNull();
    localStorage.setItem(LEGACY, "1");
    expect(getStatsConsent().choice).toBe("on");
    localStorage.setItem(LEGACY, "0");
    expect(getStatsConsent().choice).toBeNull();
  });

  it("stores a decision with its time and lets it win over the old key", () => {
    localStorage.setItem(LEGACY, "1");
    setStatsChoice("off", () => new Date("2026-11-08T10:00:00.000Z"));
    expect(getStatsConsent()).toEqual({ choice: "off", decidedAt: "2026-11-08T10:00:00.000Z" });
  });

  it("ignores a damaged value", () => {
    localStorage.setItem("bycoda.account.anonymousStats.consent.v2", "{oops");
    expect(getStatsConsent().choice).toBeNull();
  });
});

describe("one-time prompt", () => {
  it("asks until answered, at most three times", () => {
    expect(shouldPromptForStats()).toBe(true);
    for (let i = 0; i < MAX_STATS_PROMPTS; i++) {
      expect(shouldPromptForStats()).toBe(true);
      recordStatsPromptShown();
    }
    expect(shouldPromptForStats()).toBe(false);
    expect(getStatsConsent().choice).toBeNull();
  });

  it("stops once decided", () => {
    setAnonymousStatsEnabled(false);
    expect(shouldPromptForStats()).toBe(false);
  });
});

describe("daily signal", () => {
  it("sends nothing when off, not asked or not configured", async () => {
    const off = setup();
    expect(await sendDailyPing(off.deps)).toBe("skipped");
    setStatsChoice("off");
    expect(await sendDailyPing(off.deps)).toBe("skipped");
    expect(off.requests).toHaveLength(0);
    setStatsChoice("on");
    for (const options of [{ configured: false }, { apiBaseUrl: null }]) {
      const unset = setup(options);
      expect(await sendDailyPing(unset.deps)).toBe("skipped");
      expect(unset.requests).toHaveLength(0);
    }
  });

  it("sends only the allowed fields, without credentials or the device header", async () => {
    setStatsChoice("on");
    const { deps, requests } = setup();
    expect(await sendDailyPing(deps)).toBe("sent");
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe("https://api.test/v1/anonymous/ping");
    expect(Object.keys(request!.body as object).sort()).toEqual([
      "appVersion",
      "channel",
      "date",
      "installId",
      "osVersion",
      "platform",
    ]);
    expect(request!.body).toMatchObject({
      appVersion: "1.2.3",
      platform: "windows",
      osVersion: "11",
      channel: "stable",
      date: localDay(DAY),
      installId: installationId(),
    });
    expect(Object.keys(request!.headers).map((name) => name.toLowerCase())).not.toContain(
      "authorization",
    );
    expect(JSON.stringify(request)).not.toContain("laptop");
  });

  it("sends at most once per local day and keeps one installation id", async () => {
    setStatsChoice("on");
    const { deps, requests } = setup();
    await sendDailyPing(deps);
    expect(await sendDailyPing(deps)).toBe("skipped");
    expect(requests).toHaveLength(1);
    const id = installationId();
    expect(await sendDailyPing({ ...deps, now: () => NEXT_DAY })).toBe("sent");
    expect(requests).toHaveLength(2);
    expect((requests[1]!.body as { installId: string }).installId).toBe(id);
  });

  it("fails silently and retries on the next call", async () => {
    setStatsChoice("on");
    const failing = setup({ fail: true });
    expect(await sendDailyPing(failing.deps)).toBe("failed");
    const working = setup();
    expect(await sendDailyPing(working.deps)).toBe("sent");
  });

  it("tries a day once per window, again on a new day, and stops when turned off", async () => {
    vi.useFakeTimers();
    let current = DAY;
    setStatsChoice("on");
    const { deps, native } = setup({ fail: true });
    const stop = startAnonymousStats({ ...deps, now: () => current });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(native.deviceInfo).toHaveBeenCalledTimes(1);
    current = NEXT_DAY;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(native.deviceInfo).toHaveBeenCalledTimes(2);
    setStatsChoice("off");
    current = new Date(2026, 10, 10, 9);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(native.deviceInfo).toHaveBeenCalledTimes(2);
    stop();
  });
});
