import { loadRemoteCapabilities, remoteRequest } from "./connections";
import type { RemoteMachine } from "./protocol";

/** One credential a Host accepts: a paired phone, a desktop, or this desktop itself. */
export type PairedDevice = {
  id: string;
  name: string;
  /** The credential this desktop uses for that Host. */
  isCurrent: boolean;
  kind?: "phone" | "desktop";
  pairedAt?: number;
  lastSeenAt?: number;
  canManageDevices?: boolean;
  isLocalDesktop?: boolean;
};

export type PairedDeviceList =
  | { state: "ready"; devices: PairedDevice[]; truncated: boolean }
  /** The Host predates the device list; it needs an update first. */
  | { state: "unsupported" };

const MAX_TIME = 8_640_000_000_000_000;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const time = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TIME
    ? Number(value)
    : undefined;

/** Validates a Host's device list; optional metadata that is missing or malformed is dropped. */
export function readPairedDevices(value: unknown): { devices: PairedDevice[]; truncated: boolean } {
  const record = value as { devices?: unknown; devicesTruncated?: unknown } | null;
  if (!record || typeof record !== "object" || !Array.isArray(record.devices))
    throw new Error("The host returned an invalid device list.");
  if (record.devices.length > 256) throw new Error("The host returned an invalid device list.");
  const devices = record.devices.map((row: unknown): PairedDevice => {
    const entry = row as Record<string, unknown> | null;
    if (
      !entry ||
      typeof entry !== "object" ||
      !text(entry.id, 128) ||
      !text(entry.name, 160) ||
      typeof entry.isCurrent !== "boolean"
    )
      throw new Error("The host returned an invalid device list.");
    const kind = entry.kind === "phone" || entry.kind === "desktop" ? entry.kind : undefined;
    const pairedAt = time(entry.pairedAt);
    const lastSeenAt = time(entry.lastSeenAt);
    return {
      id: entry.id,
      name: entry.name,
      isCurrent: entry.isCurrent,
      ...(kind ? { kind } : {}),
      ...(pairedAt !== undefined ? { pairedAt } : {}),
      ...(lastSeenAt !== undefined ? { lastSeenAt } : {}),
      ...(typeof entry.canManageDevices === "boolean"
        ? { canManageDevices: entry.canManageDevices }
        : {}),
      ...(typeof entry.isLocalDesktop === "boolean"
        ? { isLocalDesktop: entry.isLocalDesktop }
        : {}),
    };
  });
  if (new Set(devices.map((device) => device.id)).size !== devices.length)
    throw new Error("The host returned an invalid device list.");
  return {
    // This desktop first, then the most recently used.
    devices: devices.sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        (b.lastSeenAt ?? b.pairedAt ?? 0) - (a.lastSeenAt ?? a.pairedAt ?? 0),
    ),
    truncated: record.devicesTruncated === true,
  };
}

/** Reads `devices.paired`, or the older `host.access.read` list (names only) on Hosts without it. */
export async function loadPairedDevices(machine: RemoteMachine): Promise<PairedDeviceList> {
  const capabilities = await loadRemoteCapabilities(machine.environmentId);
  const method = capabilities?.includes("devices.paired")
    ? "devices.paired"
    : capabilities?.includes("host.access.read")
      ? "host.access.read"
      : undefined;
  if (!method) return { state: "unsupported" };
  return { state: "ready", ...readPairedDevices(await remoteRequest(machine.id, method)) };
}

/** Whether the Host can revoke another device's credential from here. */
export async function canRevokePairedDevices(machine: RemoteMachine): Promise<boolean> {
  return Boolean(
    (await loadRemoteCapabilities(machine.environmentId))?.includes("devices.revokeOther"),
  );
}

/** Revokes another device's credential. This desktop's own one is removed with its connection. */
export async function revokePairedDevice(machine: RemoteMachine, device: PairedDevice) {
  if (device.isCurrent) throw new Error("Remove this computer's connection to revoke its access.");
  const result = await remoteRequest<{ revoked?: unknown }>(
    machine.id,
    "devices.revokeOther",
    { id: device.id },
    false,
    true,
  );
  if (result?.revoked !== true) throw new Error("This device was already removed.");
}

export async function setPairedDeviceManagement(
  machine: RemoteMachine,
  device: PairedDevice,
  enabled: boolean,
) {
  const result = await remoteRequest<{ updated?: unknown }>(
    machine.id,
    "devices.setManagement",
    { id: device.id, enabled },
    false,
    true,
    machine.environmentId,
  );
  return result?.updated === true;
}
