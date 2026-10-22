import type { MobileAccessStatus } from "../../../integrations/mobile-access";
import { isLanAddress, isLanKey } from "../../../integrations/mobile-lan";
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

const accessStates = new Set([
  "ready",
  "setup-required",
  "install-required",
  "sign-in-required",
  "offline",
  "approval-required",
  "permission-required",
  "unavailable",
]);
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

/** Approval links are application-owned Tailscale HTTPS pages, never RPC commands. */
export function phoneApprovalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "login.tailscale.com" &&
      !url.username &&
      !url.password &&
      !url.port
    ) {
      return url.href;
    }
  } catch {
    // An untrusted approval URL is omitted from the renderer.
  }
  return undefined;
}

export function readMobileAccessStatus(value: unknown): MobileAccessStatus {
  const input = record(value);
  if (typeof input.state !== "string" || !accessStates.has(input.state)) {
    throw new InvalidPhonePairingResponse();
  }
  let endpoint: string | undefined;
  if (input.mode !== undefined && input.mode !== "lan" && input.mode !== "tailscale")
    throw new InvalidPhonePairingResponse();
  if (input.lanKey !== undefined && (!isLanKey(input.lanKey) || input.mode !== "lan"))
    throw new InvalidPhonePairingResponse();
  if (input.mode === "lan" && input.state === "ready" && !isLanKey(input.lanKey))
    throw new InvalidPhonePairingResponse();
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
            .filter((value): value is string => typeof value === "string" && isLanAddress(value))
            .slice(0, 32),
        }
      : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(typeof input.machineName === "string" && input.machineName.length <= 120
      ? { machineName: input.machineName.trim() }
      : {}),
    ...(phoneApprovalUrl(input.approvalUrl)
      ? { approvalUrl: phoneApprovalUrl(input.approvalUrl) }
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
