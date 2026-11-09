import { createAccountClient, type AccountClient } from "@bycoda/account-contracts";
import {
  addDays,
  decodeMinutes,
  encodeMinutes,
  mergeMinutes,
  summarize,
  type ActivityDay,
} from "@bycoda/account-contracts/activity";
import { createMockAccountServer } from "@bycoda/account-contracts/mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityTracker } from "../../model/activityTracker";
import { createActivitySyncer, type SyncIdentity } from "./activitySyncer";

const ZONE = "UTC";
const TODAY = "2026-11-08";
const NOON = Date.UTC(2026, 10, 8, 12, 0, 0);

/** Stands in for the Host RPC `activity.record` / `activity.days` (OR merge, deviceId "local"). */
function fakeHost() {
  const store = new Map<string, { timeZone: string; minutes: Uint8Array }>();
  return {
    record(report: { date: string; timeZone: string; minutes: string }) {
      const incoming = decodeMinutes(report.minutes);
      const known = store.get(report.date);
      store.set(report.date, {
        timeZone: report.timeZone,
        minutes: known ? mergeMinutes(known.minutes, incoming) : incoming,
      });
    },
    async days(range: { from: string; to: string }): Promise<ActivityDay[]> {
      return [...store]
        .filter(([date]) => date >= range.from && date <= range.to)
        .map(([date, value]) => ({
          date,
          timeZone: value.timeZone,
          deviceId: "local",
          minutes: encodeMinutes(value.minutes),
        }));
    },
  };
}

/** Real tracker, a few active minutes on each of the given days, flushed into the host. */
function trackMinutes(host: ReturnType<typeof fakeHost>, plan: Record<string, number[]>) {
  for (const [date, minutes] of Object.entries(plan)) {
    const tracker = new ActivityTracker(); // a fresh one per day: a long gap between ticks counts as sleep
    for (const minute of minutes) {
      const wall = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
      tracker.noteInput(wall);
      tracker.tick({ wall, mono: wall }, { foreground: true }, ZONE);
    }
    for (const report of tracker.drain()) host.record(report);
  }
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

let server: ReturnType<typeof createMockAccountServer>;
let fetchSpy: ReturnType<typeof vi.fn>;
let api: AccountClient;
let deviceId: string;

beforeEach(async () => {
  server = createMockAccountServer();
  server.state.activity.clear(); // drop the seeded sample day: only our uploads count
  fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => server.fetch(input, init));
  api = createAccountClient({
    baseUrl: "https://mock.invalid",
    getAccessToken: () => "mock-test",
    fetch: fetchSpy as typeof fetch,
  });
  const device = await api.registerDevice({
    body: {
      name: "Test",
      platform: "windows",
      osVersion: "11",
      appVersion: "1.0.0",
      channel: "dev",
      kind: "desktop",
    },
  });
  deviceId = device.id;
  fetchSpy.mockClear();
});

function syncer(
  host: ReturnType<typeof fakeHost>,
  options: {
    identity?: () => SyncIdentity | null;
    storage?: ReturnType<typeof memoryStorage> | null;
    onError?: (error: unknown) => void;
  } = {},
) {
  return createActivitySyncer({
    identity: options.identity ?? (() => ({ userId: "usr_mock", deviceId })),
    listDays: (range) => host.days(range),
    upload: async (days) => {
      await api.uploadActivityDays({ body: { days } });
    },
    onError: options.onError,
    now: () => NOON,
    timeZone: () => ZONE,
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    random: () => 0.5,
  });
}

const summaryQuery = { timeZone: ZONE, date: TODAY };

