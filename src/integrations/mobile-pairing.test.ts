import { describe, expect, it } from "vitest";
import {
  formatMobilePairingCode,
  parseMobilePairingCode,
  MobilePairingCodeError,
  type MobilePairingCode,
} from "./mobile-pairing";

const now = Date.now();
const code: MobilePairingCode = {
  kind: "bycoda.mobile-pairing",
  version: 1,
  endpoint: "https://desktop.example.ts.net",
  environmentId: "test-environment",
  name: "My computer",
  ticket: "A".repeat(43),
  expiresAt: new Date(now + 120_000).toISOString(),
};

describe("mobile pairing QR contract", () => {
  it("accepts private IPv4 only when its LAN key is pinned", () => {
    const lan = { ...code, endpoint: "http://192.168.1.20:3777", lanKey: "ab".repeat(32) };
    expect(parseMobilePairingCode(JSON.stringify(lan), now)).toEqual(lan);
    for (const endpoint of [
      "http://8.8.8.8",
      "http://100.64.1.2",
      "http://127.0.0.1",
      "http://private.local",
      "https://pc.example",
    ]) {
      expect(() => parseMobilePairingCode(JSON.stringify({ ...lan, endpoint }), now)).toThrow();
    }
    expect(() =>
      parseMobilePairingCode(JSON.stringify({ ...lan, lanKey: undefined }), now),
    ).toThrow();
    expect(() =>
      parseMobilePairingCode(JSON.stringify({ ...lan, lanKey: "00".repeat(32) }), now),
    ).toThrow();
  });
  it("round trips only the short-lived public endpoint and ticket", () => {
    expect(parseMobilePairingCode(formatMobilePairingCode(code), now)).toEqual(code);
    expect(formatMobilePairingCode(code)).not.toContain('"token"');
  });
  it.each([
    "http://127.0.0.1:3776",
    "http://desktop.example.ts.net",
    "https://user:password@desktop.example.ts.net",
    "https://desktop.example.ts.net/rpc",
    "https://desktop.example.ts.net/?token=secret",
    "https://desktop.example.ts.net/#secret",
  ])("rejects unsafe QR endpoint %s", (endpoint) => {
    expect(() => parseMobilePairingCode(JSON.stringify({ ...code, endpoint }), now)).toThrow(
      MobilePairingCodeError,
    );
  });
  it("preserves a dedicated HTTPS port", () => {
    expect(
      parseMobilePairingCode(
        JSON.stringify({
          ...code,
          endpoint: "https://desktop.example.ts.net:8443/",
        }),
        now,
      ).endpoint,
    ).toBe("https://desktop.example.ts.net:8443");
  });
  it("rejects expired and implausibly distant tickets", () => {
    expect(() =>
      parseMobilePairingCode(
        JSON.stringify({ ...code, expiresAt: new Date(now).toISOString() }),
        now,
      ),
    ).toThrow("expired");
    expect(() =>
      parseMobilePairingCode(
        JSON.stringify({
          ...code,
          expiresAt: new Date(now + 3600_000).toISOString(),
        }),
        now,
      ),
    ).toThrow("invalid");
  });
  it.each([
    null,
    [],
    {},
    { ...code, version: 2 },
    { ...code, ticket: "short" },
    { ...code, environmentId: "" },
  ])("rejects unsupported or malformed values", (value) => {
    expect(() => parseMobilePairingCode(JSON.stringify(value), now)).toThrow("invalid");
  });
  it("does not echo scanned secrets in failures and bounds input", () => {
    const secret = "sensitive-untrusted-content".repeat(200);
    try {
      parseMobilePairingCode(secret, now);
    } catch (error) {
      expect(String(error)).toBe("MobilePairingCodeError: invalid");
    }
  });
});
