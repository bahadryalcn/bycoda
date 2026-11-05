import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newRequestId, requestIssuedAt } from "./requestId";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newRequestId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("produces RFC 9562 UUIDv7 strings with the variant bits set", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(newRequestId()).toMatch(UUID_V7);
    }
  });

  it("embeds the current Unix millisecond time in the id", () => {
    const id = newRequestId();
    expect(requestIssuedAt(id)).toBe(Date.parse("2026-11-05T12:00:00.000Z"));
  });

  it("produces distinct ids for the same millisecond", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
    expect(ids.size).toBe(200);
  });

  it("takes its random bits from crypto.getRandomValues", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    newRequestId();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
  });
});

describe("requestIssuedAt", () => {
  it("reads the millisecond timestamp from a UUIDv7", () => {
    expect(requestIssuedAt("019a5f00-0000-7000-8000-000000000000")).toBe(0x019a5f000000);
    expect(requestIssuedAt("0196d2a4-1b3c-7e4f-9a2b-3c4d5e6f7a8b")).toBe(0x0196d2a41b3c);
  });

  it("accepts uppercase hex digits", () => {
    expect(requestIssuedAt("0196D2A4-1B3C-7E4F-9A2B-3C4D5E6F7A8B")).toBe(0x0196d2a41b3c);
  });

  it("returns undefined for legacy UUIDv4 ids", () => {
    expect(requestIssuedAt("3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d")).toBeUndefined();
  });

  it("returns undefined for ids that are not UUIDs", () => {
    expect(requestIssuedAt("command-123")).toBeUndefined();
    expect(requestIssuedAt("")).toBeUndefined();
    expect(requestIssuedAt("0196d2a4-1b3c-7e4f-1a2b-3c4d5e6f7a8b")).toBeUndefined();
  });
});
