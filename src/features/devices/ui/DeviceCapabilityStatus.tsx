import { CapabilityStatus } from "../../../shared/ui/CapabilityStatus";
import type { DeviceHostStatus } from "../types";

/** The device status RPC reports tools and process facts, not an owner enable policy. */
export function DeviceCapabilityStatus({
  status,
  checking,
  unavailable,
  viewing,
  operating,
}: {
  status?: DeviceHostStatus;
  checking: boolean;
  unavailable: boolean;
  viewing: boolean;
  operating: boolean;
}) {
  const verified = !!status && !unavailable && !checking;
  return (
    <CapabilityStatus
      permission="unknown"
      readiness={
        checking
          ? "checking"
          : !verified
            ? "unknown"
            : status.running && status.installed && status.platforms.some((item) => item.available)
              ? "ready"
              : "unavailable"
      }
      activity={verified ? (viewing || operating ? "running" : "idle") : "unknown"}
    />
  );
}
