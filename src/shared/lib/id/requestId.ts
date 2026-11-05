/**
 * Request ids for commands, idempotency keys and operations sent to the Host.
 *
 * Ids are RFC 9562 UUIDv7: the first 48 bits are the Unix millisecond issue
 * time, so the Host can tell how old a request is and bound its replay window.
 * Ids stay opaque strings for every consumer; older UUIDv4 ids remain valid.
 */

const UUID_V7_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-7([0-9a-f]{3})-[89ab]([0-9a-f]{3})-([0-9a-f]{12})$/i;

const HEX_BYTE = Array.from({ length: 256 }, (_, index) => (index + 0x100).toString(16).slice(1));

export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let millis = Math.max(0, Math.floor(Date.now()));
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = millis % 256;
    millis = Math.floor(millis / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX_BYTE[byte]).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Returns the issue time (Unix ms) embedded in a UUIDv7 request id, or
 * undefined for any other id (such as a legacy UUIDv4).
 */
export function requestIssuedAt(id: string): number | undefined {
  const match = UUID_V7_PATTERN.exec(id);
  if (!match) return undefined;
  const millis = Number.parseInt(match[1] + match[2], 16);
  return Number.isSafeInteger(millis) ? millis : undefined;
}
