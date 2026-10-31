import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  loadPhysicalStoreAdmission,
  type BoundStore,
  type PhysicalStoreAdmission,
  type WriterHandle,
} from "../packages/physical-store-admission-node/index.mjs";

const ENTRY_POINT = "sqlite3_bycodaphysical_init";
const MAX_DATABASES = 128;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
/** Filesystem hiccups that say nothing about artifact/ABI integrity: report busy, never latch. */
const TRANSIENT_FS = new Set([
  "EBUSY",
  "EAGAIN",
  "EMFILE",
  "ENFILE",
  "EPERM",
  "EACCES",
  "EIO",
  "EINTR",
  "ENOLCK",
  "ENOMEM",
  "ETIMEDOUT",
  // A database file that vanished between listing and opening is state, not corruption.
  "ENOENT",
]);
function checkArtifactPath(path: string): void {
  if (
    extname(path) !== ".node" ||
    (process.platform === "win32" && Buffer.byteLength(toNamespacedPath(path), "utf8") > 260)
  )
    throw fault();
}
const inside = (file: string, directory: string) => {
  const name = relative(directory, file);
  return name === "" || (!isAbsolute(name) && name !== ".." && !name.startsWith(`..${sep}`));
};
export type HostNotesAdmissionStatus =
  | Readonly<{
      mode: "unjoined";
      reason: "host-notes-admission-unjoined";
      detail: "missing" | "unsupported";
    }>
  | Readonly<{ mode: "joined"; reason: null }>
  | Readonly<{ mode: "fault"; reason: "host-notes-admission-fault" }>;
export interface HostNotesAdmissionOptions {
  /** Private trusted constructor input, never an RPC argument. */
  admissionArtifact?: string;
}
export class HostNotesAdmissionError extends Error {
  constructor(
    readonly code: "HOST_NOTES_ADMISSION_BUSY" | "HOST_NOTES_ADMISSION_FAULT",
    message: string,
  ) {
    super(message);
    this.name = "HostNotesAdmissionError";
  }
}
export function isHostNotesAdmissionFault(error: unknown): boolean {
  return error instanceof HostNotesAdmissionError && error.code === "HOST_NOTES_ADMISSION_FAULT";
}
const fault = () =>
  new HostNotesAdmissionError(
    "HOST_NOTES_ADMISSION_FAULT",
    "Notes physical admission is unavailable. Refresh before continuing.",
  );
const busy = () =>
  new HostNotesAdmissionError(
    "HOST_NOTES_ADMISSION_BUSY",
    "Notes physical admission is closed or busy. Try again after it reopens.",
  );
