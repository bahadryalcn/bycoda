import { describe, expect, it, vi } from "vitest";
import { decodeBase64, decodeBase64Loop, decodePtyChunk, trimReplay } from "./pty";

const KB = 1024;

describe("decodePtyChunk", () => {
  it("decodes a valid base64 payload", () => {
    // "hi" in base64
    const chunk = decodePtyChunk("aGk=");
    expect(chunk).not.toBeNull();
    expect(Array.from(chunk!)).toEqual([104, 105]);
  });

  it("returns null instead of throwing on a malformed payload", () => {
    expect(() => decodePtyChunk("not valid base64!!!")).not.toThrow();
    expect(decodePtyChunk("not valid base64!!!")).toBeNull();
  });
});

describe("trimReplay", () => {
  it("keeps a small buffer whole", () => {
    const sizes = [KB, KB, KB];
    expect(trimReplay(sizes, 3 * KB)).toEqual({ drop: 0, bytes: 3 * KB });
  });

  it("drops oldest chunks once the byte budget is exceeded", () => {
    // Ten 32KB chunks is 320KB, over the 256KB budget.
    const sizes = Array(10).fill(32 * KB);
    const { drop, bytes } = trimReplay(sizes, 320 * KB);
    expect(drop).toBe(2);
    expect(bytes).toBe(256 * KB);
  });

  it("bounds a flood of tiny chunks by count", () => {
    const sizes = Array(250).fill(4);
    const { drop } = trimReplay(sizes, 1000);
    expect(sizes.length - drop).toBe(200);
  });

  it("keeps the newest chunk even when it alone exceeds the budget", () => {
    const sizes = [KB, 512 * KB];
    const { drop, bytes } = trimReplay(sizes, 513 * KB);
    expect(drop).toBe(1);
    expect(bytes).toBe(512 * KB);
  });

  it("never drops the only chunk", () => {
    const sizes = [512 * KB];
    expect(trimReplay(sizes, 512 * KB)).toEqual({ drop: 0, bytes: 512 * KB });
  });
});

describe("decodeBase64", () => {
  it("matches the loop fallback on random bytes", () => {
    for (let length = 0; length < 300; length += 7) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
      const encoded = btoa(String.fromCharCode(...bytes));
      expect(Array.from(decodeBase64(encoded))).toEqual(Array.from(bytes));
      expect(Array.from(decodeBase64Loop(encoded))).toEqual(Array.from(bytes));
    }
  });

  it("uses the native decoder when the engine provides one", () => {
    const original = (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
    const native = vi.fn(() => new Uint8Array([1, 2, 3]));
    (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 = native;
    try {
      expect(Array.from(decodeBase64("AQID"))).toEqual([1, 2, 3]);
      expect(native).toHaveBeenCalledOnce();
    } finally {
      (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 = original;
    }
  });
});