describe("activity sync end to end", () => {
  it("uploads tracked minutes and the cloud summary equals the local summarize", async () => {
    const host = fakeHost();
    trackMinutes(host, {
      "2026-11-08": [540, 541, 542, 543],
      "2026-11-05": [10, 11],
      "2026-10-20": [0, 1, 2],
      "2025-12-31": [5], // old history is uploaded too (full local store)
    });
    expect(await syncer(host).run()).toBe("sent");

    const remote = await api.getActivitySummary({ query: summaryQuery });
    const inWindow = (await host.days({ from: "2025-10-05", to: "2026-11-09" })).map((day) => ({
      ...day,
      deviceId,
    }));
    const expected = summarize(inWindow, { today: TODAY, timeZone: ZONE });
    expect(remote).toMatchObject(expected);
    expect(remote.today).toBe(4);
    expect(remote.perDevice?.map((entry) => entry.deviceId)).toEqual([deviceId]);
    expect(server.state.activity.has(`${deviceId}|2025-12-31`)).toBe(true);
    expect([...server.state.activity.values()].every((entry) => entry.deviceId === deviceId)).toBe(
      true,
    );
  });

  it("uploads the full history oldest first in 62-day requests and resumes after a failure", async () => {
    const host = fakeHost();
    const plan: Record<string, number[]> = {};
    for (let i = 0; i < 150; i++) plan[addDays(TODAY, -i)] = [i % 60];
    trackMinutes(host, plan);
    const storage = memoryStorage();
    const bodies: string[][] = [];
    let failFrom = 2; // the second request fails once
    let call = 0;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      if (call === failFrom) {
        failFrom = -1;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { days?: { date: string }[] };
      if (body.days) bodies.push(body.days.map((entry) => entry.date));
      return server.fetch(input, init);
    });
    const run = syncer(host, { storage });
    expect(await run.run()).toBe("failed"); // batch 1 delivered, batch 2 failed
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveLength(62);
    expect(bodies[0]![0]).toBe(addDays(TODAY, -149)); // oldest first
    expect(await run.run()).toBe("sent"); // resumes after the watermark
    expect(bodies.flat()).toHaveLength(150);
    expect(new Set(bodies.flat()).size).toBe(150);
    expect(bodies.slice(1).every((batch) => batch.length <= 62)).toBe(true);
    expect((await api.getActivitySummary({ query: summaryQuery })).year).toBeGreaterThan(100);
    expect(await run.run()).toBe("nothing-to-send");
  });

  it("stops when the account was deactivated", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1] });
    fetchSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "account_deactivated", message: "x", requestId: "r" } }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    );
    const onError = vi.fn();
    const run = syncer(host, { onError });
    expect(await run.run()).toBe("stopped");
    const requests = fetchSpy.mock.calls.length;
    expect(await run.run()).toBe("stopped");
    expect(fetchSpy.mock.calls.length).toBe(requests);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await host.days({ from: TODAY, to: TODAY })).toHaveLength(1);
  });

  it("is idempotent: a second run sends nothing, and re-sending without a watermark changes nothing", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1, 2, 3] });
    const first = syncer(host);
    expect(await first.run()).toBe("sent");
    const requests = fetchSpy.mock.calls.length;
    expect(await first.run()).toBe("nothing-to-send");
    expect(fetchSpy.mock.calls.length).toBe(requests);

    const before = await api.getActivitySummary({ query: summaryQuery });
    expect(await syncer(host, { storage: null }).run()).toBe("sent");
    expect(await syncer(host, { storage: null }).run()).toBe("sent");
    expect(await api.getActivitySummary({ query: summaryQuery })).toEqual(before);
  });

  it("sends new minutes of the same day later and never shrinks stored ones", async () => {
    const host = fakeHost();
    const storage = memoryStorage();
    trackMinutes(host, { "2026-11-08": [1, 2] });
    await syncer(host, { storage }).run();
    trackMinutes(host, { "2026-11-08": [3] });
    expect(await syncer(host, { storage }).run()).toBe("sent");
    expect((await api.getActivitySummary({ query: summaryQuery })).today).toBe(3);
  });

  it("signed out sends nothing and does not even read local data", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1] });
    const listDays = vi.spyOn(host, "days");
    const result = await syncer(host, { identity: () => null }).run();
    expect(result).toBe("signed-out");
    expect(listDays).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops when the device was revoked, keeps local data, and resumes under a new device", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1, 2] });
    const device = server.state.devices.get(deviceId)!;
    server.state.devices.set(deviceId, { ...device, revokedAt: "2026-11-08T10:00:00.000Z" });
    const onError = vi.fn();
    let identity: SyncIdentity = { userId: "usr_mock", deviceId };
    const run = syncer(host, { identity: () => identity, onError });

    expect(await run.run()).toBe("stopped");
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as { code: string }).code).toMatch(
      /^(device_revoked|not_found)$/, // the mock answers 404 for a revoked id, the service device_revoked
    );
    const requests = fetchSpy.mock.calls.length;
    expect(await run.run()).toBe("stopped");
    expect(fetchSpy.mock.calls.length).toBe(requests);
    expect(await host.days({ from: TODAY, to: TODAY })).toHaveLength(1);

    const fresh = await api.registerDevice({
      body: {
        name: "Test 2",
        platform: "windows",
        osVersion: "11",
        appVersion: "1.0.0",
        channel: "dev",
        kind: "desktop",
      },
    });
    identity = { userId: "usr_mock", deviceId: fresh.id };
    expect(await run.run()).toBe("sent");
  });

  it("backs off exponentially while offline, then delivers everything", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1, 2], "2026-11-07": [9] });
    let offline = true;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      offline ? Promise.reject(new TypeError("Failed to fetch")) : server.fetch(input, init),
    );
    const run = syncer(host);
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      expect(await run.run()).toBe("failed");
      delays.push(run.nextDelayMs());
    }
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(run.failureCount()).toBe(4);

    offline = false;
    expect(await run.run()).toBe("sent");
    expect(run.failureCount()).toBe(0);
    expect((await api.getActivitySummary({ query: summaryQuery })).today).toBe(2);
    expect(await syncer(host).run()).toBe("sent"); // a fresh syncer (no watermark) still agrees
    expect((await api.getActivitySummary({ query: summaryQuery })).week).toBe(3);
  });

  it("a server error also backs off and keeps local data", async () => {
    const host = fakeHost();
    trackMinutes(host, { "2026-11-08": [1] });
    fetchSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "internal", message: "x", requestId: "r" } }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const run = syncer(host);
    expect(await run.run()).toBe("failed");
    expect(run.failureCount()).toBe(1);
    expect(await host.days({ from: TODAY, to: TODAY })).toHaveLength(1);
  });
});
