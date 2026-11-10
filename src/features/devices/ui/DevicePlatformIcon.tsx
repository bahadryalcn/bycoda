import { AndroidIcon, Apple } from "../../../shared/ui/icons";
import type { DevicePlatform } from "../types";

/** Platform glyph of a device; tinted with the success tone while the device is running. */
export function DevicePlatformIcon({
  platform,
  active = false,
  label,
}: {
  platform: DevicePlatform;
  active?: boolean;
  /** Names platform and state where the glyph stands alone (the picker trigger). */
  label?: string;
}) {
  const Icon = platform === "ios" ? Apple : AndroidIcon;
  return (
    <Icon
      className="icon-sm device-platform-icon"
      data-active={active || undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
