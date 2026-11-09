import type { Buffer } from "node:buffer";
import type { NativeBufferDeliveryBinding } from "../domains/native-delivery/ports";

export const NATIVE_BUFFER_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
/** Internal distinct-content batch bound; does not change RPC/report limits. */
export const NATIVE_BUFFER_BATCH_MAX_BYTES = 384 * 1024 * 1024;
export const NATIVE_BUFFER_BLOB_CHUNK_BYTES = 65_536;

export type NativeBufferClockState = {
  version: 1;
  reportId: string;
  clockId: string;
  base: number;
  highWater: number;
  digest: string;
};
export interface NativeBufferClockBacking {
  readClock(reportId: string): Promise<NativeBufferClockState | null>;
  initializeClock(
    state: NativeBufferClockState,
    authorize: () => Promise<void>,
  ): Promise<NativeBufferClockState>;
  advanceClock(
    expected: NativeBufferClockState,
    next: NativeBufferClockState,
    authorize: () => Promise<void>,
  ): Promise<NativeBufferClockState>;
}
export type NativeBufferArtifactReference = { key: string; sha256: string; byteLength: number };
export type NativeBufferCertificateReference = {
  reportId: string;
  reportVersion: number;
  snapshotDigest: string;
};
export type NativeBufferCompletionCertificate = NativeBufferCertificateReference & {
  byteLength: number;
  clockId: string;
  raw: Buffer;
  originalDelivery?: NativeBufferDeliveryBinding;
  artifacts: NativeBufferArtifactReference[];
};
export type NativeBufferArtifactWrite = { key: string; bytes: Buffer; immutable: boolean };
export interface NativeBufferPersistence extends NativeBufferClockBacking {
  read(key: string, limit: number): Promise<Buffer | null>;
  /** Discovery cutoff for this HostStore's retained namespace; never reads a body. */
  directoryView(): Promise<number>;
  hasEntry(directory: string, name: string, view?: number): Promise<boolean>;
  /** Private keyset cursor: null or canonical directory-rowid:N; iteration is not lexical. */
  entries(
    directory: string,
    after: string | null,
    limit: number,
    view?: number,
  ): Promise<{
    entries: { name: string; isDirectory: boolean }[];
    nextAfter: string | null;
  }>;
  /** A single critical commit; legacy/hold imports may have no certificate. */
  complete(batch: {
    writes: NativeBufferArtifactWrite[];
    certificates: NativeBufferCompletionCertificate[];
    /** Atomic last legacy import + SQL floor adoption; never replaces a known clock. */
    initializeClocks?: NativeBufferClockState[];
    authorize: () => Promise<void>;
  }): Promise<void>;
  readCertificate(
    ref: NativeBufferCertificateReference,
    limit: number,
  ): Promise<NativeBufferCompletionCertificate | null>;
}
