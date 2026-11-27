// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invoke: vi.fn(),
  disabled: [] as string[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("./models", () => ({
  disabledModelIds: () => mocks.disabled,
  subscribeModels: () => () => undefined,
}));
import { announceRemoteRecovery } from "../../connections/model/remoteHealth";
import { startModelEnabledHostSync } from "./modelEnabledHostSync";

let stop: (() => void) | undefined;
const sent = () => mocks.request.mock.calls.map((call) => call[2].disabledModels);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.disabled = ["model-a"];
  mocks.request.mockReset().mockResolvedValue({});
  mocks.invoke.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

it("publishes the disabled models once the local Host is up, after a cold start", async () => {
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValue({ id: "local" });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent()).toEqual([["model-a"]]);
  expect(mocks.request.mock.calls[0]?.[1]).toBe("host.settings.save");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sent()).toEqual([["model-a"]]);
});

it("publishes the current list when the machine reports recovery", async () => {
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.disabled = ["model-a", "model-b"];
  mocks.invoke.mockResolvedValue({ id: "local" });
  announceRemoteRecovery("local-env");
  await vi.advanceTimersByTimeAsync(0);
  expect(sent()).toEqual([["model-a", "model-b"]]);
});

it("re-sends the confirmed list after the local Host recovers, even when unchanged", async () => {
  mocks.invoke.mockResolvedValue({ id: "local" });
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent()).toEqual([["model-a"]]);
  announceRemoteRecovery("local-env");
  await vi.advanceTimersByTimeAsync(0);
  expect(sent()).toEqual([["model-a"], ["model-a"]]);
});

it("re-sends the current list after a failed push without waiting for another change", async () => {
  mocks.invoke.mockResolvedValue({ id: "local" });
  mocks.request.mockRejectedValueOnce(new Error("down")).mockResolvedValue({});
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent()).toEqual([["model-a"], ["model-a"]]);
});

it("publishes a change made while a push is in flight when that push fails", async () => {
  mocks.invoke.mockResolvedValue({ id: "local" });
  let fail: (error: Error) => void = () => undefined;
  mocks.request
    .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
    .mockResolvedValue({});
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(0);
  mocks.disabled = ["model-a", "model-b"];
  fail(new Error("down"));
  await vi.advanceTimersByTimeAsync(0);
  expect(sent()).toEqual([["model-a"], ["model-a", "model-b"]]);
});

it("keeps the bounded backoff when every push fails", async () => {
  mocks.invoke.mockResolvedValue({ id: "local" });
  mocks.request.mockRejectedValue(new Error("down"));
  stop = startModelEnabledHostSync();
  await vi.advanceTimersByTimeAsync(500);
  expect(sent()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent()).toHaveLength(2);
});
