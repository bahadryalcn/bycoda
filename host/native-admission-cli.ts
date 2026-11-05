import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  parseNativeAdmissionRegistry,
  nativeAdmissionFingerprint,
  type NativeAdmissionKey,
} from "./assistant/native/assistant-native-admission";
import { writeFileAtomic } from "./storage/atomic-write";
import { acquireNativeAdmissionLock } from "./native-admission-lock";

export const nativeAdmissionRegistryPath = (directory: string) =>
  join(resolve(directory), "native-admission-registry.json");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Change =
  | { action: "enroll"; hostId: string; installationId: string; publicKeyPath: string }
  | { action: "revoke"; hostId: string; installationId: string };
type Proposal = {
  version: 1;
  path: string;
  action: Change["action"];
  hostId: string;
  installationId: string;
  publicKey: string | null;
  fingerprint: string | null;
  revision: string;
  proposalHash: string;
};

async function current(
  path: string,
  hostId: string,
): Promise<{ entries: NativeAdmissionKey[]; revision: string }> {
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { entries: [], revision: hash("bycoda-native-admission-empty-v1") };
    throw error;
  }
  // A corrupt existing file must never become an empty registry.
  const entries = parseNativeAdmissionRegistry(bytes, hostId);
  return { entries, revision: hash(bytes) };
}

export async function previewNativeAdmission(directory: string, change: Change): Promise<Proposal> {
  const path = nativeAdmissionRegistryPath(directory);
  const { entries, revision } = await current(path, change.hostId);
  if (
    !/^[A-Za-z0-9_-]{1,200}$/.test(change.hostId) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(change.installationId)
  )
    throw new Error("Invalid native admission identity.");
  let publicKey: string | null = null;
  let fingerprint: string | null = null;
  if (change.action === "enroll") {
    if (entries.some((entry) => entry.installationId === change.installationId))
      throw new Error("Installation is already enrolled; revoke it first.");
    const input = await readFile(resolve(change.publicKeyPath), "utf8");
    if (input.length > 4096 || !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(input))
      throw new Error("Supply a PEM public key, not a private key.");
    const key = createPublicKey(input);
    if (key.asymmetricKeyType !== "ed25519")
      throw new Error("Native admission requires an Ed25519 public key.");
    publicKey = key.export({ type: "spki", format: "pem" }).toString();
    fingerprint = nativeAdmissionFingerprint(key);
  } else {
    const entry = entries.find((item) => item.installationId === change.installationId);
    if (!entry) throw new Error("Installation is not enrolled.");
    publicKey = entry.publicKey;
    fingerprint = entry.fingerprint;
  }
  const proposal = {
    version: 1 as const,
    path,
    action: change.action,
    hostId: change.hostId,
    installationId: change.installationId,
    publicKey,
    fingerprint,
    revision,
  };
  return { ...proposal, proposalHash: hash(JSON.stringify(proposal)) };
}

/** Explicit local owner action. Lock serializes concurrent CLI writers; no RPC can invoke it. */
export async function applyNativeAdmission(
  directory: string,
  change: Change,
  reviewedHash: string,
  expectedRevision: string,
): Promise<Proposal> {
  if (!/^[a-f0-9]{64}$/.test(reviewedHash) || !/^[a-f0-9]{64}$/.test(expectedRevision))
    throw new Error("Reviewed proposal hash and registry revision are required.");
  const path = nativeAdmissionRegistryPath(directory);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const release = await acquireNativeAdmissionLock(path);
  try {
    const proposal = await previewNativeAdmission(directory, change);
    if (proposal.revision !== expectedRevision || proposal.proposalHash !== reviewedHash)
      throw new Error("Registry or reviewed proposal changed; preview again.");
    const { entries, revision } = await current(path, change.hostId);
    if (revision !== expectedRevision) throw new Error("Registry changed; preview again.");
    const updated =
      change.action === "enroll"
        ? [
            ...entries,
            {
              installationId: change.installationId,
              hostId: change.hostId,
              publicKey: proposal.publicKey!,
              fingerprint: proposal.fingerprint!,
            },
          ]
        : entries.filter((entry) => entry.installationId !== change.installationId);
    await writeFileAtomic(
      path,
      `${JSON.stringify({ version: 1, generation: randomBytes(32).toString("hex"), entries: updated }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return proposal;
  } finally {
    await release();
  }
}
