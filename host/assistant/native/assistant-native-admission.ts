import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { acquireNativeAdmissionLock } from "../../native-admission-lock";

/** Owner-provisioned trust. Never populate this from paired-device RPCs. */
export type NativeAdmissionKey = { installationId: string; hostId: string; publicKey: string; fingerprint: string };
export type NativeAdmissionRequest = { installationId: string; hostId: string; action: string; requestDigest: string };
export type NativeAdmissionChallenge = NativeAdmissionRequest & { nonce: string; expiresAt: number };
export type NativeAdmissionProof = { challenge: NativeAdmissionChallenge; signature: string };

const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const nativeAdmissionFingerprint = (key: KeyObject) => createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
/** Caller supplies deterministic bytes of the exact operation, not renderer claims. */
export const nativeAdmissionDigest = (bytes: string) => createHash("sha256").update(bytes, "utf8").digest("hex");
export function nativeAdmissionBytes(challenge: NativeAdmissionChallenge): Buffer {
  return Buffer.from(JSON.stringify(["bycoda-native-admission-v1", challenge.installationId, challenge.hostId, challenge.action, challenge.requestDigest, challenge.nonce, challenge.expiresAt]), "utf8");
}

/** Missing configuration means no trusted installations; invalid configuration fails closed. */
export async function loadNativeAdmissionRegistry(path: string | undefined, hostId: string): Promise<NativeAdmissionKey[]> {
  if (!id(hostId)) throw new Error("Invalid native admission Host identity.");
  if (!path) return [];
  return parseNativeAdmissionRegistry(await readFile(path, "utf8"), hostId);
}
export function parseNativeAdmissionRegistry(contents: string, hostId: string): NativeAdmissionKey[] {
  if (!id(hostId) || Buffer.byteLength(contents, "utf8") > 262144) throw new Error("Invalid native admission registry.");
  const document: unknown = JSON.parse(contents);
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid native admission registry.");
  const value = document as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "entries,generation,version" || value.version !== 1 || typeof value.generation !== "string" || !/^[a-f0-9]{64}$/.test(value.generation)) throw new Error("Invalid native admission registry.");
  const parsed = value.entries;
  if (!Array.isArray(parsed) || parsed.length > 64) throw new Error("Invalid native admission registry.");
  const seen = new Set<string>();
  return parsed.map((item): NativeAdmissionKey => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid native admission registry entry.");
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).sort().join(",") !== "fingerprint,hostId,installationId,publicKey" || !id(entry.installationId) || entry.hostId !== hostId || typeof entry.publicKey !== "string" || !digest(entry.fingerprint) || seen.has(entry.installationId)) throw new Error("Invalid native admission registry entry.");
    const key = createPublicKey(entry.publicKey);
    if (key.asymmetricKeyType !== "ed25519" || nativeAdmissionFingerprint(key) !== entry.fingerprint) throw new Error("Native admission key fingerprint mismatch.");
    seen.add(entry.installationId);
    return { installationId: entry.installationId, hostId, publicKey: entry.publicKey, fingerprint: entry.fingerprint };
  });
}

