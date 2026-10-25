import { expect, it, vi } from "vitest";
vi.mock("./android-device-control", () => ({
  androidDeviceControl: vi.fn(async () => "done"),
  quoteAndroidShell: vi.fn(),
}));
import { androidDeviceControl } from "./android-device-control";
import { DeviceHost } from "./device-host";
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

it("closes admission before draining existing device lanes", async () => {
  const host = new DeviceHost("/unused", { env: {} });
  const internal = host as unknown as { runForDevice: (id: string, work: () => Promise<void>) => Promise<void>; shutdown: () => Promise<void> };
  const held = gate(), later = vi.fn(async () => {}), shutdown = vi.spyOn(internal, "shutdown").mockResolvedValue();
  const accepted = internal.runForDevice("A", async () => { await held.promise; });
  await turn();
  const closing = host.dispose(), again = host.dispose();
  try {
    await expect(internal.runForDevice("B", later)).rejects.toThrow("disposed");
    expect(later).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  } finally { held.release(); await Promise.all([accepted, closing, again]); }
  expect(shutdown).toHaveBeenCalledTimes(1);
});

it("allows another device input while a screenshot waits, preserving same-device order", async () => {
  const held = gate(),
    host = new DeviceHost("/unused", { platform: "win32", env: {} });
  const internal = host as unknown as {
    device: (id: string) => Promise<unknown>;
    installed: () => Promise<boolean>;
    captureFrame: () => Promise<unknown>;
    androidBinary: () => string;
  };
  internal.device = vi.fn(async (id) => ({ id, booted: true, platform: "android" }));
  internal.installed = vi.fn(async () => true);
  internal.androidBinary = vi.fn(() => "mock-adb");
  internal.captureFrame = vi.fn(async () => {
    await held.promise;
    return { mime: "image/png", base64: "", capturedAt: "test" };
  });
  vi.mocked(androidDeviceControl).mockClear();
  const capture = host.capture("A");
  await turn();
  const sameDevice = host.action("A", { type: "press", x: 1, y: 1 });
  try {
    await host.action("B", { type: "press", x: 1, y: 1 });
    expect(androidDeviceControl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(androidDeviceControl).mock.calls[0][1]).toBe("B");
    await expect(host.capture("A")).rejects.toThrow("capture is in progress");
  } finally {
    held.release();
    await Promise.all([capture, sameDevice]);
  }
  expect(vi.mocked(androidDeviceControl).mock.calls[1][1]).toBe("A");
});

it("fences device lanes around global setup and shutdown work", async () => {
  const host = new DeviceHost("/unused", { env: {} });
  const internal = host as unknown as {
    runForDevice: <T>(id: string, work: () => Promise<T>) => Promise<T>;
    runExclusive: <T>(work: () => Promise<T>) => Promise<T>;
  };
  const device = gate(),
    setup = gate(),
    events: string[] = [];
  const first = internal.runForDevice("A", async () => {
    events.push("A");
    await device.promise;
  });
  await turn();
  const exclusive = internal.runExclusive(async () => {
    events.push("setup");
    await setup.promise;
  });
  const second = internal.runForDevice("B", async () => {
    events.push("B");
  });
  try {
    await turn();
    expect(events).toEqual(["A"]);
    device.release();
    await turn();
    expect(events).toEqual(["A", "setup"]);
    setup.release();
    await Promise.all([first, exclusive, second]);
    expect(events).toEqual(["A", "setup", "B"]);
  } finally {
    device.release();
    setup.release();
    await Promise.allSettled([first, exclusive, second]);
  }
});
