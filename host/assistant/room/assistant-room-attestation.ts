import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../../storage/atomic-write";

export type RoomAttestation = {
  version: 1;
  originEnvironmentId: string;
  originNativeRevision: string;
  targetEnvironmentId: string;
  threadId: string;
  projectId: string;
  grantId: string;
  action: string;
  requestId: string;
  scopeHash: string;
  nonce: string;
  expiresAt: number;
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
function bytes(value: RoomAttestation): Buffer {
  if (
    value.version !== 1 ||
    ![
      value.originEnvironmentId,
      value.targetEnvironmentId,
      value.threadId,
      value.projectId,
      value.grantId,
      value.requestId,
    ].every(validId) ||
    !/^[a-f0-9]{64}$/.test(value.originNativeRevision) ||
    value.originEnvironmentId === value.targetEnvironmentId ||
    !/^[a-z][a-z.]{1,100}$/.test(value.action) ||
    !/^[a-f0-9]{64}$/.test(value.scopeHash) ||
    !/^[a-f0-9]{64}$/.test(value.nonce) ||
    !Number.isSafeInteger(value.expiresAt)
  )
    throw new Error("Invalid Room attestation.");
  return Buffer.from(
    JSON.stringify([
      "bycoda-room-attestation-v1",
      value.originEnvironmentId,
      value.originNativeRevision,
      value.targetEnvironmentId,
      value.threadId,
      value.projectId,
      value.grantId,
      value.action,
      value.requestId,
      value.scopeHash,
      value.nonce,
      value.expiresAt,
    ]),
  );
}
export function verifyRoomAttestation(
  publicKey: string,
  value: RoomAttestation,
  signature: string,
  now = Date.now(),
): boolean {
  try {
    if (
      value.expiresAt <= now ||
      value.expiresAt > now + 30_000 ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(signature)
    )
      return false;
    const key = createPublicKey(publicKey);
    return (
      key.asymmetricKeyType === "ed25519" &&
      verify(null, bytes(value), key, Buffer.from(signature, "base64url"))
    );
  } catch {
    return false;
  }
}
const keyLoads = new Map<string, Promise<string>>();
/** Host holds exclusive ownership of its private state directory before initialization. */
export class RoomAttestationSigner {
  private keyPromise?: Promise<string>;
  constructor(
    private readonly path: string,
    private readonly environmentId: string,
    private readonly thread: (id: string) => Promise<{ id: string } | null>,
    private readonly now: () => number = Date.now,
  ) {}
  private key(): Promise<string> {
    if (this.keyPromise) return this.keyPromise;
    const existing = keyLoads.get(this.path);
    if (existing) return (this.keyPromise = existing);
    const load = (async () => {
      const saved = await readStateFile(
        this.path,
        (text) => {
          const key = createPrivateKey(text);
          if (key.asymmetricKeyType !== "ed25519") throw new Error("Invalid attestation key.");
          return text;
        },
        { quarantine: false },
      );
      if (saved.status === "corrupt")
        throw new Error("Room attestation key is corrupt; owner recovery required.");
      if (saved.status === "ok") return saved.value;
      const pair = generateKeyPairSync("ed25519");
      const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      await writeFileAtomic(this.path, privateKey, { mode: 0o600 });
      return privateKey;
    })();
    keyLoads.set(this.path, load);
    this.keyPromise = load;
    return load;
  }
  async publicKey() {
    return createPublicKey(createPrivateKey(await this.key()))
      .export({ type: "spki", format: "pem" })
      .toString();
  }
  async attest(value: RoomAttestation, nativeAuthorized: () => Promise<boolean>) {
    if (
      value.originEnvironmentId !== this.environmentId ||
      value.expiresAt <= this.now() ||
      value.expiresAt > this.now() + 30_000
    )
      throw new Error("Invalid Room attestation target or deadline.");
    const payload = bytes(value);
    if (!(await nativeAuthorized()) || (await this.thread(value.threadId))?.id !== value.threadId)
      throw new Error("Original Room source unavailable.");
    const key = await this.key();
    if (
      !(await nativeAuthorized()) ||
      (await this.thread(value.threadId))?.id !== value.threadId ||
      !(await nativeAuthorized()) ||
      value.expiresAt <= this.now()
    )
      throw new Error("Original Room source unavailable.");
    return sign(null, payload, createPrivateKey(key)).toString("base64url");
  }
}
export const roomAttestationKeyPath = (hostDirectory: string) =>
  join(hostDirectory, "room-attestation-key.pem");
