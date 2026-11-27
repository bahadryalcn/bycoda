import type { IncomingMessage } from "node:http";
import {
  DEVICE_PROOF_HEADER,
  DEVICE_PROOF_MAX_BYTES,
  DEVICE_PROOF_REPLAY_SECONDS,
  verifyDeviceProof,
} from "../../src/integrations/device-proof";
import { requestIngress, type HostIngress } from "./ingress";

/** The key a device credential is bound to (`devices.proof_jkt` / `proof_x`). */
export type DeviceProofBinding = { jkt: string; x: string };

export type DeviceProofRefusal = "proof-required" | "invalid-proof" | "replayed-proof";

/**
 * What a pairing client offered to tie its new credential to an earlier one of the same client:
 * the thumbprint of the earlier key (only when it proved possession in this redemption) and the
 * install ID it reported (an identifier, not a proof). `HostStore.issueDevice` applies both.
 */
export type DeviceReplacement = { jkt?: string; installId?: string };

export type DeviceProofResult =
  /** `unsaved`: the client signed this before it saved the credential; see `DeviceProofClaims`. */
  { ok: true; unsaved?: true } | { ok: false; reason: DeviceProofRefusal };

const MAX_ENTRIES = 100_000;

/**
 * Proof identifiers seen within the replay window. Entries expire in insertion order (the window
 * is constant), so pruning only looks at the front. A full cache refuses new proofs: an
 * unexpired entry is never evicted, because that would reopen the replay it guards against.
 */
export class DeviceProofReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly capacity = MAX_ENTRIES,
    private readonly windowMs = DEVICE_PROOF_REPLAY_SECONDS * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the identifier is new and now recorded. */
  claim(jti: string): boolean {
    const now = this.now();
    for (const [id, expiry] of this.seen) {
      if (expiry > now) break;
      this.seen.delete(id);
    }
    if (this.seen.has(jti) || this.seen.size >= this.capacity) return false;
    this.seen.set(jti, now + this.windowMs);
    return true;
  }
}

const hostReplayCache = new DeviceProofReplayCache();

/** The one `DPoP` header value, or undefined when it is missing or sent more than once. */
function singleProofHeader(request: IncomingMessage): string | undefined {
  let found: string | undefined;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() !== DEVICE_PROOF_HEADER.toLowerCase()) continue;
    if (found !== undefined) return undefined;
    found = request.rawHeaders[index + 1];
  }
  return found !== undefined && Buffer.byteLength(found) <= DEVICE_PROOF_MAX_BYTES
    ? found
    : undefined;
}

/**
 * Verifies the request's `DPoP` proof against the key a device credential is bound to: structure,
 * key, signature, claims, clock skew, then replay. The only place a proof is accepted.
 */
export function requireDeviceProof(options: {
  request: IncomingMessage;
  token: string;
  environmentId: string;
  binding: DeviceProofBinding;
  cache?: DeviceProofReplayCache;
  /** Unix seconds; tests only. */
  now?: number;
}): DeviceProofResult {
  const proof = singleProofHeader(options.request);
  if (proof === undefined) return { ok: false, reason: "proof-required" };
  const verified = verifyDeviceProof({
    proof,
    token: options.token,
    method: options.request.method ?? "",
    path: options.request.url ?? "",
    environmentId: options.environmentId,
    expectedJkt: options.binding.jkt,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (!verified.ok) return { ok: false, reason: "invalid-proof" };
  return (options.cache ?? hostReplayCache).claim(verified.jti)
    ? { ok: true, ...(verified.unsaved ? { unsaved: true as const } : {}) }
    : { ok: false, reason: "replayed-proof" };
}

/**
 * Policy for a device credential on one ingress. A bound device needs a valid proof everywhere
 * and never falls back to the bearer token; an unbound (pre-proof) device is accepted on the
 * Host's own and phone-listener ingress and refused on the public tunnel.
 */
export function checkDeviceProof(options: {
  request: IncomingMessage;
  token: string;
  environmentId: string;
  ingress: HostIngress;
  binding: DeviceProofBinding | undefined;
  cache?: DeviceProofReplayCache;
}): DeviceProofResult {
  if (options.binding) return requireDeviceProof({ ...options, binding: options.binding });
  return options.ingress === "tunnel" ? { ok: false, reason: "proof-required" } : { ok: true };
}

export const DEVICE_PROOF_REFUSAL_HEADERS = {
  "X-Bycoda-Auth-Stage": "proof",
  "WWW-Authenticate": 'DPoP error="invalid_dpop_proof"',
} as const;

export function deviceProofRefusalBody(reason: DeviceProofRefusal): string {
  return JSON.stringify({ error: "Device proof is missing or invalid", reason });
}

export type DeviceProofAuthority = {
  binding?: DeviceProofBinding;
  /** This credential replaces an earlier one of the same client once it is in use. */
  replacementPending?: true;
};

/**
 * A verified proof of a credential issued by re-pairing shows its client holds it; only the first
 * one signed after the client saved the credential retires the earlier one. The check a client
 * runs before saving is marked `unsaved` and retires nothing, so a client whose save then fails
 * still holds a working credential. A failure never fails the request: the mark stays, so the
 * next request tries again.
 */
export async function completeProvenReplacement(
  authority: DeviceProofAuthority,
  proof: DeviceProofResult,
  complete: () => Promise<unknown>,
): Promise<void> {
  if (proof.ok && !proof.unsaved && authority.binding && authority.replacementPending)
    await complete().catch(() => undefined);
}

/**
 * Decides one request for any transport. Resolves the caller's credential and ingress itself, so
 * HTTP bulk, WebSocket upgrades, the dev-server tunnel and browser media all enforce the same
 * policy. A token that is not a paired device (other principals) is not this policy's business.
 */
export type DeviceProofGate = (
  request: IncomingMessage,
  token: string,
) => Promise<DeviceProofResult>;

export function createDeviceProofGate(options: {
  environmentId: string;
  mobileIngressSecret: () => string | undefined;
  authority: (token: string) => Promise<DeviceProofAuthority | undefined>;
  cache?: DeviceProofReplayCache;
  completeReplacement?: (token: string) => Promise<unknown>;
}): DeviceProofGate {
  return async (request, token) => {
    const ingress = requestIngress(request, options.mobileIngressSecret());
    if (ingress === "invalid") return { ok: false, reason: "invalid-proof" };
    const authority = await options.authority(token);
    if (!authority) return { ok: true };
    const proof = checkDeviceProof({
      request,
      token,
      environmentId: options.environmentId,
      ingress,
      binding: authority.binding,
      cache: options.cache,
    });
    const complete = options.completeReplacement;
    if (complete) await completeProvenReplacement(authority, proof, () => complete(token));
    return proof;
  };
}
