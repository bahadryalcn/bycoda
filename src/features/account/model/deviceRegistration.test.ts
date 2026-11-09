import { DeviceRegistration } from "@bycoda/account-contracts";
import { describe, expect, it } from "vitest";
import { buildDeviceRegistration } from "./deviceRegistration";

const info = {
  name: "  Ada's laptop ",
  platform: "windows",
  osVersion: "Windows 10.0.26200",
  appVersion: "0.7.5",
  channel: "preview",
} as const;

describe("device registration payload", () => {
  it("carries only name, platform, OS, app version, channel and kind", () => {
    const payload = buildDeviceRegistration(info, null);
    expect(payload).toEqual({
      name: "Ada's laptop",
      platform: "windows",
      osVersion: "Windows 10.0.26200",
      appVersion: "0.7.5",
      channel: "preview",
      kind: "desktop",
    });
    expect(DeviceRegistration.safeParse(payload).success).toBe(true);
  });

  it("adds the issued device id on later sign-ins", () => {
    expect(buildDeviceRegistration(info, "dev_9").deviceId).toBe("dev_9");
  });

  it("keeps long values inside the contract limits", () => {
    const payload = buildDeviceRegistration(
      { ...info, name: "n".repeat(200), osVersion: "o".repeat(200), appVersion: "v".repeat(200) },
      null,
    );
    expect(DeviceRegistration.safeParse(payload).success).toBe(true);
  });

  it("falls back to a name when the computer has none", () => {
    expect(buildDeviceRegistration({ ...info, name: "  " }, null).name).toBe("This computer");
  });
});
