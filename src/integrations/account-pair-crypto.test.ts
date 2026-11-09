import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  generatePairKeypair,
  openPairTicket,
  pairSasCode,
  sealPairTicket,
} from "./account-pair-crypto";

const AAD = "req_1|phone_1|desk_1|env_1";
const TICKET = JSON.stringify({
  kind: "bycoda.mobile-pairing",
  ticket: "secret",
});

describe("account pair crypto", () => {
  it("round-trips a ticket", async () => {
    const phone = await generatePairKeypair();
    const sealed = await sealPairTicket(TICKET, phone.publicKey, AAD);
    expect(sealed.desktopPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sealed.sealed.length).toBeLessThanOrEqual(2048);
    expect(openPairTicket(sealed, phone.privateKey, AAD)).toBe(TICKET);
  });

  it("rejects a different AAD, a different phone key and tampering", async () => {
    const phone = await generatePairKeypair();
    const other = await generatePairKeypair();
    const sealed = await sealPairTicket(TICKET, phone.publicKey, AAD);
    expect(() => openPairTicket(sealed, phone.privateKey, "req_2|phone_1|desk_1|env_1")).toThrow();
    expect(() => openPairTicket(sealed, other.privateKey, AAD)).toThrow();
    const bytes = base64UrlToBytes(sealed.sealed);
    bytes[bytes.length - 1]! ^= 1;
    expect(() =>
      openPairTicket({ ...sealed, sealed: bytesToBase64Url(bytes) }, phone.privateKey, AAD),
    ).toThrow();
    expect(() => openPairTicket({ ...sealed, sealed: "AAAA" }, phone.privateKey, AAD)).toThrow();
  });

  it("uses a fresh nonce and key per seal", async () => {
    const phone = await generatePairKeypair();
    const a = await sealPairTicket(TICKET, phone.publicKey, AAD);
    const b = await sealPairTicket(TICKET, phone.publicKey, AAD);
    expect(a.sealed).not.toBe(b.sealed);
    expect(a.desktopPublicKey).not.toBe(b.desktopPublicKey);
  });

  it("derives a deterministic six digit code", () => {
    const publicKey = bytesToBase64Url(new Uint8Array(32).fill(7));
    const code = pairSasCode("req_1", publicKey);
    expect(code).toMatch(/^\d{6}$/);
    expect(pairSasCode("req_1", publicKey)).toBe(code);
    expect(code).toBe("527993");
    expect(pairSasCode("req_2", publicKey)).not.toBe(code);
  });

  it("round-trips base64url", () => {
    for (const size of [0, 1, 2, 3, 32, 33]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 37 + 11) & 255);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
  });
});
