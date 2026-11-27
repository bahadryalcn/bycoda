import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  COMPLETE_DEADLINE_MS,
  COMPLETE_RETRY_MAX_MS,
  completeNativeSyncCycle,
  completeRetryDelay,
  syncOwnerFailureText,
} from "./nativeSyncCompletion";

beforeEach(() => {
  vi.useFakeTimers();
  // The deadline runs on the monotonic clock; keep it moving with the fake timers.
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.invoke.mockReset();
});

const held = () => Promise.reject("SYNC_OWNER_HELD");

it("backs off 250 ms, 500 ms, 1 s, then 2 s", () => {
  expect([0, 1, 2, 3, 4, 10].map(completeRetryDelay)).toEqual([
    250,
    500,
    1_000,
    COMPLETE_RETRY_MAX_MS,
    COMPLETE_RETRY_MAX_MS,
    COMPLETE_RETRY_MAX_MS,
  ]);
});

it("completes once the owner lets go, without waiting past the first free attempt", async () => {
  mocks.invoke
    .mockImplementationOnce(held)
    .mockImplementationOnce(held)
    .mockResolvedValue(undefined);
  const done = completeNativeSyncCycle("pc", "op-1");
  await vi.advanceTimersByTimeAsync(250 + 500);
  await expect(done).resolves.toBeUndefined();
  expect(mocks.invoke).toHaveBeenCalledTimes(3);
  expect(mocks.invoke).toHaveBeenCalledWith("sync_cycle_complete", {
    machineId: "pc",
    operationId: "op-1",
  });
});

it("retries a busy native control window like a held owner", async () => {
  mocks.invoke
    .mockImplementationOnce(() => Promise.reject("NATIVE_CONTROL_WINDOW_BUSY"))
    .mockResolvedValue(undefined);
  const done = completeNativeSyncCycle("pc", "op-2");
  await vi.advanceTimersByTimeAsync(250);
  await expect(done).resolves.toBeUndefined();
});

it("throws at the deadline instead of retrying forever while the owner stays held", async () => {
  mocks.invoke.mockImplementation(held);
  const done = completeNativeSyncCycle("pc", "op-3");
  const outcome = done.then(
    () => "resolved",
    (error: unknown) => String(error),
  );
  await vi.advanceTimersByTimeAsync(COMPLETE_DEADLINE_MS);
  expect(await outcome).toContain("timed out");
  expect(vi.getTimerCount()).toBe(0);
  // Roughly 250+500+1000 then 2 s steps: well below the old four-per-second rate (120 calls).
  expect(mocks.invoke.mock.calls.length).toBeLessThan(25);
  const calls = mocks.invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(COMPLETE_DEADLINE_MS);
  expect(mocks.invoke).toHaveBeenCalledTimes(calls);
});

it("stops waiting at once when the loop stops, leaving the cycle unresolved", async () => {
  mocks.invoke.mockImplementation(held);
  const stop = new AbortController();
  const outcome = completeNativeSyncCycle("pc", "op-4", stop.signal).then(
    () => "resolved",
    (error: unknown) => String(error),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  stop.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(await outcome).toContain("stopped");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("makes one attempt, and no retry, when the loop is already stopped and the owner is held", async () => {
  mocks.invoke.mockImplementation(held);
  const stop = new AbortController();
  stop.abort();
  await expect(completeNativeSyncCycle("pc", "op-5", stop.signal)).rejects.toThrow("stopped");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("throws any other refusal at once", async () => {
  mocks.invoke.mockImplementation(() => Promise.reject("SYNC_OWNER_UNKNOWN"));
  await expect(completeNativeSyncCycle("pc", "op-6")).rejects.toBe("SYNC_OWNER_UNKNOWN");
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("describes native owner refusals without their codes", () => {
  for (const code of [
    "SYNC_OWNER_UNKNOWN",
    "SYNC_OWNER_HELD",
    "NATIVE_CONTROL_WINDOW_BUSY",
    "SYNC_OWNER_PAGE_STALE",
  ]) {
    const text = syncOwnerFailureText(code);
    expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(text).toMatch(/retry/);
  }
  expect(syncOwnerFailureText("SYNC_OWNER_UNKNOWN")).toMatch(/earlier run/);
  expect(syncOwnerFailureText(new Error("database is locked"))).toBe(
    "Sync could not start: database is locked",
  );
});
