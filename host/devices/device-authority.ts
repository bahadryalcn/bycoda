/** Captured by the request owner, never from a device/action DTO or socket life. */
export interface DeviceEffectContext {
  authorized(): boolean | Promise<boolean>;
  track?<T>(work: Promise<T>): Promise<T>;
}
export class DeviceAuthorityRevokedError extends Error {
  readonly code = "DEVICE_AUTHORITY_REVOKED";
  constructor() {
    super(
      "DEVICE_AUTHORITY_REVOKED: Device access changed. Already admitted input may have taken effect; inspect the device before repeating it.",
    );
    this.name = "DeviceAuthorityRevokedError";
  }
}
export async function assertDeviceAuthority(effect?: DeviceEffectContext): Promise<void> {
  if (!effect) return;
  try {
    if (await effect.authorized()) return;
  } catch {
    // No storage/auth diagnostics are returned through the device surface.
  }
  throw new DeviceAuthorityRevokedError();
}
