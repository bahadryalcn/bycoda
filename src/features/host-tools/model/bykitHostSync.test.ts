// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
import { startBykitHostSync } from "./bykitHostSync";
import { announceRemoteRecovery } from "../../connections/model/remoteHealth";
import { toolPreferences } from "./toolPreferences";

let stop: (() => void) | undefined;
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
const sent = () => mocks.request.mock.calls.map((call) => call[2].bykitInstructions);

beforeEach(() => {
  localStorage.clear();
  mocks.request.mockReset().mockResolvedValue({});
  mocks.invoke.mockReset().mockResolvedValue({ id: "local" });
});
afterEach(() => {
  stop?.();
  stop = undefined;
});

it("publishes the switch on start and after each change, without repeating a sent value", async () => {
  stop = startBykitHostSync();
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  expect(sent()).toEqual([true, false]);
  expect(mocks.request.mock.calls[0]?.[1]).toBe("host.settings.save");
});

it("retries a failed publish on the next change", async () => {
  mocks.request.mockRejectedValueOnce(new Error("offline"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stop = startBykitHostSync();
  await flush();
  toolPreferences.bykitInstructions.save(false);
  await flush();
  expect(sent()).toEqual([true, false]);
});

it("retries after the local Host was not up yet, with the switch's latest value", async () => {
  vi.useFakeTimers();
  try {
    mocks.invoke.mockResolvedValue(null);
    stop = startBykitHostSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).not.toHaveBeenCalled();
    toolPreferences.bykitInstructions.save(false);
    mocks.invoke.mockResolvedValue({ id: "local" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent()).toEqual([false]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toEqual([false]);
  } finally {
    vi.useRealTimers();
  }
});

it("publishes when the machine reports recovery after the backoff is spent", async () => {
  vi.useFakeTimers();
  try {
    mocks.invoke.mockResolvedValue(null);
    stop = startBykitHostSync();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ id: "local" });
    announceRemoteRecovery("local-env");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual([true]);
    announceRemoteRecovery("local-env");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent()).toEqual([true]);
  } finally {
    vi.useRealTimers();
  }
});

it("stops retrying once the sync is stopped", async () => {
  vi.useFakeTimers();
  try {
    mocks.invoke.mockResolvedValue(null);
    stop = startBykitHostSync();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    stop = undefined;
    mocks.invoke.mockResolvedValue({ id: "local" });
    announceRemoteRecovery("local-env");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.request).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
