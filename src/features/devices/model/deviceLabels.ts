import { t } from "../../../shared/i18n/technical";
import type { DeviceSummary } from "../types";

export const platformLabel = (platform: DeviceSummary["platform"]) =>
  platform === "ios" ? t("iOS") : t("Android");

/** Platform and version; a version that only repeats the platform (or is missing) is dropped. */
export function platformVersionLabel(item: DeviceSummary) {
  const platform = platformLabel(item.platform);
  const version = typeof item.version === "string" ? item.version.trim() : "";
  return !version || version.toLowerCase() === platform.toLowerCase()
    ? platform
    : `${platform} ${version}`;
}

export const kindLabel = (item: DeviceSummary) =>
  item.physical ? t("Physical device") : item.platform === "ios" ? t("Simulator") : t("Emulator");

export const stateLabel = (item: DeviceSummary) =>
  item.physical
    ? item.booted
      ? t("Connected")
      : t("Not ready")
    : item.booted
      ? t("Running")
      : t("Stopped");
