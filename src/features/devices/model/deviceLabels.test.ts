import { expect, it } from "vitest";
import { kindLabel, platformVersionLabel, stateLabel } from "./deviceLabels";
import type { DeviceSummary } from "../types";

const device: DeviceSummary = {
  id: "emulator",
  name: "Android emulator",
  platform: "android",
  version: "16",
  booted: false,
  physical: false,
};

it("names the platform once, with its version when that adds something", () => {
  expect(platformVersionLabel(device)).toBe("Android 16");
  expect(platformVersionLabel({ ...device, version: " aNdRoId " })).toBe("Android");
  for (const version of [undefined, null, 16])
    expect(platformVersionLabel({ ...device, version: version as unknown as string })).toBe(
      "Android",
    );
});

it("describes kind and state by platform and connection", () => {
  expect([kindLabel(device), stateLabel(device)]).toEqual(["Emulator", "Stopped"]);
  expect(stateLabel({ ...device, booted: true })).toBe("Running");
  expect(kindLabel({ ...device, platform: "ios" })).toBe("Simulator");
  const phone = { ...device, physical: true };
  expect([kindLabel(phone), stateLabel(phone)]).toEqual(["Physical device", "Not ready"]);
  expect(stateLabel({ ...phone, booted: true })).toBe("Connected");
});
