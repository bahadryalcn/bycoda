import { describe, expect, it, vi } from "vitest";
import {
  encodeHelperFrame,
  HelperFrameReader,
  HELPER_ERROR_CODES,
  isHelperAddress,
  isHelperId,
  parseHelperReply,
} from "./protocol";

describe("native helper private framing", () => {
  it("rejects nested and revoked Proxy values before running a trap or allocating serialization", () => {
    let reads = 0;
    const proxy = new Proxy(
      { payload: "small" },
      {
        get(target, key, receiver) {
          reads++;
          return key === "payload" ? "x".repeat(256 * 1024) : Reflect.get(target, key, receiver);
        },
      },
    );
    const revoked = Proxy.revocable({ payload: "small" }, {});
    revoked.revoke();
    for (const value of [proxy, { nested: proxy }, [proxy], revoked.proxy]) {
      expect(() => encodeHelperFrame(value)).toThrow("INVALID_VALUE");
    }
    expect(reads).toBe(0);
  });
  it("uses strict lower-hex pipe locators and positive exact safe IDs", () => {
    expect(isHelperAddress("\\\\.\\pipe\\bycoda-authority-v1-" + "a".repeat(32))).toBe(true);
    for (const address of [
      "x",
      "\\\\.\\pipe\\bycoda-authority-v1-" + "A".repeat(32),
      "\\\\.\\pipe\\bycoda-authority-v1-" + "a".repeat(32) + "\n",
    ])
      expect(isHelperAddress(address)).toBe(false);
    for (const id of [1, Number.MAX_SAFE_INTEGER]) expect(isHelperId(id)).toBe(true);
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])
      expect(isHelperId(id)).toBe(false);
  });
  it("retains every UTF8 byte across split headers and bodies", () => {
    const value = {
      kind: "received",
      id: 1,
      value: { text: "Türkçe 😀", empty: null },
    };
    const bytes = encodeHelperFrame(value);
    const reader = new HelperFrameReader();
    const received: unknown[] = [];
    for (const byte of bytes) reader.push(Buffer.from([byte]), (frame) => received.push(frame));
    reader.finish();
    expect(received).toEqual([value]);
  });
  it("bounds the whole envelope and rejects before allocating an oversized body", () => {
    expect(() => encodeHelperFrame({ kind: "send", id: 1, value: "x".repeat(65536) })).toThrow(
      "FRAME_TOO_LARGE",
    );
    const reader = new HelperFrameReader();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(65537);
    expect(() => reader.push(header, () => {})).toThrow("FRAME_TOO_LARGE");
  });

  it("bounds a large source value before stringify instead of allocating an unbounded intermediate", () => {
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(() => encodeHelperFrame({ value: "x".repeat(65537) })).toThrow("FRAME_TOO_LARGE");
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });
  it.each([[1], [20, 0, 0, 0, 123]])("rejects truncated data at EOF: %j", (...bytes) => {
    const reader = new HelperFrameReader();
    reader.push(Buffer.from(bytes), () => {});
    expect(() => reader.finish()).toThrow("INVALID_FRAME");
  });
  it("rejects malformed UTF8, BOM and nonfinite parsed numbers", () => {
    for (const body of [Buffer.from([0xc3, 0x28]), Buffer.from("\ufeff{}"), Buffer.from("1e400")]) {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      expect(() => new HelperFrameReader().push(Buffer.concat([header, body]), () => {})).toThrow(
        "INVALID_FRAME",
      );
    }
  });
  it("rejects lossy JSON without invoking an accessor or custom serializer", () => {
    let called = false;
    const getter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => {
        called = true;
        return "no";
      },
    });
    const cycle: any = {};
    cycle.self = cycle;
    const sparse: unknown[] = [];
    sparse.length = 2;
    const disguised: unknown[] = [];
    disguised.length = 1;
    Object.defineProperty(disguised, "1\n", {
      value: "not an array element",
      enumerable: true,
    });
    for (const value of [
      undefined,
      NaN,
      Infinity,
      1n,
      new Date(),
      getter,
      cycle,
      sparse,
      disguised,
      "\ud800",
    ])
      expect(() => encodeHelperFrame(value)).toThrow("INVALID_VALUE");
    expect(called).toBe(false);
    const shared = { kept: true };
    expect(() => encodeHelperFrame([shared, shared])).not.toThrow();
  });
  it("keeps exact reply envelopes and the agreed twelve-code error vocabulary", () => {
    expect(HELPER_ERROR_CODES).toHaveLength(12);
    for (const code of HELPER_ERROR_CODES)
      expect(parseHelperReply({ kind: "error", code })).toEqual({
        kind: "error",
        code,
      });
    for (const value of [
      { version: 1, kind: "ready", qualified: true },
      { kind: "sent", id: 0 },
      { kind: "received", id: 1 },
      { kind: "error", code: "ALLOW" },
      { kind: "sent", id: 1, value: null },
    ])
      expect(() => parseHelperReply(value)).toThrow("INVALID_FRAME");
  });
});
