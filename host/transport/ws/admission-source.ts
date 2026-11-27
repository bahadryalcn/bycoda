import { createHash } from "node:crypto";

/** Only a bound on memory: an evicted device simply falls back to the shared address bucket. */
const MAX_REMEMBERED_DEVICES = 256;

/**
 * Chooses the bucket that per-source upgrade limits are counted against, before the credential
 * has been checked.
 *
 * Phones that arrive through the Host's own proxies (the LAN WSS gateway, Tailscale Serve) all
 * connect from loopback, so the socket address alone folds every phone into one bucket. Forwarding
 * headers cannot split it: anyone who reaches the proxy can write them. The only value a caller
 * cannot choose is a credential the Host already verified, so a device gets its own bucket only
 * after one of its tokens has authenticated. An unknown or never-verified token stays in the
 * shared address bucket, so unauthenticated traffic is limited exactly as before, and only the
 * holder of a verified token can select that device's bucket. Admission is only a bucket choice;
 * every upgrade is still authenticated, and the global and per-device caps are unchanged.
 */
export class AdmissionSources {
  /** Token fingerprint -> authenticated device id, least recently used first. */
  private readonly devices = new Map<string, string>();

  sourceFor(token: string, remoteSource: string, mobile: boolean): string {
    const fingerprint = fingerprintOf(token);
    const deviceId = this.devices.get(fingerprint);
    if (deviceId === undefined) return `${mobile ? "mobile" : "direct"}:${remoteSource}`;
    this.devices.delete(fingerprint);
    this.devices.set(fingerprint, deviceId);
    return `device:${deviceId}`;
  }

  /** Call only with a token that has just authenticated and authorized. */
  remember(token: string, deviceId: string): void {
    const fingerprint = fingerprintOf(token);
    this.devices.delete(fingerprint);
    this.devices.set(fingerprint, deviceId);
    while (this.devices.size > MAX_REMEMBERED_DEVICES) {
      const oldest = this.devices.keys().next();
      if (oldest.done) break;
      this.devices.delete(oldest.value);
    }
  }
}

/** The raw bearer token is never retained; a digest of a 256-bit token reveals nothing usable. */
function fingerprintOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
