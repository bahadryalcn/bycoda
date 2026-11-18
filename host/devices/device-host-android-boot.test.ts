import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as childProcesses from "node:child_process";
import { DeviceHost } from "./device-host";
import * as deviceProcesses from "./device-process";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const avd = {
  id: "Pixel",
  name: "Pixel",
  platform: "android",
  booted: false,
  physical: false,
};
function windowsHost() {
  const host = new DeviceHost("/nonexistent-bycoda-device-cache", {
    env: { ANDROID_HOME: "C:/sdk" },
    platform: "win32",
  });
  vi.spyOn(host as unknown as { device: () => Promise<unknown> }, "device").mockResolvedValue(avd);
  return host;
}
function emulatorProcess() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(() => true),
  });
  vi.mocked(childProcesses.spawn).mockImplementationOnce(() => child as never);
  return child;
}
describe("Windows Android boot", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("polls only adb, resolves the AVD name once and backs off between polls", async () => {
    vi.useFakeTimers();
    emulatorProcess();
    const calls: string[][] = [];
    let polls = 0;
    vi.spyOn(deviceProcesses, "deviceCommand").mockImplementation(async (_exe, args) => {
      calls.push(args);
      if (args[0] === "devices") {
        polls += 1;
        return `List of devices attached\n${polls > 1 ? "emulator-5554\tdevice\n" : ""}`;
      }
      if (args[0] === "-s" && args[2] === "emu") return "Pixel\nOK\n";
      if (args.includes("getprop")) return polls < 4 ? "0" : "1";
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const booted = windowsHost().boot("Pixel");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(booted).resolves.toMatchObject({ id: "emulator-5554", booted: true });
    expect(calls.some((args) => args[0] === "-list-avds")).toBe(false);
    expect(calls.filter((args) => args[2] === "emu")).toHaveLength(1);
    expect(polls).toBe(4);
  });
});
