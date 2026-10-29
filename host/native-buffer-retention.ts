import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import {
  NATIVE_BUFFER_ARTIFACT_MAX_BYTES,
  NATIVE_BUFFER_BATCH_MAX_BYTES,
  type NativeBufferArtifactReference,
  type NativeBufferArtifactWrite,
  type NativeBufferClockState,
  type NativeBufferCompletionCertificate,
  type NativeBufferPersistence,
} from "./ports/native-buffer-persistence";

type Certificate = Omit<NativeBufferCompletionCertificate, "artifacts">;
type Read = { reference: NativeBufferArtifactReference; bytes: Buffer; persisted: boolean };
type Stage = {
  writes: Map<string, NativeBufferArtifactWrite>;
  references: Map<string, NativeBufferArtifactReference>;
  certificates: Map<string, Certificate>;
  content: Map<string, number>;
  bytes: number;
  committed: (() => void)[];
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const held = () =>
  new Error("Native buffer retained-source operation is unavailable and remains held");

/** Private mutation staging, never an actor/grant factory. Reads outside an
 * explicitly captured archive/import do not acquire any write side effect. */
export function createNativeBufferRetention(deps: {
  root: string;
  persistence: NativeBufferPersistence;
}) {
  const stages = new AsyncLocalStorage<Stage>();
  const captures = new AsyncLocalStorage<Map<string, Read>>();
  const sqlReads = new AsyncLocalStorage<boolean>();
  const key = (path: string) => {
    const value = relative(deps.root, path).split(sep).join("/");
    if (
      !isAbsolute(path) ||
      !value ||
      value.startsWith("../") ||
      value.includes("\\") ||
      value.includes("\0") ||
      !(
        value.startsWith("native-activity/buffers/") ||
        value.startsWith("native-activity/buffer-history/")
      ) ||
      value.startsWith("native-activity/buffer-history/clocks/")
    )
      throw held();
    return value;
  };
  const stage = () => {
    const current = stages.getStore();
    if (!current) throw held();
    return current;
  };
  const charge = (current: Stage, hash: string, bytes: number) => {
    const prior = current.content.get(hash);
    if (prior !== undefined) {
      if (prior !== bytes) throw held();
      return;
    }
    if (current.bytes + bytes > NATIVE_BUFFER_BATCH_MAX_BYTES) throw held();
    current.bytes += bytes;
    current.content.set(hash, bytes);
  };
  const retain = (path: string, bytes: Buffer, immutable: boolean) => {
    const current = stage();
    if (bytes.length > NATIVE_BUFFER_ARTIFACT_MAX_BYTES) throw held();
    const name = key(path),
      hash = sha(bytes),
      before = current.writes.get(name);
    if (before && (before.immutable || immutable) && !before.bytes.equals(bytes)) throw held();
    if (!before && current.writes.size >= 65_536) throw held();
    charge(current, hash, bytes.length);
    current.writes.set(name, { key: name, bytes, immutable });
    current.references.set(name, { key: name, sha256: hash, byteLength: bytes.length });
  };
  async function read(
    path: string,
    limit: number,
    legacy: () => Promise<Buffer | null>,
  ): Promise<Buffer | null> {
    const name = key(path),
      current = stages.getStore();
    const staged = current?.writes.get(name)?.bytes;
    let bytes = staged ?? (await deps.persistence.read(name, limit));
    const persisted = !staged && !!bytes;
    if (!bytes && !sqlReads.getStore()) bytes = await legacy();
    if (bytes && bytes.length > limit) throw held();
    if (bytes && captures.getStore()) {
      const captured = captures.getStore()!;
      if (!captured.has(name) && captured.size >= 100_000) throw held();
      captured.set(name, {
        reference: { key: name, sha256: sha(bytes), byteLength: bytes.length },
        bytes,
        persisted,
      });
    }
    return bytes;
  }
  async function flush(
    authorize: () => Promise<void>,
    initializeClocks: NativeBufferClockState[] = [],
  ) {
    const current = stage();
    if (!current.writes.size && !current.certificates.size && !initializeClocks.length) {
      current.references.clear();
      return;
    }
    const artifacts = [...current.references.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    await deps.persistence.complete({
      writes: [...current.writes.values()],
      certificates: [...current.certificates.values()].map((certificate) => ({
        ...certificate,
        artifacts,
      })),
      initializeClocks,
      authorize,
    });
    const callbacks = current.committed.splice(0);
    current.writes.clear();
    current.references.clear();
    current.certificates.clear();
    current.content.clear();
    current.bytes = 0;
    for (const callback of callbacks) callback();
  }
  return {
    key,
    read,
    sqlOnly<T>(action: () => Promise<T>): Promise<T> {
      return sqlReads.run(true, action);
    },
    write(path: string, bytes: string | Buffer, immutable = false) {
      if (typeof bytes === "string" && Buffer.byteLength(bytes) > NATIVE_BUFFER_ARTIFACT_MAX_BYTES)
        throw held();
      retain(path, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), immutable);
      return Promise.resolve();
    },
    async captureReads<T>(action: () => Promise<T>): Promise<T> {
      const captured = new Map<string, Read>();
      const result = await captures.run(captured, action);
      const current = stage();
      for (const { reference, bytes, persisted } of captured.values()) {
        if (!persisted) {
          const immutable = reference.key.startsWith("native-activity/buffer-history/");
          // Paths are already canonical generated keys; retain through the same
          // implementation without regenerating the bytes read from legacy FS.
          const before = current.writes.get(reference.key);
          if (before && (before.immutable || immutable) && !before.bytes.equals(bytes))
            throw held();
          charge(current, reference.sha256, bytes.length);
          current.writes.set(reference.key, { key: reference.key, bytes, immutable });
        }
        current.references.set(reference.key, reference);
      }
      return result;
    },
    certificate(certificate: Certificate) {
      const current = stage();
      if (certificate.raw.length > NATIVE_BUFFER_ARTIFACT_MAX_BYTES) throw held();
      charge(current, certificate.snapshotDigest, certificate.raw.length);
      const identity = `${certificate.reportId}:${certificate.reportVersion}:${certificate.snapshotDigest}`;
      current.certificates.set(identity, certificate);
    },
    afterCommit(callback: () => void) {
      stage().committed.push(callback);
    },
    flush,
    async mutate<T>(authorize: () => Promise<void>, action: () => Promise<T>): Promise<T> {
      if (stages.getStore()) return action();
      return stages.run(
        {
          writes: new Map(),
          references: new Map(),
          certificates: new Map(),
          content: new Map(),
          bytes: 0,
          committed: [],
        },
        async () => {
          const result = await action();
          await flush(authorize);
          return result;
        },
      );
    },
  };
}
