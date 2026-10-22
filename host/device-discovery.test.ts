import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeviceHost } from "./device-host";
import * as processes from "./device-process";
import type { DeviceSummary } from "../src/features/devices/types";

describe("independent discovery identities and sources", () => {
  it("retains same-model phones and only reconciles the matching stopped emulator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-discovery-"));
    await mkdir(join(directory, "emulator"));
    await writeFile(join(directory, "emulator", "emulator.exe"), "");
    const host = new DeviceHost(directory, { platform: "win32", env: { ANDROID_HOME: directory } });
    const command = vi.spyOn(processes, "deviceCommand").mockImplementation(async (_exe, args) => {
      if (args[0] === "devices")
        return "List of devices attached\nSERIAL_A device model:Pixel_9\nSERIAL_B device model:Pixel_9\nemulator-5554 device model:Pixel_9\n";
      if (args[0] === "-list-avds") return "Pixel 9\nStopped\n";
      expect(args).toEqual(["-s", "emulator-5554", "emu", "avd", "name"]);
      return "Pixel 9\nOK\n";
    });
    try {
      const { devices } = await host.list();
      expect(devices.map(({ id }) => id)).toEqual([
        "emulator-5554",
        "Stopped",
        "SERIAL_A",
        "SERIAL_B",
      ]);
      expect(devices.filter(({ physical }) => physical).map(({ name }) => name)).toEqual([
        "Pixel 9",
        "Pixel 9",
      ]);
      expect(devices.find(({ id }) => id === "emulator-5554")).toMatchObject({
        booted: true,
        physical: false,
      });
      expect(devices.find(({ id }) => id === "Stopped")).toMatchObject({
        booted: false,
        physical: false,
      });
      // A refresh remains stable after the stopped-to-running transition.
      expect((await host.list()).devices).toEqual(devices);
    } finally {
      command.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  for (let mask = 0; mask < 8; mask++) {
    it(`handles every Mac discovery source combination (${mask})`, async () => {
      const host = new DeviceHost("/unused-device-fixture", {
        platform: "darwin",
        env: { ANDROID_HOME: "/synthetic-sdk" },
      });
      const sources = host as unknown as {
        request: () => Promise<Response>;
        listIos: () => Promise<DeviceSummary[]>;
        listMacAndroid: () => Promise<DeviceSummary[]>;
      };
      const device = (id: string, platform: "ios" | "android"): DeviceSummary => ({
        id,
        name: id,
        platform,
        version: "test",
        booted: true,
        physical: platform === "android",
      });
      const hub = vi.spyOn(sources, "request");
      const ios = vi.spyOn(sources, "listIos");
      const android = vi.spyOn(sources, "listMacAndroid");
      if (mask & 1) hub.mockResolvedValue(Response.json({ simulators: [device("hub", "ios")] }));
      else hub.mockRejectedValue(new Error("hub offline"));
      if (mask & 2) ios.mockResolvedValue([device("ios", "ios")]);
      else ios.mockRejectedValue(new Error("Install Xcode for iOS discovery"));
      if (mask & 4) android.mockResolvedValue([device("phone", "android")]);
      else android.mockRejectedValue(new Error("Android SDK unavailable"));
      try {
        if (!mask) await expect(host.list()).rejects.toThrow("hub offline");
        else {
          const result = await host.list();
          expect(result.devices.map(({ id }) => id)).toEqual([
            ...(mask & 2 ? ["ios"] : mask & 1 ? ["hub"] : []),
            ...(mask & 4 ? ["phone"] : []),
          ]);
          for (const [bit, warning] of [
            [1, "hub offline"],
            [2, "Install Xcode"],
            [4, "Android SDK unavailable"],
          ] as const) {
            expect(result.errors.some((error) => error.includes(warning))).toBe(!(mask & bit));
          }
        }
      } finally {
        hub.mockRestore();
        ios.mockRestore();
        android.mockRestore();
      }
    });
  }

  it("does not treat an unconfigured Android source as a successful fallback", async () => {
    const host = new DeviceHost("/unused-device-fixture", { platform: "linux", env: {} });
    // Linux has neither native source; their resolved placeholders cannot mask hub failure.
    await expect(host.list()).rejects.toThrow("stopped");
  });
});
