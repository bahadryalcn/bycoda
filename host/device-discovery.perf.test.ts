import { afterEach, expect, it, vi } from "vitest";
import { DeviceHost } from "./device-host";
import type { DeviceSummary } from "../src/features/devices/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const ios: DeviceSummary = {
  id: "ios-1",
  name: "iPhone",
  platform: "ios",
  version: "27",
  booted: true,
  physical: false,
};
const android: DeviceSummary = {
  id: "android-1",
  name: "Pixel",
  platform: "android",
  version: "16",
  booted: true,
  physical: true,
};

function discoveryHost(env: NodeJS.ProcessEnv = {}) {
  const host = new DeviceHost("/unused-synthetic-device-cache", { platform: "darwin", env });
  // A Mac runner may have an auto-detected Android SDK. Keep that optional
  // source synthetic too, so fake timers never launch a real adb process.
  vi.spyOn(host as unknown as { listMacAndroid: () => Promise<DeviceSummary[]> }, "listMacAndroid")
    .mockResolvedValue([]);
  return host;
}

it("returns healthy native discovery before a slow optional hub and shares later discovery results", async () => {
  vi.useFakeTimers();
  const host = discoveryHost();
  const internal = host as unknown as {
    request: () => Promise<Response>;
    listIos: () => Promise<DeviceSummary[]>;
  };
  const hub = vi.spyOn(internal, "request").mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(Response.json({ emulators: [android] })), 20_000);
      }),
  );
  const native = vi.spyOn(internal, "listIos").mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve([ios]), 100);
      }),
  );
  const first = host.list(),
    second = host.list();
  let initial: Awaited<ReturnType<DeviceHost["list"]>> | undefined;
  const started = Date.now();
  let firstUsableMs: number | undefined;
  void first.then((value) => {
    initial = value;
    firstUsableMs = Date.now() - started;
  });
  try {
    await vi.advanceTimersByTimeAsync(250);
    expect(initial?.devices).toEqual([ios]);
    expect(firstUsableMs).toBeLessThanOrEqual(250);
    expect(initial?.errors.join(" ")).toContain("still running");
    expect(native).toHaveBeenCalledOnce();
    expect(hub).toHaveBeenCalledOnce();
    expect(await second).toEqual(initial);
    await vi.advanceTimersByTimeAsync(19_750);
    const complete = await host.list();
    expect(complete.devices).toEqual(expect.arrayContaining([ios, android]));
    expect(complete.errors).toEqual([]);
    expect(native).toHaveBeenCalledOnce();
  } finally {
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.allSettled([first, second]);
  }
});

it("keeps waiting for a usable pending source when native discovery is empty", async () => {
  vi.useFakeTimers();
  const host = discoveryHost();
  const internal = host as unknown as { request: () => Promise<Response>; listIos: () => Promise<DeviceSummary[]> };
  vi.spyOn(internal, "listIos").mockResolvedValue([]);
  vi.spyOn(internal, "request").mockImplementation(() => new Promise((resolve) => {
    setTimeout(() => resolve(Response.json({ emulators: [android] })), 500);
  }));
  let result: Awaited<ReturnType<DeviceHost["list"]>> | undefined;
  const read = host.list().then((value) => { result = value; });
  await vi.advanceTimersByTimeAsync(250);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(250);
  await read;
  expect(result?.devices).toEqual([android]);
  expect(result?.errors).toEqual([]);
});

it("invalidates shared discovery when the selected SDK environment changes", async () => {
  const env = { DEVELOPER_DIR: "/synthetic/xcode-a" };
  const host = discoveryHost(env);
  const internal = host as unknown as {
    request: () => Promise<Response>;
    listIos: () => Promise<DeviceSummary[]>;
  };
  const hub = vi.spyOn(internal, "request").mockImplementation(async () => Response.json({}));
  const native = vi.spyOn(internal, "listIos").mockResolvedValue([ios]);
  await host.list();
  await host.list();
  expect(native).toHaveBeenCalledOnce();
  env.DEVELOPER_DIR = "/synthetic/xcode-b";
  await host.list();
  expect(native).toHaveBeenCalledTimes(2);
  expect(hub).toHaveBeenCalledTimes(2);
});
