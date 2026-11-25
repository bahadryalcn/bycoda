import { HOST_HTTP_MAX_RESPONSE_BYTES } from "../shared/model/host-contracts/response-limit";

/** Pure wire contract for QR-pinned, encrypted local-network mobile access. */
export const MOBILE_LAN_VERSION = 1;
/** The decrypted inner body is the Host `/rpc` body, so its cap is the Host response cap. */
export const MOBILE_LAN_MAX_BYTES = HOST_HTTP_MAX_RESPONSE_BYTES;
export const MOBILE_LAN_MAX_WIRE_BYTES = MOBILE_LAN_MAX_BYTES * 2 + 4096;
export const MOBILE_LAN_WINDOW_MS = 60_000;
export type MobileAccessMode = "lan" | "tailscale";
export type MobileLanEnvelope = { version: 1; id: string; publicKey: string; data: string };

function ipv4Octets(value: string): number[] | undefined {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    return undefined;
  return parts.map(Number);
}
export function isLanAddress(value: string): boolean {
  const octets = ipv4Octets(value);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
/** Tailscale's CGNAT range, 100.64.0.0/10: reachable only by devices on the same tailnet. */
export function isTailnetAddress(value: string): boolean {
  const octets = ipv4Octets(value);
  return !!octets && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
/** Addresses a keyed (encrypted, host-key pinned) phone route may use: a home network or
 * this computer's tailnet. Never widen `isLanAddress` for this; the Host picks listener
 * addresses with it. */
export function isPrivateRouteAddress(value: string): boolean {
  return isLanAddress(value) || isTailnetAddress(value);
}
export function isLanKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value);
}
export function lanContext(
  environmentId: string,
  serverKey: string,
  publicKey: string,
  id: string,
  direction: "request" | "response",
): string {
  return JSON.stringify([
    "bycoda.mobile-lan.v1",
    environmentId,
    serverKey,
    publicKey,
    id,
    direction,
  ]);
}
export function readLanEnvelope(value: unknown): MobileLanEnvelope {
  const input = value as Partial<MobileLanEnvelope> | null;
  if (
    !input ||
    input.version !== 1 ||
    !isLanKey(input.id) ||
    !isLanKey(input.publicKey) ||
    typeof input.data !== "string" ||
    input.data.length < 32 ||
    input.data.length > MOBILE_LAN_MAX_WIRE_BYTES ||
    input.data.length % 2 ||
    !/^[0-9a-f]+$/.test(input.data)
  )
    throw new Error("Invalid encrypted mobile request.");
  return input as MobileLanEnvelope;
}
