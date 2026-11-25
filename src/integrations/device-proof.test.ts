import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  base64urlDecode,
  base64urlEncode,
  deviceProofKeyFromSeed,
  deviceProofThumbprint,
  parseDeviceProofJwk,
  signDeviceProof,
  verifyDeviceProof,
} from "./device-proof";

const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
const token = base64urlEncode(Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index));
const environmentId = "00000000-0000-4000-8000-000000000001";
const jti = base64urlEncode(Uint8Array.from({ length: 16 }, (_, index) => index));
const iat = 1_790_000_000;
const base = { token, method: "POST", path: "/rpc", environmentId };
const key = deviceProofKeyFromSeed(seed);

function sign(overrides: Partial<Parameters<typeof signDeviceProof>[0]> = {}) {
  return signDeviceProof({ seed, ...base, jti, iat, ...overrides });
}
function verify(proof: string, overrides: Partial<Parameters<typeof verifyDeviceProof>[0]> = {}) {
  return verifyDeviceProof({
    proof,
    ...base,
    expectedJkt: key.jkt,
    now: iat,
    ...overrides,
  });
}
/** Re-signs a tampered payload or header with the real key so only the claim is wrong. */
function resign(edit: (header: Record<string, unknown>, claims: Record<string, unknown>) => void) {
  const [h, p] = sign().split(".");
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(h)!));
  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(p)!));
  edit(header, claims);
  const encode = (value: unknown) =>
    base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode(header)}.${encode(claims)}`;
  return signRaw(input);
}
function signRaw(input: string) {
  return `${input}.${base64urlEncode(ed25519.sign(new TextEncoder().encode(input), seed))}`;
}

describe("device proof", () => {
  it("pins the shared vector", () => {
    expect(key.publicJwk).toEqual({
      kty: "OKP",
      crv: "Ed25519",
      x: "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg",
    });
    expect(key.jkt).toBe("1IG2tMH7J2wbJZnOf8LJzQitKf7LMvoAElsuDMVM54Y");
    expect(token).toBe("gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8");
    expect(jti).toBe("AAECAwQFBgcICQoLDA0ODw");
    expect(sign()).toBe(
      "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVkRFNBIiwiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiQTZFSHZfUE9FTDRkY04wWTUwdkFtV2ZrMWpDYnBRMWZIZHlHWkJKVk1iZyJ9fQ.eyJqdGkiOiJBQUVDQXdRRkJnY0lDUW9MREEwT0R3IiwiaHRtIjoiUE9TVCIsImh0dSI6Ii9ycGMiLCJpYXQiOjE3OTAwMDAwMDAsImF0aCI6InJONHpKMjhBRzczUGJzSjJuUjhsSFdIMGVJcU51S1NWckc0QndIYVJIR0UiLCJlaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ.MFIkUC7G-TknFRRokVtOYcsWXHjsyrjtskB9-UgEvq4SEV2zoVtxYIIwfr-PECPOfAXx-sikHf1dA-qjL076Aw",
    );
  });

  it("verifies a signed proof", () => {
    expect(verify(sign())).toEqual({ ok: true, jti, iat, jwk: key.publicJwk });
    expect(
      verify(sign({ path: "/ws-bulk/abc?offset=0" }), { path: "/ws-bulk/abc?offset=0" }).ok,
    ).toBe(true);
    expect(deviceProofThumbprint(key.publicJwk)).toBe(key.jkt);
  });

  it("rejects tampering", () => {
    const [h, p, s] = sign().split(".");
    const flip = (value: string) => `${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;
    expect(verify(`${h}.${p}.${flip(s)}`)).toEqual({ ok: false, reason: "signature" });
    expect(verify(`${h}.${flip(p)}.${s}`).ok).toBe(false);
    expect(verify(sign(), { method: "GET" })).toEqual({ ok: false, reason: "claims" });
    expect(verify(sign(), { path: "/ws" })).toEqual({ ok: false, reason: "claims" });
    expect(verify(sign(), { token: `${token.slice(1)}A` })).toEqual({
      ok: false,
      reason: "claims",
    });
    expect(verify(sign(), { environmentId: "other" })).toEqual({ ok: false, reason: "claims" });
    expect(verify(sign(), { expectedJkt: "x".repeat(43) })).toEqual({ ok: false, reason: "key" });
  });

  it("enforces the clock skew both ways", () => {
    expect(verify(sign(), { now: iat + 120 }).ok).toBe(true);
    expect(verify(sign(), { now: iat - 120 }).ok).toBe(true);
    expect(verify(sign(), { now: iat + 121 })).toEqual({ ok: false, reason: "stale" });
    expect(verify(sign(), { now: iat - 121 })).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects malformed structure and keys", () => {
    for (const proof of ["", "a.b", "a.b.c.d", "a..c", `${sign()}x`, "a b.c.d", "x".repeat(2100)])
      expect(verify(proof)).toEqual({ ok: false, reason: "malformed" });
    expect(verify(resign((h) => (h.typ = "jwt")))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(resign((h) => (h.alg = "ES256")))).toEqual({ ok: false, reason: "malformed" });
    expect(verify(resign((h) => ((h.jwk as Record<string, unknown>).d = "x")))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(resign((h) => ((h.jwk as Record<string, unknown>).crv = "P-256")))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(resign((h) => ((h.jwk as Record<string, unknown>).x = "AAAA")))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verify(resign((_, c) => delete c.jti))).toEqual({ ok: false, reason: "claims" });
    expect(verify(resign((_, c) => (c.iat = "1")))).toEqual({ ok: false, reason: "claims" });
    expect(verify(resign((_, c) => (c.htu = "/other")))).toEqual({ ok: false, reason: "claims" });
  });

  it("accepts only exact Ed25519 public JWKs", () => {
    expect(parseDeviceProofJwk(key.publicJwk)).toEqual(key.publicJwk);
    expect(parseDeviceProofJwk({ ...key.publicJwk, extra: 1 })).toBeUndefined();
    expect(
      parseDeviceProofJwk({ ...key.publicJwk, x: `${key.publicJwk.x.slice(0, 42)}B` }),
    ).toBeUndefined();
    expect(parseDeviceProofJwk("nope")).toBeUndefined();
    expect(base64urlDecode("AA==")).toBeUndefined();
    expect(base64urlDecode("A")).toBeUndefined();
  });
});
