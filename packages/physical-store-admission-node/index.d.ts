declare const writerBrand: unique symbol;
declare const closingBrand: unique symbol;
declare const closedBrand: unique symbol;
export interface WriterHandle {
  readonly [writerBrand]: true;
}
export interface ClosingHandle {
  readonly [closingBrand]: true;
}
export interface ClosedHandle {
  readonly [closedBrand]: true;
}
/** OS-derived file metadata only. Never SQLite attestation or permission. */
export interface FileIdentityData {
  nativeFormat: string;
  links: bigint;
}
/** JSON returned ONLY by the actual trusted SQLite function; not a reconstructible grant. */
export interface SqliteConnectionIdentityData {
  version: 1;
  physicalFileId: string;
  links: number;
}
export interface ReservationStatistics {
  processActive: number;
  ownerActive: number;
  maxProcess: number;
  maxOwner: number;
}
export interface BoundStore {
  identity(): FileIdentityData;
  tryWriter(): WriterHandle | null;
  tryBeginClose(): ClosingHandle | null;
  /** Busy returns null. Every error retains the SAME original Closing handle. */
  tryUpgrade(closing: ClosingHandle): ClosedHandle | null;
  /** Private adapter must call only after actual terminal/EXIT, never public timeout/GC. */
  releaseWriter(writer: WriterHandle): void;
  releaseClosing(closing: ClosingHandle): void;
  releaseClosed(closed: ClosedHandle): void;
}
export interface PhysicalRegistry {
  bindFile(existingPath: string): BoundStore;
  statistics(): ReservationStatistics;
}
export interface PhysicalStoreAdmission {
  mechanicalAbiVersion(): 2;
  windowsListeners?(): { pid: number; address: string; port: number }[];
  windowsProcessBirths?(
    pids: number[],
  ): { pid: number; state: "alive" | "missing" | "unknown"; startedAt?: string | null }[];
  /** Optional additive capability; absent on older artifacts. */
  renameNoReplace?(from: string, to: string): void;
  guardedMove?(
    from: string,
    to: string,
  ): Promise<{ path: string; recoveryPath: string; receiptPath: string; warning?: string | null }>;
  openRegistry(protectedRoot: string): PhysicalRegistry;
  /** Shared Core location derivation only; caller establishes canonical provenance. */
  registryRootForDatabase(canonicalAbsDbPath: string): string;
  sqliteExtensionEntryPoint(): "sqlite3_bycodaphysical_init";
  /** Current implementation supports actual connection attestation on Windows only. */
  connectionAttestationSupported(): boolean;
}
export function loadPhysicalStoreAdmission(
  explicitAbsoluteNodeArtifact: string,
): PhysicalStoreAdmission;
