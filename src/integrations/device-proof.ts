import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Device proof-of-possession (DPoP-style, spec v1): a paired device credential is bound to an
 * Ed25519 key, and every request carries a short-lived signed proof. Pure TypeScript with no
 * Node-only API, so the Host, the desktop and the Expo app share one implementation. Replay
 * checking (jti) is the Host's job; this module checks structure, signature and claims.
 */
export const DEVICE_PROOF_HEADER = "DPoP";
export const DEVICE_PROOF_CAPABILITY = "auth.deviceProof.v1";
export const DEVICE_PROOF_MAX_BYTES = 2048;
export const DEVICE_PROOF_SKEW_SECONDS = 120;
export const DEVICE_PROOF_REPLAY_SECONDS = 300;

export type DeviceProofJwk = { kty: "OKP"; crv: "Ed25519"; x: string };
export type DeviceProofKey = { publicJwk: DeviceProofJwk; jkt: string };

export type DeviceProofClaims = {
  jti: string;
  htm: string;
  htu: string;
  iat: number;
  ath: string;
  eid: string;
  /**
   * Set on a request the client sends before it has durably saved this credential (the check that
   * precedes saving a new pairing). The proof authenticates the request but does not show the
   * credential is in use, so it never retires the credential this one replaces.
   */
  unsaved?: true;
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Unpadded base64url. */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

/** Strict unpadded base64url; undefined for any other input (including non-canonical tails). */
export function base64urlDecode(value: string): Uint8Array | undefined {
  if (!SEGMENT.test(value) || value.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (let i = 0; i < value.length; i++) {
    acc = (acc << 6) | ALPHABET.indexOf(value[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  // Unused trailing bits must be zero, so one byte string has one encoding.
  return acc === 0 ? bytes : undefined;
}

function asciiToString(bytes: Uint8Array): string | undefined {
  let out = "";
  for (const byte of bytes) {
    if (byte > 0x7f) return undefined;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** 32 random bytes: the private key seed. Store it in the platform's secure storage. */
export function generateDeviceProofSeed(): Uint8Array {
  return randomBytes(32);
}

/** Request path without query or fragment, the value bound as `htu`. */
export function deviceProofPath(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/** RFC 7638 thumbprint of an Ed25519 public key: members in the fixed order crv, kty, x. */
export function deviceProofThumbprint(jwk: DeviceProofJwk): string {
  return base64urlEncode(sha256(utf8ToBytes(`{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`)));
}

/** The JWK only when it is exactly `{kty:"OKP",crv:"Ed25519",x}` with a 32-byte `x`. */
export function parseDeviceProofJwk(value: unknown): DeviceProofJwk | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const jwk = value as Record<string, unknown>;
  const keys = Object.keys(jwk);
  if (keys.length !== 3 || jwk.kty !== "OKP" || jwk.crv !== "Ed25519") return undefined;
  if (typeof jwk.x !== "string" || jwk.x.length !== 43) return undefined;
  if (base64urlDecode(jwk.x)?.length !== 32) return undefined;
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

/** The public JWK and thumbprint for a 32-byte seed. */
export function deviceProofKeyFromSeed(seed: Uint8Array): DeviceProofKey {
  if (seed.length !== 32) throw new Error("A device proof seed is 32 bytes.");
  const publicJwk: DeviceProofJwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: base64urlEncode(ed25519.getPublicKey(seed)),
  };
  return { publicJwk, jkt: deviceProofThumbprint(publicJwk) };
}

/** `base64url(SHA-256(ASCII token))`, the `ath` claim. */
export function deviceProofTokenHash(token: string): string {
  return base64urlEncode(sha256(utf8ToBytes(token)));
}

export type SignDeviceProofInput = {
  seed: Uint8Array;
  token: string;
  /** HTTP method; uppercased. A WebSocket upgrade is `GET`. */
  method: string;
  /** Request path; a query or fragment is dropped. */
  path: string;
  environmentId: string;
  /** Defaults to 16 random bytes. Tests pin it. */
  jti?: string;
  /** Unix seconds; defaults to now. */
  iat?: number;
  /** The client has not saved this credential yet; see `DeviceProofClaims.unsaved`. */
  unsaved?: boolean;
};

/** The compact JWS to send in the `DPoP` header of one request. */
export function signDeviceProof(input: SignDeviceProofInput): string {
  const { publicJwk } = deviceProofKeyFromSeed(input.seed);
  const header = { typ: "dpop+jwt", alg: "EdDSA", jwk: publicJwk };
  const claims: DeviceProofClaims = {
    jti: input.jti ?? base64urlEncode(randomBytes(16)),
    htm: input.method.toUpperCase(),
    htu: deviceProofPath(input.path),
    iat: input.iat ?? Math.floor(Date.now() / 1000),
    ath: deviceProofTokenHash(input.token),
    eid: input.environmentId,
    ...(input.unsaved ? { unsaved: true as const } : {}),
  };
  const signingInput = `${base64urlEncode(utf8ToBytes(JSON.stringify(header)))}.${base64urlEncode(
    utf8ToBytes(JSON.stringify(claims)),
  )}`;
  return `${signingInput}.${base64urlEncode(ed25519.sign(utf8ToBytes(signingInput), input.seed))}`;
}

/**
 * A client that pairs again with a Host it already holds a credential for proves possession of
 * the earlier key, so the Host retires that credential once the new one is in use. The signature
 * covers this claim and the new key, so it cannot be replayed for another pairing or another key.
 */
export type DeviceReplacementProof = { proofKey: DeviceProofJwk; signature: string };

type DeviceReplacementContext = {
  /** The redemption's claim ID (base64url, so the fields cannot run into each other). */
  claimId: string;
  /** The key the new credential is bound to. */
  proofKey: DeviceProofJwk;
  environmentId: string;
};

const replacementMessage = (context: DeviceReplacementContext): Uint8Array =>
  utf8ToBytes(
    `bycoda.device-replacement.v1\n${context.claimId}\n${deviceProofThumbprint(context.proofKey)}\n${context.environmentId}`,
  );

/** Signed with the seed of the earlier credential's key. */
export function signDeviceReplacement(
  previousSeed: Uint8Array,
  context: DeviceReplacementContext,
): DeviceReplacementProof {
  return {
    proofKey: deviceProofKeyFromSeed(previousSeed).publicJwk,
    signature: base64urlEncode(ed25519.sign(replacementMessage(context), previousSeed)),
  };
}

/** The thumbprint of the earlier key when the proof is valid for this redemption, else undefined. */
export function verifyDeviceReplacement(
  value: unknown,
  context: DeviceReplacementContext,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { proofKey, signature } = value as Record<string, unknown>;
  const jwk = parseDeviceProofJwk(proofKey);
  const bytes = typeof signature === "string" ? base64urlDecode(signature) : undefined;
  if (!jwk || bytes?.length !== 64) return undefined;
  try {
    return ed25519.verify(bytes, replacementMessage(context), base64urlDecode(jwk.x)!)
      ? deviceProofThumbprint(jwk)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a phone sends at pairing to name its installation when its keys did not survive: a hash of
 * a platform identifier that outlives a reinstall (Android's app-scoped `ANDROID_ID`) with the
 * Host's environment ID, so the raw identifier never leaves the phone and two Hosts see unrelated
 * values. It is an identifier, not a secret or a proof; `HostStore.issueDevice` says what it may do.
 */
export function deviceInstallId(platformId: string, environmentId: string): string {
  return base64urlEncode(
    sha256(utf8ToBytes(`bycoda.device-install.v1\n${environmentId}\n${platformId}`)),
  );
}

/** The install ID only when it is one unpadded base64url SHA-256 digest. */
export function parseDeviceInstallId(value: unknown): string | undefined {
  return typeof value === "string" && value.length === 43 && base64urlDecode(value)?.length === 32
    ? value
    : undefined;
}

export type DeviceProofFailure ="malformed" | "key" | "signature" | "claims" | "stale";

export type VerifyDeviceProofInput = {
  proof: string;
  token: string;
  method: string;
  /** Request path; a query or fragment is dropped. */
  path: string;
  environmentId: string;
  /** The stored thumbprint of the key this credential is bound to. */
  expectedJkt: string;
  /** Unix seconds; defaults to now. */
  now?: number;
};

export type VerifyDeviceProofResult =
  | { ok: true; jti: string; iat: number; jwk: DeviceProofJwk; unsaved?: true }
  | { ok: false; reason: DeviceProofFailure };

function parseJson(segment: string): Record<string, unknown> | undefined {
  const bytes = base64urlDecode(segment);
  const text = bytes ? asciiToString(bytes) : undefined;
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Structure, key binding, signature, claims and clock skew, in the order of the spec. */
export function verifyDeviceProof(input: VerifyDeviceProofInput): VerifyDeviceProofResult {
  const fail = (reason: DeviceProofFailure) => ({ ok: false as const, reason });
  if (input.proof.length > DEVICE_PROOF_MAX_BYTES) return fail("malformed");
  const segments = input.proof.split(".");
  if (segments.length !== 3 || !segments.every((segment) => SEGMENT.test(segment)))
    return fail("malformed");
  const header = parseJson(segments[0]);
  const payload = parseJson(segments[1]);
  const signature = base64urlDecode(segments[2]);
  if (!header || !payload || signature?.length !== 64) return fail("malformed");
  const jwk = parseDeviceProofJwk(header.jwk);
  if (header.typ !== "dpop+jwt" || header.alg !== "EdDSA" || !jwk) return fail("malformed");
  if (deviceProofThumbprint(jwk) !== input.expectedJkt) return fail("key");
  let valid = false;
  try {
    valid = ed25519.verify(
      signature,
      utf8ToBytes(`${segments[0]}.${segments[1]}`),
      base64urlDecode(jwk.x)!,
    );
  } catch {
    valid = false;
  }
  if (!valid) return fail("signature");
  const { jti, htm, htu, iat, ath, eid, unsaved } = payload;
  if (
    (unsaved !== undefined && unsaved !== true) ||
    typeof jti !== "string" ||
    jti.length < 16 ||
    jti.length > 64 ||
    !SEGMENT.test(jti) ||
    typeof iat !== "number" ||
    !Number.isSafeInteger(iat)
  )
    return fail("claims");
  if (
    htm !== input.method ||
    htu !== deviceProofPath(input.path) ||
    eid !== input.environmentId ||
    ath !== deviceProofTokenHash(input.token)
  )
    return fail("claims");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > DEVICE_PROOF_SKEW_SECONDS) return fail("stale");
  return { ok: true, jti, iat, jwk, ...(unsaved ? { unsaved: true as const } : {}) };
}
