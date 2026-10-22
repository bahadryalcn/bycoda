/** Pure wire contract for QR-pinned, encrypted local-network mobile access. */
export const MOBILE_LAN_VERSION = 1;
export const MOBILE_LAN_MAX_BYTES = 16 * 1024 * 1024;
export const MOBILE_LAN_MAX_WIRE_BYTES = MOBILE_LAN_MAX_BYTES * 2 + 4096;
export const MOBILE_LAN_WINDOW_MS = 60_000;
export type MobileAccessMode = "lan" | "tailscale";
export type MobileLanEnvelope = { version: 1; id: string; publicKey: string; data: string };

export function isLanAddress(value: string): boolean {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
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
