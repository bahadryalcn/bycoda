import type { DeviceRegistration } from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type { NativeDeviceInfo } from "./accountNative";

/**
 * The device registration sent after sign-in: name, platform, OS version, app version and
 * channel only. `deviceId` is the id issued earlier for this account, absent on first sign-in.
 */
export function buildDeviceRegistration(
  info: NativeDeviceInfo,
  deviceId: string | null,
): DeviceRegistration {
  return {
    ...(deviceId ? { deviceId } : {}),
    name: truncateGraphemes(info.name.trim(), 80, "") || "This computer",
    platform: info.platform,
    osVersion: truncateGraphemes(info.osVersion, 64, ""),
    appVersion: truncateGraphemes(info.appVersion, 32, ""),
    channel: info.channel,
    kind: "desktop",
  };
}
