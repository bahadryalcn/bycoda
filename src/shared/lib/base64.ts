/**
 * Standard base64 of `bytes`. Encodes in 32 KiB slices so a multi-megabyte payload is not
 * built one character per byte on the UI thread, and stays under the engine's argument limit.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Portable path: atob plus a byte loop. Exported so tests can compare it with the native one. */
export function decodeBase64Loop(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type NativeBase64 = { fromBase64?: (data: string) => Uint8Array<ArrayBuffer> };

/**
 * Decodes standard base64 into a fresh, exactly sized buffer. Uses the native decoder where the
 * WebView has it (recent Chromium), which skips the intermediate binary string and the per-byte
 * work; throws on malformed input like `atob`.
 */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as unknown as NativeBase64).fromBase64;
  return native ? native.call(Uint8Array, data) : decodeBase64Loop(data);
}