function artifactHash(path: string): string {
  const size = statSync(path).size;
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_ARTIFACT_BYTES ||
    !statSync(path).isFile()
  )
    throw fault();
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
type Artifact = Readonly<{ path: string; sha256: string }>;
function selectArtifact(options: HostNotesAdmissionOptions, bundle: string): Artifact | undefined {
  if (options.admissionArtifact !== undefined) {
    if (typeof options.admissionArtifact !== "string" || !isAbsolute(options.admissionArtifact))
      throw fault();
    const path = realpathSync(options.admissionArtifact);
    checkArtifactPath(path);
    return Object.freeze({ path, sha256: artifactHash(path) });
  }
  const manifestPath = join(bundle, "physical-store-admission.json");
  try {
    const entry = lstatSync(manifestPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 4096) throw fault();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw fault();
  const value = manifest as Record<string, unknown>;
  if (
    value.schemaVersion !== 2 ||
    value.mechanicalAbiVersion !== 2 ||
    value.target !== `${process.platform}-${process.arch}` ||
    typeof value.sha256 !== "string" ||
    !hashPattern.test(value.sha256) ||
    value.artifact !== `admission-${value.sha256}.node`
  )
    throw fault();
  const root = realpathSync(bundle);
  const path = realpathSync(resolve(root, value.artifact as string));
  checkArtifactPath(path);
  if (!inside(path, root) || artifactHash(path) !== value.sha256) throw fault();
  return Object.freeze({ path, sha256: value.sha256 });
}

export interface HostNotesWorkerComparison {
  readonly version: 1;
  readonly artifact: string;
  readonly sha256: string;
  readonly entryPoint: typeof ENTRY_POINT;
  readonly bindings: readonly Readonly<{ path: string; physicalFileId: string; links: 1 }>[];
}
type HeldWriter = { store: BoundStore; writer: WriterHandle };
export interface HostNotesAcceptedJob {
  readonly paths: string[];
  readonly comparison: HostNotesWorkerComparison;
  finishActual(): void;
}

/** Class-local actual ownership; no enrollment/permission/complete-writer claim. */
export class HostNotesAdmission {
  private state: HostNotesAdmissionStatus = Object.freeze({
    mode: "unjoined",
    reason: "host-notes-admission-unjoined",
    detail: "missing",
  });
  private native?: PhysicalStoreAdmission;
  private artifact?: Artifact;
  // A failed release is never retried or evicted; retain its exact opaque owners.
  private readonly unreleased = new Set<HeldWriter>();
  constructor(
    options: HostNotesAdmissionOptions = {},
    bundle = dirname(fileURLToPath(import.meta.url)),
  ) {
    try {
      const artifact = selectArtifact(options, bundle);
      if (!artifact) return;
      const native = loadPhysicalStoreAdmission(artifact.path);
      if (
        Number(native.mechanicalAbiVersion()) !== 2 ||
        native.sqliteExtensionEntryPoint() !== ENTRY_POINT
      )
        throw fault();
      if (!native.connectionAttestationSupported()) {
        this.state = Object.freeze({
          mode: "unjoined",
          reason: "host-notes-admission-unjoined",
          detail: "unsupported",
        });
        return;
      }
      this.native = native;
      this.artifact = artifact;
      this.state = Object.freeze({ mode: "joined", reason: null });
    } catch {
      this.markFault();
    }
  }
  get status(): HostNotesAdmissionStatus {
    return this.state;
  }
  get workerConfiguration() {
    this.assertHealthy();
    return this.state.mode === "joined"
      ? Object.freeze({
          mode: "joined" as const,
          artifact: this.artifact!.path,
          sha256: this.artifact!.sha256,
          entryPoint: ENTRY_POINT,
        })
      : Object.freeze({ mode: "unjoined" as const });
  }
  markFault(): void {
    this.state = Object.freeze({ mode: "fault", reason: "host-notes-admission-fault" });
  }
  assertHealthy(): void {
    if (this.state.mode === "fault") throw fault();
  }
  /** Synchronous try-all before tail publication. No await, partial effects or fallback. */
  accept(paths: readonly string[], write: boolean): HostNotesAcceptedJob | undefined {
    this.assertHealthy();
    if (this.state.mode !== "joined") return undefined;
    if (write && !paths.length)
      throw new Error("Notes require an existing bycoda desktop database on this computer.");
    const native = this.native!,
      artifact = this.artifact!;
    const held: HeldWriter[] = [];
    try {
      if (paths.length > MAX_DATABASES) throw fault();
      // Resolve all configured candidates first. Missing files are not created or silently omitted.
      const canonical = [...new Set(paths.map((path) => realpathSync(path)))];
      const stores = new Map<string, { path: string; store: BoundStore; physicalFileId: string }>();
      for (const path of canonical) {
        const store = native.openRegistry(native.registryRootForDatabase(path)).bindFile(path);
        const data = store.identity();
        if (
          data.links !== 1n ||
          typeof data.nativeFormat !== "string" ||
          !data.nativeFormat ||
          data.nativeFormat.length > 128
        )
          throw fault();
        if (!stores.has(data.nativeFormat))
          stores.set(data.nativeFormat, { path, store, physicalFileId: data.nativeFormat });
      }
      const ordered = [...stores.values()];
      if (write)
        for (const item of [...ordered].sort((a, b) =>
          a.physicalFileId < b.physicalFileId ? -1 : a.physicalFileId > b.physicalFileId ? 1 : 0,
        )) {
          const writer = item.store.tryWriter();
          if (!writer) throw busy();
          held.push({ store: item.store, writer });
        }
      const comparison: HostNotesWorkerComparison = Object.freeze({
        version: 1,
        artifact: artifact.path,
        sha256: artifact.sha256,
        entryPoint: ENTRY_POINT,
        bindings: Object.freeze(
          ordered.map((item) =>
            Object.freeze({
              path: item.path,
              physicalFileId: item.physicalFileId,
              links: 1 as const,
            }),
          ),
        ),
      });
      let pins: typeof ordered | undefined = ordered;
      return {
        paths: ordered.map((item) => item.path),
        comparison,
        finishActual: () => {
          if (!pins) return;
          pins = undefined;
          this.release(held);
        },
      };
    } catch (error) {
      this.release(held);
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const transient = typeof code === "string" && TRANSIENT_FS.has(code);
      if (transient) {
        console.warn("Notes admission hit a transient filesystem error:", code);
        throw busy();
      }
      if (!(error instanceof HostNotesAdmissionError && error.code === "HOST_NOTES_ADMISSION_BUSY"))
        this.markFault();
      this.assertHealthy();
      throw error;
    }
  }
  private release(held: HeldWriter[]): void {
    for (const entry of [...held].reverse()) {
      try {
        entry.store.releaseWriter(entry.writer);
      } catch {
        this.unreleased.add(entry);
        this.markFault();
      }
    }
  }
}

export type HostNotesDatabaseFactory = (
  path: string,
  options: { readOnly: boolean },
) => DatabaseSync;
/** Private worker factory. Comparison metadata never substitutes for actual VFS identity. */
export function createHostNotesDatabaseFactory(comparison?: HostNotesWorkerComparison) {
  const connections = new Set<DatabaseSync>();
  let closeFault = false;
  if (
    comparison !== undefined &&
    (!comparison || typeof comparison !== "object" || Array.isArray(comparison))
  )
    throw fault();
  try {
    if (
      comparison &&
      (comparison.version !== 1 ||
        comparison.entryPoint !== ENTRY_POINT ||
        !isAbsolute(comparison.artifact) ||
        extname(comparison.artifact) !== ".node" ||
        !hashPattern.test(comparison.sha256) ||
        artifactHash(comparison.artifact) !== comparison.sha256 ||
        !Array.isArray(comparison.bindings) ||
        comparison.bindings.length > MAX_DATABASES ||
        comparison.bindings.some(
          (item) =>
            !item ||
            typeof item.path !== "string" ||
            !isAbsolute(item.path) ||
            item.links !== 1 ||
            typeof item.physicalFileId !== "string" ||
            !item.physicalFileId ||
            item.physicalFileId.length > 128,
        ))
    )
      throw fault();
  } catch {
    throw fault();
  }
  const open: HostNotesDatabaseFactory = (path, options) => {
    let expected: HostNotesWorkerComparison["bindings"][number] | undefined;
    try {
      if (comparison) {
        const canonical = realpathSync(path);
        expected = comparison.bindings.find((item) => item.path === canonical);
        if (!expected || expected.links !== 1 || typeof expected.physicalFileId !== "string")
          throw fault();
      }
      const db = new DatabaseSync(path, { ...options, allowExtension: !!comparison });
      connections.add(db);
      const close = db.close.bind(db);
      db.close = () => {
        try {
          close();
          connections.delete(db);
        } catch {
          closeFault = true; /* preserve actual SQL outcome; hold job until real Worker EXIT */
        }
      };
      try {
        if (comparison) {
          try {
            db.loadExtension(comparison.artifact, comparison.entryPoint);
          } finally {
            db.enableLoadExtension(false);
          }
          const row = db.prepare("SELECT bycoda_connection_identity() AS identity").get();
          if (typeof row?.identity !== "string" || row.identity.length > 1024) throw fault();
          const actual: unknown = JSON.parse(row.identity);
          if (!actual || typeof actual !== "object" || Array.isArray(actual)) throw fault();
          const data = actual as Record<string, unknown>;
          if (
            Object.keys(data).sort().join(",") !== "links,physicalFileId,version" ||
            data.version !== 1 ||
            data.links !== 1 ||
            data.physicalFileId !== expected!.physicalFileId
          )
            throw fault();
        }
        return db;
      } catch (error) {
        try {
          db.close();
        } catch {
          /* exact open connection remains owned until actual worker EXIT */
        }
        throw error;
      }
    } catch (error) {
      if (comparison) throw fault();
      throw error;
    }
  };
  return { open, connectionsClosed: () => connections.size === 0, closeFault: () => closeFault };
}
