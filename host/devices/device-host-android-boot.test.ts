import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as childProcesses from "node:child_process";
import { DeviceHost } from "./device-host";
import { DeviceAuthorityRevokedError } from "./device-authority";
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
    pid: 4242,
    exitCode: null as number | null,
    signalCode: null,
    stderr: new PassThrough(),
    unref: vi.fn(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    }),
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
  it("stops the emulator and reports its stderr when boot times out", async () => {
    vi.useFakeTimers();
    const child = emulatorProcess();
    const calls: string[][] = [];
    vi.spyOn(deviceProcesses, "deviceCommand").mockImplementation(async (_exe, args) => {
      calls.push(args);
      return "List of devices attached\n";
    });
    child.stderr.write("PANIC: HAX is not working");
    const booted = windowsHost().boot("Pixel");
    const assertion = expect(booted).rejects.toThrow(/180 seconds.*HAX is not working/s);
    await vi.advanceTimersByTimeAsync(200_000);
    await assertion;
    expect(calls).toContainEqual(["/pid", "4242", "/T", "/F"]);
    expect(child.kill).toHaveBeenCalled();
  });
  it("stops the emulator when device authority is revoked mid-boot", async () => {
    vi.useFakeTimers();
    const child = emulatorProcess();
    const calls: string[][] = [];
    vi.spyOn(deviceProcesses, "deviceCommand").mockImplementation(async (_exe, args) => {
      calls.push(args);
      return "List of devices attached\n";
    });
    let authorized = true;
    const booted = windowsHost().boot("Pixel", { authorized: () => authorized });
    const assertion = expect(booted).rejects.toBeInstanceOf(DeviceAuthorityRevokedError);
    await vi.advanceTimersByTimeAsync(2000);
    authorized = false;
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(calls).toContainEqual(["/pid", "4242", "/T", "/F"]);
    expect(child.kill).toHaveBeenCalled();
  });
});
