/** Pure exact wire codec, shared by worker and fully validated fallback. */
export type VerificationChannel = "stdout" | "stderr" | "sse";
export const MAX_OUTPUT_ITEMS = 4096;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_ITEMS = MAX_OUTPUT_ITEMS;
const MAX_BYTES = MAX_OUTPUT_BYTES;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const prefix = encoder.encode("bycoda-native-output-items-v1\0");

/** Binary framing matches Native; no JSON reserialization or newline joining. */
export function frameNativeOutputItems(
  channel: VerificationChannel,
  items: readonly string[],
): Uint8Array<ArrayBuffer> {
  if (items.length < 1 || items.length > MAX_ITEMS) throw new Error("NATIVE_OUTPUT_ITEMS_CAPACITY");
  let length = 0;
  const bytes = items.map((item) => {
    if (typeof item !== "string" || item.length > MAX_BYTES)
      throw new Error("NATIVE_OUTPUT_BYTES_CAPACITY");
    const value = encoder.encode(item);
    length += value.byteLength;
    if (length > MAX_BYTES) throw new Error("NATIVE_OUTPUT_BYTES_CAPACITY");
    if (decoder.decode(value) !== item) throw new Error("NATIVE_OUTPUT_INVALID_UTF8");
    return value;
  });
  const result = new Uint8Array(prefix.length + 5 + items.length * 8 + length);
  result.set(prefix);
  result[prefix.length] = channel === "stdout" ? 1 : channel === "stderr" ? 2 : 3;
  const view = new DataView(result.buffer);
  view.setUint32(prefix.length + 1, items.length, true);
  let offset = prefix.length + 5;
  for (const item of bytes) {
    view.setUint32(offset, item.byteLength, true);
    view.setUint32(offset + 4, 0, true);
    result.set(item, offset + 8);
    offset += 8 + item.byteLength;
  }
  return result;
}

export function checkedOutputFrame(
  channel: VerificationChannel,
  items: readonly string[],
  utf8Bytes: number,
) {
  if (
    !["stdout", "stderr", "sse"].includes(channel) ||
    !Number.isSafeInteger(utf8Bytes) ||
    utf8Bytes < 0 ||
    utf8Bytes > MAX_BYTES
  )
    throw new Error("invalid-payload");
  const frame = frameNativeOutputItems(channel, items);
  if (frame.byteLength - prefix.length - 5 - items.length * 8 !== utf8Bytes)
    throw new Error("invalid-payload");
  return frame;
}
export async function digestOutputFrame(frame: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", frame);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
export async function verifyOutputItems(
  channel: VerificationChannel,
  items: readonly string[],
  utf8Bytes: number,
): Promise<string> {
  let frame: Uint8Array<ArrayBuffer>;
  try {
    frame = checkedOutputFrame(channel, items, utf8Bytes);
  } catch {
    throw new Error("invalid-payload");
  }
  return digestOutputFrame(frame);
}
