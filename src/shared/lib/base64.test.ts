import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, decodeBase64, decodeBase64Loop } from "./base64";

type NativeSlot = { fromBase64?: unknown };

describe("decodeBase64", () => {
  it("matches the loop fallback on random bytes", () => {
    for (let length = 0; length < 300; length += 7) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
      const encoded = bytesToBase64(bytes);
      expect(Array.from(decodeBase64(encoded))).toEqual(Array.from(bytes));
      expect(Array.from(decodeBase64Loop(encoded))).toEqual(Array.from(bytes));
    }
  });

  it("returns a buffer that holds exactly the decoded bytes", () => {
    const bytes = decodeBase64("AQID");
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(3);
  });

  it("throws on malformed input, with or without the native decoder", () => {
    expect(() => decodeBase64("not valid base64!!!")).toThrow();
    expect(() => decodeBase64Loop("not valid base64!!!")).toThrow();
  });

  it("uses the native decoder when the engine provides one", () => {
    const slot = Uint8Array as unknown as NativeSlot;
    const original = slot.fromBase64;
    const native = vi.fn(() => new Uint8Array([1, 2, 3]));
    slot.fromBase64 = native;
    try {
      expect(Array.from(decodeBase64("AQID"))).toEqual([1, 2, 3]);
      expect(native).toHaveBeenCalledOnce();
    } finally {
      slot.fromBase64 = original;
    }
  });

  it("falls back to the loop when the engine has no native decoder", () => {
    const slot = Uint8Array as unknown as NativeSlot;
    const original = slot.fromBase64;
    slot.fromBase64 = undefined;
    try {
      expect(Array.from(decodeBase64("AQID"))).toEqual([1, 2, 3]);
    } finally {
      slot.fromBase64 = original;
    }
  });
});