/** Volatile, exact-operation challenges. Restart invalidates all pending proofs. */
export class NativeAdmission {
  private readonly keys = new Map<string, KeyObject>();
  private readonly pending = new Map<string, NativeAdmissionChallenge>();
  constructor(private readonly hostId: string, entries: readonly NativeAdmissionKey[], private readonly now: () => number = Date.now) {
    if (!id(hostId)) throw new Error("Invalid native admission Host identity.");
    for (const entry of entries) {
      const key = createPublicKey(entry.publicKey);
      if (!id(entry.installationId) || entry.hostId !== hostId || key.asymmetricKeyType !== "ed25519" || nativeAdmissionFingerprint(key) !== entry.fingerprint || this.keys.has(entry.installationId)) throw new Error("Invalid native admission registry entry.");
      this.keys.set(entry.installationId, key);
    }
  }
  hasInstallation(installationId: string): boolean { return this.keys.has(installationId); }
  challenge(request: NativeAdmissionRequest): NativeAdmissionChallenge {
    if (request.hostId !== this.hostId || !this.keys.has(request.installationId) || !/^[a-z][a-z.]{1,100}$/.test(request.action) || !digest(request.requestDigest)) throw new Error("Native admission unavailable.");
    const now = this.now();
    for (const [nonce, pending] of this.pending) if (pending.expiresAt <= now) this.pending.delete(nonce);
    if (this.pending.size >= 256) throw new Error("Native admission challenge capacity exhausted.");
    const challenge = Object.freeze({ installationId: request.installationId, hostId: this.hostId, action: request.action, requestDigest: request.requestDigest, nonce: randomBytes(32).toString("hex"), expiresAt: now + 30_000 });
    this.pending.set(challenge.nonce, challenge);
    return challenge;
  }
  consume(request: NativeAdmissionRequest, proof: NativeAdmissionProof): void {
    const supplied = proof?.challenge;
    const pending = supplied && this.pending.get(supplied.nonce);
    const key = this.keys.get(request.installationId);
    if (!pending || !key || pending.expiresAt <= this.now() || request.hostId !== this.hostId || pending.installationId !== request.installationId || pending.hostId !== request.hostId || pending.action !== request.action || pending.requestDigest !== request.requestDigest || nativeAdmissionBytes(pending).compare(nativeAdmissionBytes(supplied)) !== 0 || typeof proof.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(proof.signature) || !verify(null, nativeAdmissionBytes(pending), key, Buffer.from(proof.signature, "base64url"))) throw new Error("Invalid native admission proof.");
    this.pending.delete(pending.nonce);
  }
}

/** Reloads owner-managed registry before each admission and delayed effect check. */
export class NativeAdmissionOwner {
  private admission?: NativeAdmission;
  private revision?: string;
  private refreshTail: Promise<void> = Promise.resolve();
  constructor(private readonly path: string | undefined, private readonly hostId: string, private readonly allowMissing = false, private readonly now: () => number = Date.now) {}
  private async refresh(): Promise<{ admission: NativeAdmission; revision: string }> {
    const refresh = this.refreshTail.then(() => this.readRegistry());
    this.refreshTail = refresh.then(() => undefined, () => undefined);
    return refresh;
  }
  private async readRegistry(): Promise<{ admission: NativeAdmission; revision: string }> {
    let contents: string | undefined;
    if (this.path) {
      try { contents = await readFile(this.path, "utf8"); }
      catch (error) { if (!(this.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error; }
    }
    const revision = createHash("sha256").update(contents === undefined ? "bycoda-native-admission-empty-v1" : contents).digest("hex");
    if (!this.admission || revision !== this.revision) {
      const entries = contents === undefined ? [] : parseNativeAdmissionRegistry(contents, this.hostId);
      this.admission = new NativeAdmission(this.hostId, entries, this.now);
      this.revision = revision;
    }
    return { admission: this.admission, revision };
  }
  async challenge(request: NativeAdmissionRequest): Promise<NativeAdmissionChallenge> {
    const { admission } = await this.refresh();
    if (admission !== this.admission) throw new Error("Native admission registry changed.");
    return admission.challenge(request);
  }
  async consume(request: NativeAdmissionRequest, proof: NativeAdmissionProof): Promise<string> {
    const { admission, revision } = await this.refresh();
    if (admission !== this.admission) throw new Error("Native admission registry changed.");
    admission.consume(request, proof);
    return revision;
  }
  async current(installationId: string, capturedRevision: string): Promise<boolean> {
    try {
      const { admission, revision } = await this.refresh();
      // Any registry change retires the original admission, including unrelated keys.
      return admission.hasInstallation(installationId) && revision === capturedRevision;
    } catch { return false; }
  }
  /** Holds the same lock as the CLI until the physical owner actually settles. */
  async withEffect<T>(installationId: string, capturedRevision: string, body: (lease: { valid(): boolean }) => Promise<T>): Promise<T> {
    if (!this.path) throw new Error("Native admission registry unavailable.");
    const release = await acquireNativeAdmissionLock(this.path);
    let active = true;
    try {
      if (!(await this.current(installationId, capturedRevision))) throw new Error("Native admission authority revoked.");
      return await body({ valid: () => active });
    } finally {
      active = false;
      await release();
    }
  }
}
