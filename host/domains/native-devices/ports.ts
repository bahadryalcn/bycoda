import type { DeviceOwnerMethod } from "../../../src/shared/model/host-contracts/native-devices";

/** A retained, live result authority, never serialized or reconstructed from DTOs. */
export type DeviceResultAuthority = () => Promise<boolean>;
/** Captures the actual paired principal and environment in trusted composition. */
export interface NativeDeviceOwnerPorts {
  call(
    method: DeviceOwnerMethod,
    params: Record<string, unknown>,
    retain: (check: DeviceResultAuthority) => void,
    effectAdmitted?: () => void,
  ): Promise<unknown>;
}
