import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { isLanKey, isPrivateRouteAddress } from "../../../integrations/mobile-lan";
import {
  mobilePairingEndpoint,
  parseMobilePairingCode,
} from "../../../integrations/mobile-pairing";
import type { RemoteMachine } from "./protocol";
import type {
  PhonePairingCreated,
  PhonePairingError,
  PhonePairingStatus,
} from "./phonePairingTypes";

const accessStates = new Set(["ready", "setup-required", "unavailable"]);
const pairingStates = new Set(["pending", "paired", "expired", "cancelled"]);

export class InvalidPhonePairingResponse extends Error {
  constructor() {
    super("Invalid phone pairing response");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidPhonePairingResponse();
  }
  return value as Record<string, unknown>;
}

export function readMobileAccessStatus(value: unknown): MobileAccessStatus {
  const input = record(value);
  if (typeof input.state !== "string" || !accessStates.has(input.state)) {
    throw new InvalidPhonePairingResponse();
  }
  let endpoint: string | undefined;
  if (input.mode !== undefined && input.mode !== "lan" && input.mode !== "tailscale")
    throw new InvalidPhonePairingResponse();
  if (input.lanKey !== undefined && (!isLanKey(input.lanKey) || input.mode === undefined))
    throw new InvalidPhonePairingResponse();
  if (input.state === "ready" && !isLanKey(input.lanKey)) throw new InvalidPhonePairingResponse();
  if (input.state === "ready") {
    if (typeof input.endpoint !== "string") throw new InvalidPhonePairingResponse();
    try {
      endpoint = mobilePairingEndpoint(input.endpoint, input.lanKey as string | undefined);
    } catch {
      throw new InvalidPhonePairingResponse();
    }
  }
  return {
    state: input.state as MobileAccessStatus["state"],
    ...(input.mode ? { mode: input.mode as "lan" | "tailscale" } : {}),
    ...(input.lanKey ? { lanKey: input.lanKey as string } : {}),
    ...(Array.isArray(input.addresses)
      ? {
          addresses: input.addresses
            .filter(
              (value): value is string => typeof value === "string" && isPrivateRouteAddress(value),
            )
            .slice(0, 32),
        }
      : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(input.addressInterfaces && typeof input.addressInterfaces === "object"
      ? {
          addressInterfaces: Object.fromEntries(
            Object.entries(input.addressInterfaces)
              .filter(
                (entry): entry is [string, string] =>
                  isPrivateRouteAddress(entry[0]) &&
                  typeof entry[1] === "string" &&
                  entry[1].length <= 256,
              )
              .slice(0, 32),
          ),
        }
      : {}),
    ...(typeof input.networkHint === "string" && input.networkHint.length <= 500
      ? { networkHint: input.networkHint }
      : {}),
    ...(typeof input.reason === "string" && input.reason.length <= 500
      ? { reason: input.reason }
      : {}),
    ...(typeof input.machineName === "string" && input.machineName.length <= 120
      ? { machineName: input.machineName.trim() }
      : {}),
  };
}

export function readPhonePairingCreated(
  value: unknown,
  machine: RemoteMachine,
): PhonePairingCreated {
  const input = record(value);
  if (
    typeof input.pairingId !== "string" ||
    !input.pairingId ||
    input.pairingId.length > 200 ||
    typeof input.ticket !== "string" ||
    typeof input.expiresAt !== "string" ||
    input.environmentId !== machine.environmentId
  ) {
    throw new InvalidPhonePairingResponse();
  }
  return {
    pairingId: input.pairingId,
    ticket: input.ticket,
    expiresAt: input.expiresAt,
    environmentId: machine.environmentId,
  };
}

export function readPhonePairingStatus(value: unknown): PhonePairingStatus {
  const input = record(value);
  if (typeof input.state !== "string" || !pairingStates.has(input.state)) {
    throw new InvalidPhonePairingResponse();
  }
  return {
    state: input.state as PhonePairingStatus["state"],
    ...(typeof input.deviceName === "string" && input.deviceName.length <= 120
      ? { deviceName: input.deviceName.trim() }
      : {}),
  };
}

export function phonePairingError(error: unknown): PhonePairingError {
  if (error instanceof InvalidPhonePairingResponse) return "invalid-response";
  const message = String(error);
  if (message.includes("Device management permission required")) return "management-required";
  if (/unknown method|not supported|unsupported method|method not found/i.test(message)) {
    return "host-update";
  }
  // Native/host diagnostic text can contain addresses or subprocess output.
  // The UI displays bounded application-owned recovery copy instead.
  return "connection";
}

export function phonePairingCode(
  machine: RemoteMachine,
  access: MobileAccessStatus,
  created: PhonePairingCreated,
) {
  try {
    return parseMobilePairingCode(
      JSON.stringify({
        kind: "bycoda.mobile-pairing",
        version: 1,
        endpoint: access.endpoint,
        lanKey: access.lanKey,
        environmentId: created.environmentId,
        name: access.machineName || machine.name,
        ticket: created.ticket,
        expiresAt: created.expiresAt,
      }),
    );
  } catch {
    throw new InvalidPhonePairingResponse();
  }
}
