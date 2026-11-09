import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  canonicalWorkspaceDirectory,
  canonicalWorkspaceEntry,
  workspacePathKey,
} from "../workspaces/workspace-paths";
import { durableWrite } from "../git/turn-git-history";
import { createNativeBufferClock } from "./native-buffer-clock";
import { createNativeBufferRetention } from "./native-buffer-retention";
import {
  createNativeBufferRetentionImporter,
  type NativeBufferRetentionImporter,
} from "./native-buffer-retention-import";
import { createNativeBufferDirectories } from "./native-buffer-directories";
import type {
  NativeBufferClockState,
  NativeBufferPersistence,
} from "../ports/native-buffer-persistence";
import {
  createNativeBufferTemplates,
  prepareNativeBufferTemplate,
  NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES,
  type NativeBufferTemplateReceipt,
} from "./native-buffer-archive";
import {
  createNativeBufferCatalog,
  type NativeBufferRecoveryCursor,
} from "./native-buffer-catalog";
export type { NativeBufferRecoveryCursor } from "./native-buffer-catalog";
import type { ManagedWorkspace, WorkspaceActivity } from "../workspaces/workspace-contracts";
import type { WorkspaceOwnerAuthorization } from "../workspaces/workspace-service-contracts";
import {
  EMPTY_PREFIX,
  HOLD_PREFIX,
  hex,
  identity,
  integer,
  ownerSnapshot,
  provenance,
  record,
  uuid,
  type NativeBufferOwnerSnapshot,
  type NativeBufferSourceMetadata,
} from "./native-buffer-owner";
export type { NativeBufferOwnerSnapshot, NativeBufferSourceMetadata } from "./native-buffer-owner";
import { createNativeBufferHeartbeat } from "./native-buffer-heartbeat";
import { assertProcessDead, createReconcileOutcome } from "./native-buffer-reconcile";
import { NativeDeliveryIdentitySchema } from "../../src/shared/model/host-contracts/native-delivery-identity";
import type {
  NativeBufferDeliveryBinding,
  NativeBufferDeliveryOptions,
  NativeBufferDeliveryProof,
} from "../domains/native-delivery/ports";

export interface NativeBufferSnapshot {
  clientId: string;
  instanceId: string;
  processId: number;
  owners: NativeBufferOwnerSnapshot[];
}
type RecoveryMetadata = {
  version: 1;
  kind: "projection" | "hold";
  reportVersion: number;
  ownerVersions: Record<string, number>;
  ownerLineages: Record<string, "physical" | "legacy">;
  heldOwnerIds: string[];
  parentReportId?: string;
  sourceOwnerId?: string;
  holdDigest?: string;
  clockId?: string;
};
interface BufferLease extends NativeBufferSnapshot {
  device: string;
  receivedAt: number;
  retiredAt?: number;
  recovery?: RecoveryMetadata;
  originalDelivery?: NativeBufferDeliveryBinding;
}
type Captured = {
  reportId: string;
  raw: Buffer;
  value: BufferLease;
  snapshotDigest: string;
  archiveReadBytes?: number;
};
type ManifestBase = {
  reportId: string;
  reportVersion: number;
  snapshotDigest: string;
  byteLength: number;
  clockId?: string;
  device?: string;
  catalog?: NativeBufferRecoveryMetadata[];
  catalogDigest?: string;
};
type Manifest = ManifestBase &
  (
    | { version: 1; chunks: { digest: string; byteLength: number }[] }
    | { version: 2; body: NativeBufferTemplateReceipt; catalogBody?: NativeBufferTemplateReceipt }
  );
export interface NativeBufferRecoverySource {
  reportId: string;
  reportVersion: number;
  ownerId: string;
  ownerVersion: number;
  snapshotDigest: string;
}
export interface NativeBufferRecoveryMetadata {
  source: NativeBufferRecoverySource;
  clientId: string;
  instanceId: string;
  processId: number;
  updatedAt: number;
  byteLength: number;
  bufferCount: number;
  dirtyCount: number;
  unknown: boolean;
  provenance: NativeBufferSourceMetadata | null;
  lineage: "physical" | "legacy";
  ownerMissing: boolean;
  compatibilityHoldId: string;
  verification: "raw-checked" | "metadata-only";
  retention: "current" | "held" | "historical";
  inspectable: boolean;
  qualified: false;
  resolution: "unsupported";
}
type Dependencies = {
  root: string;
  listWorkspaces(): Promise<ManagedWorkspace[]>;
  /** Reuse the process owner's serial gate; do not introduce a competing owner. */
  serial<T>(action: () => Promise<T>): Promise<T>;
  authenticate(owner: WorkspaceOwnerAuthorization): Promise<string>;
  now?(): number;
  /** Actual critical Host storage; absent only for legacy/unqualified fixtures. */
  persistence?: NativeBufferPersistence;
  /** Legacy filesystem failure injection; SQL-backed writes are staged instead. */
  write?: typeof durableWrite;
};
type CapturedAuthorization = {
  capability: WorkspaceOwnerAuthorization;
  ownerId: string;
  authorizationId: string;
};

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_DISCLOSURE_BYTES = 1024 * 1024;
const CHUNK_BYTES = 4096;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_READ_BYTES =
  MAX_REPORT_BYTES +
  MAX_MANIFEST_BYTES +
  MAX_CATALOG_BYTES +
  2 * NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));
const reportKey = (value: Pick<BufferLease, "device" | "clientId" | "instanceId">) =>
  digest([value.device, value.clientId, value.instanceId]);
const contains = (root: string, target: string) =>
  workspacePathKey(root) === workspacePathKey(target) ||
  workspacePathKey(target).startsWith(`${workspacePathKey(root)}${sep}`);
function parseStored(raw: Buffer, expectedReportId: string): Captured {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error("Native buffer report is corrupt and remains held");
  }
  if (!record(value)) throw new Error("Native buffer report is corrupt and remains held");
  identity(value.clientId, "client identity");
  identity(value.instanceId, "instance identity");
  if (
    typeof value.device !== "string" ||
    !hex.test(value.device) ||
    !integer(value.processId) ||
    value.processId === 0 ||
    !integer(value.receivedAt) ||
    (value.retiredAt !== undefined && !integer(value.retiredAt)) ||
    !Array.isArray(value.owners) ||
    value.owners.length > 20_000
  )
    throw new Error("Native buffer report is corrupt and remains held");
  const owners = value.owners.map((owner) => ownerSnapshot(owner, false, 0));
  if (new Set(owners.map((owner) => owner.ownerId)).size !== owners.length)
    throw new Error("Native buffer report has duplicate owners and remains held");
  const report = { ...value, owners } as unknown as BufferLease;
  if (value.originalDelivery !== undefined) {
    const binding = value.originalDelivery;
    if (
      !record(binding) ||
      Object.keys(binding).some(
        (key) =>
          !["originalId", "sha256", "byteLength", "principalId", "environmentId"].includes(key),
      ) ||
      typeof binding.principalId !== "string" ||
      !hex.test(binding.principalId)
    )
      throw new Error("Native buffer delivery binding is corrupt and remains held");
    NativeDeliveryIdentitySchema.parse({
      originalId: binding.originalId,
      sha256: binding.sha256,
      byteLength: binding.byteLength,
    });
    identity(binding.environmentId, "delivery environment");
    report.originalDelivery = binding as NativeBufferDeliveryBinding;
  }
  if (reportKey(report) !== expectedReportId)
    throw new Error("Native buffer report identity changed");
  if (value.recovery !== undefined) {
    const meta = value.recovery;
    if (
      !record(meta) ||
      meta.version !== 1 ||
      !["projection", "hold"].includes(meta.kind as string) ||
      !integer(meta.reportVersion) ||
      !record(meta.ownerVersions) ||
      !record(meta.ownerLineages) ||
      !Array.isArray(meta.heldOwnerIds) ||
      meta.heldOwnerIds.some((key) => typeof key !== "string") ||
      owners.some(
        (owner) =>
          !Object.hasOwn(meta.ownerVersions as object, owner.ownerId) ||
          !integer((meta.ownerVersions as Record<string, unknown>)[owner.ownerId]) ||
          !Object.hasOwn(meta.ownerLineages as object, owner.ownerId) ||
          !["physical", "legacy"].includes(
            (meta.ownerLineages as Record<string, string>)[owner.ownerId],
          ),
      )
    )
      throw new Error("Native buffer recovery metadata is corrupt and remains held");
    if (
      meta.kind === "hold" &&
      (typeof meta.parentReportId !== "string" ||
        !hex.test(meta.parentReportId) ||
        typeof meta.sourceOwnerId !== "string" ||
        typeof meta.holdDigest !== "string" ||
        !hex.test(meta.holdDigest))
    )
      throw new Error("Native buffer hold identity is corrupt");
    report.recovery = meta as unknown as RecoveryMetadata;
    if (
      meta.clockId !== undefined &&
      (typeof meta.clockId !== "string" || !uuid.test(meta.clockId))
    )
      throw new Error("Native buffer clock identity is corrupt");
    if (meta.kind === "hold") {
      const projection = owners[0],
        sourceOwnerId = meta.sourceOwnerId as string,
        holdHash = meta.holdDigest as string;
      if (
        value.retiredAt !== undefined ||
        owners.length !== 1 ||
        !projection.unknown ||
        projection.ownerId !== `${HOLD_PREFIX}${holdHash}` ||
        value.instanceId !== `${HOLD_PREFIX}${meta.parentReportId}:${holdHash}` ||
        meta.heldOwnerIds.length !== 1 ||
        meta.heldOwnerIds[0] !== projection.ownerId ||
        (meta.ownerLineages as Record<string, string>)[projection.ownerId] !== "legacy" ||
        ![false, true].some(
          (unknown) => heldDigest({ ...projection, ownerId: sourceOwnerId, unknown }) === holdHash,
        )
      )
        throw new Error("Native buffer retained hold binding is corrupt and remains held");
    }
  }
  if (value.instanceId.startsWith(HOLD_PREFIX) && report.recovery?.kind !== "hold")
    throw new Error("Native buffer retained hold metadata is missing and remains held");
  return { reportId: expectedReportId, raw, value: report, snapshotDigest: sha(raw) };
}
function exactPhysical(owner: NativeBufferOwnerSnapshot): boolean {
  const source = owner.source;
  return (
    !!source &&
    source.kind === "physical" &&
    !!source.storeInstance &&
    !!source.windowIncarnation &&
    !!source.reportNonce &&
    owner.ownerId === `physical:v2:${sha(`${source.storeInstance}:${source.windowIncarnation}`)}`
  );
}
function sameLineage(a: NativeBufferOwnerSnapshot, b: NativeBufferOwnerSnapshot): boolean {
  return (
    exactPhysical(a) &&
    exactPhysical(b) &&
    a.source!.sourceStoreId === b.source!.sourceStoreId &&
    a.source!.sourceProfileId === b.source!.sourceProfileId &&
    a.source!.storeInstance === b.source!.storeInstance &&
    a.source!.windowIncarnation === b.source!.windowIncarnation
  );
}
function heldDigest(owner: NativeBufferOwnerSnapshot): string {
  // Time/nonce/version do not multiply equivalent unresolved workspace holds.
  return digest({
    ownerId: owner.ownerId,
    unknown: owner.unknown,
    buffers: owner.buffers,
    source: owner.source
      ? {
          kind: owner.source.kind,
          sourceStoreId: owner.source.sourceStoreId,
          sourceProfileId: owner.source.sourceProfileId,
          storeInstance: owner.source.storeInstance,
          windowIncarnation: owner.source.windowIncarnation,
        }
      : null,
  });
}
const reportVersion = (value: BufferLease) => value.recovery?.reportVersion ?? 0;
const ownerVersion = (value: BufferLease, id: string) => value.recovery?.ownerVersions[id] ?? 0;
const ownersOf = (captured: Captured): NativeBufferOwnerSnapshot[] =>
  captured.value.owners.length
    ? captured.value.owners
    : [
        {
          ownerId: `${EMPTY_PREFIX}${captured.reportId}`,
          updatedAt: captured.value.receivedAt,
          unknown: true,
          buffers: [],
        },
      ];
const sourceKey = (source: NativeBufferRecoverySource) =>
  `${source.reportId}:${source.reportVersion.toString().padStart(16, "0")}:${source.snapshotDigest}:${source.ownerId}:${source.ownerVersion}`;
function sourceReference(value: unknown): NativeBufferRecoverySource {
  if (
    !record(value) ||
    Object.keys(value).length !== 5 ||
    typeof value.reportId !== "string" ||
    !hex.test(value.reportId) ||
    !integer(value.reportVersion) ||
    !integer(value.ownerVersion) ||
    typeof value.snapshotDigest !== "string" ||
    !hex.test(value.snapshotDigest)
  )
    throw new Error("Invalid native buffer recovery source");
  identity(value.ownerId, "recovery owner identity");
  return {
    reportId: value.reportId,
    reportVersion: value.reportVersion,
    ownerVersion: value.ownerVersion,
    ownerId: value.ownerId,
    snapshotDigest: value.snapshotDigest,
  };
}

/** Every archived version stays a recovery source; only unreferenced blobs are collected
 * (native-buffer-blob-gc.ts). No method resolves dirty/unknown sources. */
export function createNativeBufferReports(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const persistence = deps.persistence;
  const retention = persistence
    ? createNativeBufferRetention({ root: deps.root, persistence })
    : undefined;
  const directories = persistence
    ? createNativeBufferDirectories({ root: deps.root, persistence })
    : undefined;
  const write = retention ? retention.write : (deps.write ?? durableWrite);
  let importer: NativeBufferRetentionImporter<Captured> | undefined;
  const clock = createNativeBufferClock({
    root: deps.root,
    write: deps.write,
    backing: persistence
      ? {
          readClock: (id) => persistence.readClock(id),
          initializeClock: (state, authorize) => importer!.initializeClock(state, authorize),
          advanceClock: (expected, next, authorize) =>
            persistence.advanceClock(expected, next, authorize),
        }
      : undefined,
  });
  const directory = join(deps.root, "native-activity", "buffers");
  const history = join(deps.root, "native-activity", "buffer-history");
  const refreshed = new Set<string>();
  const snapshotPath = (id: string) => join(directory, `${id}.json`);
  const manifestPath = (
    source: Pick<NativeBufferRecoverySource, "reportId" | "reportVersion" | "snapshotDigest">,
  ) =>
    join(
      history,
      "reports",
      source.reportId,
      `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.json`,
    );
  const rawArchivePath = (
    source: Pick<NativeBufferRecoverySource, "reportId" | "reportVersion" | "snapshotDigest">,
  ) =>
    join(
      history,
      "raw",
      source.reportId,
      `${source.reportVersion.toString().padStart(16, "0")}-${source.snapshotDigest}.bin`,
    );
  async function names(path: string) {
    if (directories) return directories.names(path);
    return legacyNames(path);
  }
  async function legacyNames(path: string) {
    try {
      return (await readdir(path)).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async function readBounded(path: string, limit: number): Promise<Buffer | null> {
    if (retention) return retention.read(path, limit, () => readLegacyBounded(path, limit));
    return readLegacyBounded(path, limit);
  }
  async function readLegacyBounded(path: string, limit: number): Promise<Buffer | null> {
    let file;
    try {
      file = await open(path, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      if ((await file.stat()).size > limit)
        throw new Error("Native buffer retained data exceeds inspection limit and remains held");
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, limit - total + 1));
        const { bytesRead } = await file.read(chunk);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > limit)
          throw new Error("Native buffer retained data exceeds inspection limit and remains held");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, total);
    } finally {
      await file.close();
    }
  }
  async function current(id: string): Promise<Captured | null> {
    const raw =
      persistence && (await persistence.readClock(id))
        ? await retention!.sqlOnly(() => readBounded(snapshotPath(id), MAX_REPORT_BYTES))
        : await readBounded(snapshotPath(id), MAX_REPORT_BYTES);
    return raw ? parseStored(raw, id) : null;
  }
  async function* snapshots() {
    const before = (await names(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    for (const name of before) {
      const captured = await current(name.slice(0, -5));
      if (captured) yield captured;
    }
    const after = (await names(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Native buffer inventory changed and remains held; retry");
  }
  async function authenticate(owner: CapturedAuthorization, expected?: string) {
    const unchanged = () =>
      owner.capability?.ownerId === owner.ownerId &&
      owner.capability.authorizationId === owner.authorizationId;
    if (!unchanged()) throw new Error("Native buffer owner authorization changed");
    const device = await deps.authenticate(owner.capability);
    if (!unchanged()) throw new Error("Native buffer owner authorization changed");
    if (expected !== undefined && device !== expected)
      throw new Error("Native buffer owner authorization changed");
    return device;
  }
  async function immutable(path: string, bytes: Buffer | string) {
    const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const existing = await readBounded(path, Math.max(MAX_MANIFEST_BYTES, raw.length));
    if (existing) {
      if (!existing.equals(raw))
        throw new Error("Native buffer immutable retention identity changed");
      if (retention) await retention.write(path, raw, true);
      return;
    }
    if (retention) await retention.write(path, raw, true);
    else await write(path, raw);
  }
  const templates = createNativeBufferTemplates({
    directory: history,
    read: readBounded,
    immutable,
  });
  const authorizeOwner = (owner: CapturedAuthorization) => async () => {
    await authenticate(owner);
  };
  const mutate = async <T>(owner: CapturedAuthorization, action: () => Promise<T>) => {
    await initializeRetention();
    return deps.serial(() =>
      retention ? retention.mutate(authorizeOwner(owner), action) : action(),
    );
  };
  function retainCertificate(captured: Captured, state: NativeBufferClockState) {
    const value = captured.value,
      version = reportVersion(value);
    if (!retention || value.recovery?.kind === "hold" || !value.recovery?.clockId || version < 1)
      return;
    if (
      state.reportId !== captured.reportId ||
      state.clockId !== value.recovery.clockId ||
      state.highWater < version
    )
      throw new Error("Native buffer retained source disagrees with its reserved clock");
    retention.certificate({
      reportId: captured.reportId,
      reportVersion: version,
      snapshotDigest: captured.snapshotDigest,
      byteLength: captured.raw.length,
      clockId: state.clockId,
      raw: captured.raw,
      ...(value.originalDelivery ? { originalDelivery: value.originalDelivery } : {}),
    });
  }
  async function sqlArchive<T>(id: string, action: () => Promise<T>): Promise<T> {
    return persistence && (await persistence.readClock(id)) ? retention!.sqlOnly(action) : action();
  }
  importer =
    persistence && retention
      ? createNativeBufferRetentionImporter<Captured>({
          persistence,
          retention,
          currentDirectory: directory,
          historyDirectory: history,
          maximumReportBytes: MAX_REPORT_BYTES,
          maximumManifestBytes: MAX_MANIFEST_BYTES,
          maximumCatalogBytes: MAX_CATALOG_BYTES,
          serial: deps.serial,
          names,
          legacyNames,
          read: readBounded,
          current,
          snapshotPath,
          manifestPath,
          archive,
          readArchive,
          state: (captured) => ({
            version: reportVersion(captured.value),
            clockId: captured.value.recovery?.clockId,
            hold: captured.value.recovery?.kind === "hold",
          }),
          readCatalog: (receipt, maximum) => templates.read(receipt, maximum),
          bootstrap: bootstrapVersion,
          adopt: (id, options) => clock.adopt(id, options),
          certificate: retainCertificate,
        })
      : undefined;
  function initializeRetention() {
    return importer?.initialize() ?? Promise.resolve();
  }
  async function archive(captured: Captured) {
    const reference = {
      reportId: captured.reportId,
      reportVersion: reportVersion(captured.value),
      snapshotDigest: captured.snapshotDigest,
      ownerId: "unused",
      ownerVersion: 0,
    };
    let retained: Captured | null;
    try {
      retained = retention
        ? await retention.captureReads(() => readArchive(reference))
        : await readArchive(reference);
    } catch (error) {
      if (
        !retention ||
        !(error instanceof Error) ||
        !/Native buffer (immutable|shared template)/.test(error.message)
      )
        throw error;
      const header = await readBounded(manifestPath(reference), MAX_MANIFEST_BYTES);
      const value: unknown = header ? JSON.parse(header.toString("utf8")) : null;
      if (
        !record(value) ||
        ![1, 2].includes(value.version as number) ||
        value.reportId !== reference.reportId ||
        value.reportVersion !== reference.reportVersion ||
        value.snapshotDigest !== captured.snapshotDigest ||
        value.byteLength !== captured.raw.length
      )
        throw error;
      // Authorized migration/retention can preserve a known exact current body
      // even if an older archive lost an encoding piece. Keep its original
      // manifest unchanged; the independent raw copy is not an actor or repair.
      await retention.write(rawArchivePath(reference), captured.raw, true);
      await retention.write(manifestPath(reference), header!, true);
      return;
    }
    if (retained) {
      if (!retained.raw.equals(captured.raw))
        throw new Error("Native buffer retained source bytes changed");
      return;
    }
    let catalog: NativeBufferRecoveryMetadata[] | undefined = [];
    let catalogBytes = 0;
    for (const item of ownersOf(captured)) {
      if (captured.value.recovery?.heldOwnerIds.includes(item.ownerId)) continue;
      const row = metadata(captured, item, "historical");
      catalogBytes += Buffer.byteLength(JSON.stringify(row));
      if (catalogBytes > MAX_CATALOG_BYTES) {
        catalog = undefined;
        break;
      }
      catalog.push(row);
    }
    const common: ManifestBase = {
      reportId: captured.reportId,
      reportVersion: reportVersion(captured.value),
      snapshotDigest: captured.snapshotDigest,
      byteLength: captured.raw.length,
      ...(captured.value.recovery?.clockId ? { clockId: captured.value.recovery.clockId } : {}),
      device: captured.value.device,
    };
    // Every version remains exact. Only its unchanged static bytes/index are
    // shared; timestamps, nonces and monotonic receipts are never coalesced.
    const prepared = prepareNativeBufferTemplate(captured.raw, MAX_REPORT_BYTES),
      catalogRaw = catalog ? Buffer.from(JSON.stringify(catalog)) : undefined,
      preparedCatalog = catalogRaw
        ? prepareNativeBufferTemplate(catalogRaw, MAX_CATALOG_BYTES, "catalog")
        : null;
    const shared: Manifest | null =
      prepared && (!catalogRaw || preparedCatalog)
        ? {
            ...common,
            version: 2,
            body: prepared.receipt,
            ...(preparedCatalog
              ? { catalogBody: preparedCatalog.receipt, catalogDigest: sha(catalogRaw!) }
              : {}),
          }
        : null;
    let manifest: Manifest;
    if (shared && Buffer.byteLength(JSON.stringify(shared)) <= MAX_MANIFEST_BYTES) {
      await templates.persist(prepared!);
      if (preparedCatalog) await templates.persist(preparedCatalog);
      manifest = shared;
    } else {
      // Valid old reports may contain arbitrary extensions. Unsupported token
      // expansion must not shrink the existing retained64MiB acceptance.
      const chunks: { digest: string; byteLength: number }[] = [];
      for (let offset = 0; offset < captured.raw.length; offset += CHUNK_BYTES) {
        const raw = captured.raw.subarray(offset, offset + CHUNK_BYTES),
          hash = sha(raw);
        await immutable(join(history, "chunks", `${hash}.bin`), raw);
        chunks.push({ digest: hash, byteLength: raw.length });
      }
      manifest = {
        ...common,
        version: 1,
        chunks,
        ...(catalog ? { catalog, catalogDigest: digest(catalog) } : {}),
      };
    }
    const body = JSON.stringify(manifest);
    if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES)
      throw new Error("Native buffer retained metadata exceeds archive limit; source remains held");
    await immutable(manifestPath(manifest), body);
  }
  async function writeSnapshot(id: string, raw: string | Buffer) {
    if (!persistence) {
      await write(snapshotPath(id), raw);
      return;
    }
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
      captured = parseStored(bytes, id);
    await write(snapshotPath(id), bytes);
    await archive(captured);
    const state = await persistence.readClock(id);
    if (state) retainCertificate(captured, state);
  }
  async function readArchive(
    source: NativeBufferRecoverySource,
    manifestRaw?: Buffer,
  ): Promise<Captured | null> {
    if (persistence && source.reportVersion >= 1) {
      const certificate = await persistence.readCertificate(
        {
          reportId: source.reportId,
          reportVersion: source.reportVersion,
          snapshotDigest: source.snapshotDigest,
        },
        MAX_REPORT_BYTES,
      );
      if (certificate) {
        const captured = parseStored(certificate.raw, source.reportId);
        if (
          captured.snapshotDigest !== source.snapshotDigest ||
          reportVersion(captured.value) !== source.reportVersion
        )
          throw new Error("Native buffer retained certificate disagrees with its exact source");
        return { ...captured, archiveReadBytes: certificate.raw.length };
      }
    }
    if (persistence) {
      const raw = await persistence.read(retention!.key(rawArchivePath(source)), MAX_REPORT_BYTES);
      if (raw) {
        const captured = parseStored(raw, source.reportId);
        if (
          captured.snapshotDigest !== source.snapshotDigest ||
          reportVersion(captured.value) !== source.reportVersion
        )
          throw new Error("Native buffer retained raw source disagrees with its exact identity");
        return { ...captured, archiveReadBytes: raw.length };
      }
    }
    return sqlArchive(source.reportId, () => readArchiveArtifacts(source, manifestRaw));
  }
  async function readArchiveArtifacts(
    source: NativeBufferRecoverySource,
    manifestRaw?: Buffer,
  ): Promise<Captured | null> {
    const raw = manifestRaw ?? (await readBounded(manifestPath(source), MAX_MANIFEST_BYTES));
    if (!raw) return null;
    const manifest: unknown = JSON.parse(raw.toString("utf8"));
    if (
      !record(manifest) ||
      ![1, 2].includes(manifest.version as number) ||
      manifest.reportId !== source.reportId ||
      manifest.reportVersion !== source.reportVersion ||
      manifest.snapshotDigest !== source.snapshotDigest ||
      !integer(manifest.byteLength) ||
      manifest.byteLength > MAX_REPORT_BYTES
    )
      throw new Error("Native buffer immutable manifest is corrupt");
    if (manifest.version === 2) {
      const decoded = await templates.read(manifest.body, MAX_REPORT_BYTES, {
        byteLength: manifest.byteLength,
        digest: source.snapshotDigest,
      });
      const captured = parseStored(decoded.raw, source.reportId);
      if (reportVersion(captured.value) !== source.reportVersion)
        throw new Error("Native buffer immutable report version changed");
      return { ...captured, archiveReadBytes: raw.length + decoded.bytes };
    }
    if (
      !Array.isArray(manifest.chunks) ||
      manifest.chunks.length > Math.ceil(MAX_REPORT_BYTES / CHUNK_BYTES)
    )
      throw new Error("Native buffer immutable manifest is corrupt");
    const pieces: Buffer[] = [];
    let total = 0;
    for (const piece of manifest.chunks) {
      if (
        !record(piece) ||
        typeof piece.digest !== "string" ||
        !hex.test(piece.digest) ||
        !integer(piece.byteLength) ||
        piece.byteLength === 0 ||
        piece.byteLength > CHUNK_BYTES
      )
        throw new Error("Native buffer immutable chunk identity is corrupt");
      const bytes = await readBounded(join(history, "chunks", `${piece.digest}.bin`), CHUNK_BYTES);
      if (!bytes || bytes.length !== piece.byteLength || sha(bytes) !== piece.digest)
        throw new Error("Native buffer immutable chunk is unavailable or corrupt");
      pieces.push(bytes);
      total += bytes.length;
    }
    const bytes = Buffer.concat(pieces, total);
    if (total !== manifest.byteLength || sha(bytes) !== source.snapshotDigest)
      throw new Error("Native buffer immutable snapshot digest changed");
    const captured = parseStored(bytes, source.reportId);
    if (reportVersion(captured.value) !== source.reportVersion)
      throw new Error("Native buffer immutable report version changed");
    return { ...captured, archiveReadBytes: raw.length + bytes.length };
  }
  async function bootstrapVersion(id: string, previous: Captured | null) {
    let version = previous ? reportVersion(previous.value) : 0;
    for (const name of await names(join(history, "reports", id))) {
      const match = /^(\d{16})-([a-f0-9]{64})\.json$/.exec(name);
      if (!match) continue;
      const raw = await readBounded(join(history, "reports", id, name), MAX_MANIFEST_BYTES);
      if (!raw) throw new Error("Native buffer legacy clock source changed");
      const manifest: unknown = JSON.parse(raw.toString("utf8"));
      if (
        !record(manifest) ||
        ![1, 2].includes(manifest.version as number) ||
        manifest.reportId !== id ||
        manifest.reportVersion !== Number(match[1]) ||
        manifest.snapshotDigest !== match[2] ||
        manifest.clockId !== undefined
      )
        throw new Error("Native buffer legacy clock history is corrupt or was already initialized");
      version = Math.max(version, Number(match[1]));
    }
    if (!integer(version)) throw new Error("Native buffer report version exhausted");
    return version;
  }
  const captureOwner = (owner: WorkspaceOwnerAuthorization): CapturedAuthorization => ({
    capability: owner,
    ownerId: owner?.ownerId,
    authorizationId: owner?.authorizationId,
  });
  const beats = createNativeBufferHeartbeat({
    now,
    refreshed,
    mutate,
    authenticate,
    captureOwner,
    current,
    reportKey,
    identity,
  });
  const held = (owner: NativeBufferOwnerSnapshot) =>
    owner.unknown || owner.buffers.some((buffer) => buffer.dirty);
  const clean = (value: BufferLease) => value.owners.length > 0 && !value.owners.some(held);

  async function probe(workspaceId: string): Promise<WorkspaceActivity[]> {
    // Registry identity survives directory tombstones/removal; do not require Git.
    const stored = (await deps.listWorkspaces()).find((entry) => entry.id === workspaceId);
    if (!stored) throw new Error("Native workspace registry identity is unavailable");
    const workspace = { ...stored, path: await canonicalWorkspaceEntry(stored.path) };
    const result = new Map<string, WorkspaceActivity>();
    for await (const captured of snapshots()) {
      const report = captured.value;
      if (report.retiredAt !== undefined) continue;
      const stale =
        !refreshed.has(captured.reportId) ||
        now() - beats.fresh(captured.reportId, report.receivedAt) > 45_000 ||
        report.receivedAt > now();
      const blocked =
        report.owners.length === 0 ||
        report.owners.some((owner) => {
          const unknown =
            owner.unknown ||
            stale ||
            now() - beats.fresh(captured.reportId, owner.updatedAt) > 45_000;
          return owner.buffers.length === 0
            ? unknown
            : owner.buffers.some(
                (buffer) => contains(workspace.path, buffer.path) && (unknown || buffer.dirty),
              );
        });
      if (blocked) {
        const parent =
          report.recovery?.kind === "hold" ? report.recovery.parentReportId! : captured.reportId;
        const ownerId = `native-buffer:${parent}`;
        if (!result.has(ownerId))
          result.set(ownerId, {
            id: `${ownerId}:${workspaceId}`,
            workspaceId,
            kind: "editor",
            ownerId,
            startedAt: report.receivedAt,
            dirtyBuffer: true,
          });
      }
    }
    return [...result.values()];
  }

  function updateBuffers(
    input: NativeBufferSnapshot,
    authorization: WorkspaceOwnerAuthorization,
    delivery?: NativeBufferDeliveryOptions,
  ) {
    // Capture caller data before the shared gate/first await; never mutate it.
    const request: unknown = structuredClone(input),
      owner = captureOwner(authorization),
      deliveryBinding = delivery ? structuredClone(delivery.binding) : undefined;
    return mutate(owner, async () => {
      const device = await authenticate(owner);
      if (!record(request)) throw new Error("Invalid native buffer snapshot");
      identity(request.clientId, "client identity");
      identity(request.instanceId, "instance identity");
      if (request.instanceId.startsWith(HOLD_PREFIX))
        throw new Error("Reserved native buffer instance identity");
      if (!integer(request.processId) || request.processId === 0)
        throw new Error("Invalid native process identity");
      if (!Array.isArray(request.owners) || request.owners.length > 1000)
        throw new Error("Invalid native buffer owners");
      const incoming = request.owners.map((item) => ownerSnapshot(item, true, now()));
      const incomingIds = new Set(incoming.map((item) => item.ownerId));
      if (incomingIds.size !== incoming.length) throw new Error("Duplicate native buffer window");
      if (Buffer.byteLength(JSON.stringify(request)) > MAX_INPUT_BYTES)
        throw new Error("Native buffer snapshot is too large");
      for (const item of incoming) {
        if (item.source?.kind !== "physical") continue;
        // Native BufferState is serialized in this field order. Preserve that
        // exact native digest independently of the canonical Host guard paths.
        const nativeBody = JSON.stringify(item.buffers.map(({ path, dirty }) => ({ path, dirty })));
        if (
          item.buffers.some(
            (buffer) => Buffer.from(buffer.path).toString("utf8") !== buffer.path,
          ) ||
          sha(nativeBody) !== item.source.snapshotDigest
        )
          throw new Error("Native physical buffer source digest does not match received bytes");
      }
      for (const item of incoming)
        for (const buffer of item.buffers)
          buffer.path = await canonicalWorkspaceDirectory(buffer.path);
      const id = reportKey({ device, clientId: request.clientId, instanceId: request.instanceId });
      const previous = await current(id);
      if (previous?.value.retiredAt !== undefined)
        throw new Error("Native buffer instance already retired");
      if (previous && previous.value.processId !== request.processId)
        throw new Error("Native instance process identity changed");
      if (retention) await importer!.importReport(id, previous, authorizeOwner(owner));
      const reservation = await clock.reserve(id, {
        observedVersion: previous ? reportVersion(previous.value) : 0,
        observedClockId: previous?.value.recovery?.clockId,
        bootstrap: () => bootstrapVersion(id, previous),
        authorize: async () => {
          await authenticate(owner, device);
        },
      });
      const version = reservation.value;
      const nextOwners = new Map(incoming.map((item) => [item.ownerId, item]));
      const versions = new Map<string, number>();
      const lineages = new Map<string, "physical" | "legacy">();
      const heldIds = new Set(previous?.value.recovery?.heldOwnerIds ?? []);
      const pendingHolds: { projection: NativeBufferOwnerSnapshot; value: BufferLease }[] = [];
      const previousStale =
        previous &&
        (!refreshed.has(id) ||
          now() - beats.fresh(id, previous.value.receivedAt) > 45_000 ||
          previous.value.receivedAt > now());
      for (const before of previous ? ownersOf(previous) : []) {
        const after = nextOwners.get(before.ownerId);
        if (heldIds.has(before.ownerId)) {
          nextOwners.set(before.ownerId, before);
          versions.set(before.ownerId, ownerVersion(previous!.value, before.ownerId));
          lineages.set(before.ownerId, "legacy");
          continue;
        }
        const same =
          after &&
          previous?.value.recovery?.ownerLineages[before.ownerId] === "physical" &&
          sameLineage(before, after);
        lineages.set(
          before.ownerId,
          same || (!after && previous?.value.recovery?.ownerLineages[before.ownerId] === "physical")
            ? "physical"
            : "legacy",
        );
        if (same) {
          const unchangedNativeBody =
            after.updatedAt === before.updatedAt &&
            JSON.stringify(after.buffers) === JSON.stringify(before.buffers) &&
            JSON.stringify(after.source) === JSON.stringify(before.source);
          if (
            after.source!.reportVersion < before.source!.reportVersion ||
            (after.source!.reportVersion === before.source!.reportVersion && !unchangedNativeBody)
          )
            throw new Error("Native buffer source version is stale or reused");
        }
        const physicalOmission =
          !after &&
          previous?.value.recovery?.ownerLineages[before.ownerId] === "physical" &&
          exactPhysical(before);
        if (
          (held(before) || previousStale || now() - beats.fresh(id, before.updatedAt) > 45_000) &&
          !same &&
          !physicalOmission
        ) {
          const hash = heldDigest(before),
            heldId = `${HOLD_PREFIX}${hash}`;
          const projection = { ...before, ownerId: heldId, unknown: true };
          nextOwners.set(heldId, projection);
          heldIds.add(heldId);
          versions.set(heldId, ownerVersion(previous!.value, before.ownerId));
          lineages.set(heldId, "legacy");
          const shadow: BufferLease = {
            clientId: request.clientId,
            instanceId: `${HOLD_PREFIX}${id}:${hash}`,
            processId: previous!.value.processId,
            owners: [projection],
            device,
            receivedAt: previous!.value.receivedAt,
            recovery: {
              version: 1,
              kind: "hold",
              reportVersion: reportVersion(previous!.value),
              ownerVersions: Object.fromEntries([
                [heldId, ownerVersion(previous!.value, before.ownerId)],
              ]),
              ownerLineages: Object.fromEntries([[heldId, "legacy"]]),
              heldOwnerIds: [heldId],
              parentReportId: id,
              sourceOwnerId: before.ownerId,
              holdDigest: hash,
            },
          };
          const existing = await current(reportKey(shadow));
          if (existing) {
            if (
              existing.value.recovery?.kind !== "hold" ||
              existing.value.recovery.parentReportId !== id ||
              existing.value.recovery.holdDigest !== hash ||
              existing.value.recovery.sourceOwnerId !== before.ownerId ||
              existing.value.owners.length !== 1 ||
              existing.value.owners[0].ownerId !== heldId ||
              !existing.value.owners[0].unknown ||
              heldDigest({
                ...existing.value.owners[0],
                ownerId: before.ownerId,
                unknown: before.unknown,
              }) !== hash
            )
              throw new Error("Native buffer retained hold identity changed");
            nextOwners.set(heldId, existing.value.owners[0]);
            versions.set(heldId, ownerVersion(existing.value, heldId));
          } else pendingHolds.push({ projection, value: shadow });
        }
        if (!after) nextOwners.set(before.ownerId, { ...before, unknown: true });
      }
      for (const item of nextOwners.values()) {
        if (!lineages.has(item.ownerId))
          lineages.set(item.ownerId, exactPhysical(item) ? "physical" : "legacy");
        if (versions.has(item.ownerId)) continue;
        const before = previous?.value.owners.find((entry) => entry.ownerId === item.ownerId);
        const oldVersion = previous ? ownerVersion(previous.value, item.ownerId) : 0;
        const next =
          before && JSON.stringify(before) === JSON.stringify(item) ? oldVersion : oldVersion + 1;
        if (!integer(next)) throw new Error("Native buffer owner version exhausted");
        versions.set(item.ownerId, next);
      }
      const report: BufferLease = {
        clientId: request.clientId,
        instanceId: request.instanceId,
        processId: request.processId,
        owners: [...nextOwners.values()],
        device,
        receivedAt: now(),
        ...(deliveryBinding ? { originalDelivery: deliveryBinding } : {}),
        recovery: {
          version: 1,
          kind: "projection",
          reportVersion: version,
          ownerVersions: Object.fromEntries(versions),
          ownerLineages: Object.fromEntries(lineages),
          heldOwnerIds: [...heldIds],
          clockId: reservation.clockId,
        },
      };
      const bytes = JSON.stringify(report);
      if (Buffer.byteLength(bytes) > MAX_REPORT_BYTES)
        throw new Error("Native buffer retained projection is too large and remains held");
      await authenticate(owner, device);
      if (delivery) {
        await delivery.prepared({
          reportId: id,
          reportVersion: version,
          snapshotDigest: sha(Buffer.from(bytes)),
          byteLength: Buffer.byteLength(bytes),
        });
        await authenticate(owner, device);
      }
      if (previous) await archive(previous);
      await authenticate(owner, device);
      for (const hold of pendingHolds)
        await immutable(snapshotPath(reportKey(hold.value)), JSON.stringify(hold.value));
      await authenticate(owner, device);
      await writeSnapshot(id, bytes);
      const committed = () => beats.remember(id, incoming);
      if (retention) retention.afterCommit(committed);
      else committed();
      await authenticate(owner, device);
      return { acknowledged: true as const };
    });
  }

  function retireBuffers(
    request: { clientId: string; instanceId: string; processId: number },
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const input = structuredClone(request),
      owner = captureOwner(authorization);
    return mutate(owner, async () => {
      const device = await authenticate(owner);
      identity(input.clientId, "client identity");
      identity(input.instanceId, "instance identity");
      const id = reportKey({ device, ...input }),
        captured = await current(id);
      if (!captured || captured.value.processId !== input.processId)
        throw new Error("Native buffer instance identity is unavailable");
      if (captured.value.retiredAt !== undefined) return { acknowledged: true as const };
      if (!clean(captured.value) || captured.value.recovery?.kind === "hold")
        throw new Error("Dirty or unknown buffers require explicit owner recovery");
      await archive(captured);
      await authenticate(owner, device);
      await writeSnapshot(id, JSON.stringify({ ...captured.value, retiredAt: now() }));
      await authenticate(owner, device);
      return { acknowledged: true as const };
    });
  }

  const reconcileOutcome = createReconcileOutcome();
  function reconcileBuffers(
    request: {
      clientId: string;
      instanceId: string;
      predecessors: { instanceId: string; processId: number }[];
    },
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const input = structuredClone(request),
      owner = captureOwner(authorization);
    return mutate(owner, async () => {
      const device = await authenticate(owner);
      identity(input.clientId, "client identity");
      identity(input.instanceId, "instance identity");
      if (!Array.isArray(input.predecessors) || input.predecessors.length > 1000)
        throw new Error("Invalid predecessor identities");
      for (const entry of input.predecessors) {
        identity(entry.instanceId, "predecessor identity");
        if (!integer(entry.processId) || entry.processId === 0)
          throw new Error("Invalid predecessor process identity");
      }
      const latest = await current(reportKey({ device, ...input }));
      if (!latest || latest.value.retiredAt !== undefined)
        throw new Error("Fresh native instance report required");
      const blocked: { instanceId: string; processId: number }[] = [];
      for await (const captured of snapshots()) {
        const prior = captured.value;
        if (
          prior.device !== device ||
          prior.clientId !== input.clientId ||
          prior.instanceId === input.instanceId ||
          prior.retiredAt !== undefined
        )
          continue;
        if (
          input.predecessors.length &&
          !input.predecessors.some(
            (entry) => entry.instanceId === prior.instanceId && entry.processId === prior.processId,
          )
        )
          continue;
        if (!clean(prior) || prior.recovery?.kind === "hold") {
          blocked.push({ instanceId: prior.instanceId, processId: prior.processId });
          continue;
        }
        assertProcessDead(prior.processId);
        await archive(captured);
        await authenticate(owner, device);
        await writeSnapshot(captured.reportId, JSON.stringify({ ...prior, retiredAt: now() }));
        await authenticate(owner, device);
        if (retention) await retention.flush(authorizeOwner(owner));
      }
      return reconcileOutcome(input.clientId, blocked);
    });
  }

  function metadata(
    captured: Captured,
    item: NativeBufferOwnerSnapshot,
    retention: NativeBufferRecoveryMetadata["retention"],
  ): NativeBufferRecoveryMetadata {
    const value = captured.value;
    return {
      source: {
        reportId: captured.reportId,
        reportVersion: reportVersion(value),
        ownerId: item.ownerId,
        ownerVersion: ownerVersion(value, item.ownerId),
        snapshotDigest: captured.snapshotDigest,
      },
      clientId: value.clientId,
      instanceId: value.instanceId,
      processId: value.processId,
      updatedAt: item.updatedAt,
      byteLength: captured.raw.length,
      bufferCount: item.buffers.length,
      dirtyCount: item.buffers.filter((buffer) => buffer.dirty).length,
      unknown: item.unknown,
      provenance: item.source ? { ...item.source } : null,
      lineage: value.recovery?.ownerLineages[item.ownerId] ?? "legacy",
      ownerMissing: item.ownerId.startsWith(EMPTY_PREFIX),
      compatibilityHoldId: reportKey({
        device: value.device,
        clientId: value.clientId,
        instanceId: `${HOLD_PREFIX}${captured.reportId}:${heldDigest(item)}`,
      }),
      verification: "raw-checked",
      retention,
      inspectable: captured.raw.length <= MAX_DISCLOSURE_BYTES,
      qualified: false,
      resolution: "unsupported",
    };
  }
  const catalog = createNativeBufferCatalog<NativeBufferRecoveryMetadata>({
    activeDirectory: directory,
    historyDirectory: join(history, "reports"),
    ...(directories ? { openDirectory: directories.open } : {}),
    now,
    activeReadBound: MAX_REPORT_BYTES,
    historyReadBound: MAX_HISTORY_READ_BYTES,
    key: (row) => sourceKey(row.source),
    active: async (id, device) => {
      const captured = await current(id);
      if (!captured || captured.value.device !== device || captured.value.recovery?.kind === "hold")
        return { records: [], bytes: captured?.raw.length ?? 0 };
      const owners = ownersOf(captured).filter(
        (item) => !captured.value.recovery?.heldOwnerIds.includes(item.ownerId),
      );
      return {
        length: owners.length,
        at: (index) => metadata(captured, owners[index], "current"),
        bytes: captured.raw.length,
      };
    },
    history: (id, name, device) =>
      sqlArchive(id, async () => {
        const match = /^(\d{16})-([a-f0-9]{64})\.json$/.exec(name);
        if (!match) throw new Error("Invalid native buffer catalog manifest identity");
        const source = {
          reportId: id,
          reportVersion: Number(match[1]),
          snapshotDigest: match[2],
          ownerId: "unused",
          ownerVersion: 0,
        };
        const raw = await readBounded(manifestPath(source), MAX_MANIFEST_BYTES);
        if (!raw) throw new Error("Native buffer catalog manifest changed");
        const value: unknown = JSON.parse(raw.toString("utf8"));
        if (
          !record(value) ||
          ![1, 2].includes(value.version as number) ||
          value.reportId !== id ||
          value.reportVersion !== source.reportVersion ||
          value.snapshotDigest !== source.snapshotDigest ||
          !integer(value.byteLength) ||
          value.byteLength > MAX_REPORT_BYTES
        )
          throw new Error("Native buffer catalog manifest is corrupt");
        let catalogReadBytes = 0;
        if (value.version === 2 && value.catalogBody !== undefined) {
          try {
            if (typeof value.catalogDigest !== "string" || !hex.test(value.catalogDigest))
              throw new Error("Native buffer catalog digest is corrupt");
            const decoded = await templates.read(value.catalogBody, MAX_CATALOG_BYTES);
            catalogReadBytes = decoded.bytes;
            if (sha(decoded.raw) !== value.catalogDigest)
              throw new Error("Native buffer catalog digest changed");
            value.catalog = JSON.parse(decoded.raw.toString("utf8"));
          } catch {
            // Charge the complete optional-index read bound on failure, then keep
            // valid exact raw history discoverable through its independent body.
            catalogReadBytes = NATIVE_BUFFER_TEMPLATE_DESCRIPTOR_BYTES + MAX_CATALOG_BYTES;
            delete value.catalog;
          }
        }
        if (value.catalog !== undefined) {
          try {
            if (
              typeof value.device !== "string" ||
              !hex.test(value.device) ||
              !Array.isArray(value.catalog) ||
              value.catalog.length > 20_000 ||
              value.catalogDigest !== digest(value.catalog)
            )
              throw new Error("Native buffer catalog metadata is corrupt");
            if (value.device !== device)
              return { records: [], bytes: raw.length + catalogReadBytes };
            const records = value.catalog.map((item): NativeBufferRecoveryMetadata => {
              if (!record(item)) throw new Error("Native buffer catalog row is corrupt");
              const reference = sourceReference(item.source);
              identity(item.clientId, "catalog client identity");
              identity(item.instanceId, "catalog instance identity");
              if (
                reference.reportId !== id ||
                reference.reportVersion !== source.reportVersion ||
                reference.snapshotDigest !== source.snapshotDigest ||
                reportKey({ device, clientId: item.clientId, instanceId: item.instanceId }) !==
                  id ||
                !integer(item.processId) ||
                item.processId === 0 ||
                !integer(item.updatedAt) ||
                !integer(item.byteLength) ||
                item.byteLength !== value.byteLength ||
                !integer(item.bufferCount) ||
                !integer(item.dirtyCount) ||
                item.dirtyCount > item.bufferCount ||
                typeof item.unknown !== "boolean" ||
                typeof item.ownerMissing !== "boolean" ||
                typeof item.compatibilityHoldId !== "string" ||
                !hex.test(item.compatibilityHoldId) ||
                !["physical", "legacy"].includes(item.lineage as string) ||
                !["held", "historical"].includes(item.retention as string) ||
                typeof item.inspectable !== "boolean" ||
                item.inspectable !== value.byteLength <= MAX_DISCLOSURE_BYTES ||
                item.verification !== "raw-checked" ||
                item.qualified !== false ||
                item.resolution !== "unsupported"
              )
                throw new Error("Native buffer catalog row is corrupt");
              const provenanceValue = item.provenance === null ? null : provenance(item.provenance);
              return {
                source: reference,
                clientId: item.clientId,
                instanceId: item.instanceId,
                processId: item.processId,
                updatedAt: item.updatedAt,
                byteLength: item.byteLength,
                bufferCount: item.bufferCount,
                dirtyCount: item.dirtyCount,
                unknown: item.unknown,
                provenance: provenanceValue,
                lineage: item.lineage as NativeBufferRecoveryMetadata["lineage"],
                ownerMissing: item.ownerMissing,
                retention: item.retention as NativeBufferRecoveryMetadata["retention"],
                compatibilityHoldId: item.compatibilityHoldId,
                verification: "metadata-only",
                inspectable: item.inspectable,
                qualified: false,
                resolution: "unsupported",
              };
            });
            return { records, bytes: raw.length + catalogReadBytes };
          } catch {
            /* A corrupt optional index cannot hide valid immutable body chunks. */
          }
        }
        // Old manifests have no metadata index. One bounded body may be inspected
        // lazily in this page; ordinary indexed history never loads body chunks.
        const captured = await readArchive(source, raw);
        if (!captured || captured.value.device !== device)
          return {
            records: [],
            bytes: catalogReadBytes + (captured?.archiveReadBytes ?? raw.length),
          };
        const owners = ownersOf(captured).filter(
          (item) => !captured.value.recovery?.heldOwnerIds.includes(item.ownerId),
        );
        return {
          length: owners.length,
          at: (index) => metadata(captured, owners[index], "historical"),
          bytes: catalogReadBytes + (captured.archiveReadBytes ?? raw.length + captured.raw.length),
        };
      }),
    finalize: async (row) => {
      if (row.retention === "current") return row;
      if (persistence) {
        if (
          await persistence.hasEntry("native-activity/buffers", `${row.compatibilityHoldId}.json`)
        )
          return { ...row, retention: "held" as const };
        if (await persistence.readClock(row.source.reportId)) return row;
      }
      try {
        await lstat(snapshotPath(row.compatibilityHoldId));
        return { ...row, retention: "held" as const };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return row;
      }
    },
  });
  function listRecovery(
    input: { after?: NativeBufferRecoveryCursor | null; limit?: number } = {},
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const request = structuredClone(input),
      owner = captureOwner(authorization);
    return deps.serial(async () => {
      const device = await authenticate(owner);
      const value = await catalog.page(request, device);
      await authenticate(owner, device);
      return value;
    });
  }
  async function exact(source: NativeBufferRecoverySource, device: string) {
    let live: Captured | null = null;
    try {
      live = await current(source.reportId);
    } catch {
      /* Strict probe still holds corrupt current data. */
    }
    const candidate =
      live?.snapshotDigest === source.snapshotDigest &&
      reportVersion(live.value) === source.reportVersion
        ? live
        : await readArchive(source);
    const item = candidate
      ? ownersOf(candidate).find((entry) => entry.ownerId === source.ownerId)
      : undefined;
    if (
      !candidate ||
      candidate.value.device !== device ||
      !item ||
      ownerVersion(candidate.value, item.ownerId) !== source.ownerVersion
    )
      return null;
    return { captured: candidate, item };
  }
  function readRecovery(
    input: NativeBufferRecoverySource,
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const source = sourceReference(structuredClone(input)),
      owner = captureOwner(authorization);
    return deps.serial(async () => {
      const device = await authenticate(owner),
        found = await exact(source, device);
      if (!found) throw new Error("Native buffer recovery source is unavailable or changed");
      if (found.captured.raw.length > MAX_DISCLOSURE_BYTES)
        throw new Error("Native buffer recovery source exceeds disclosure limit and remains held");
      await authenticate(owner, device);
      return {
        version: 1 as const,
        qualified: false as const,
        source,
        rawReport: found.captured.raw.toString("utf8"),
        owner: structuredClone(found.item),
        resolution: "unsupported" as const,
      };
    });
  }
  function recoveryStatus(
    input: NativeBufferRecoverySource,
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const source = sourceReference(structuredClone(input)),
      owner = captureOwner(authorization);
    return deps.serial(async () => {
      const device = await authenticate(owner),
        found = await exact(source, device);
      await authenticate(owner, device);
      return {
        version: 1 as const,
        qualified: false as const,
        source,
        found: !!found,
        inspectable: !!found && found.captured.raw.length <= MAX_DISCLOSURE_BYTES,
        resolution: "unsupported" as const,
      };
    });
  }
  function verifyDelivery(
    input: { binding: NativeBufferDeliveryBinding; proof: NativeBufferDeliveryProof },
    authorization: WorkspaceOwnerAuthorization,
  ) {
    const request = structuredClone(input),
      owner = captureOwner(authorization);
    return deps.serial(async () => {
      const device = await authenticate(owner),
        { proof, binding } = request;
      if (
        !hex.test(proof.reportId) ||
        !hex.test(proof.snapshotDigest) ||
        !integer(proof.reportVersion) ||
        proof.reportVersion < 1 ||
        !integer(proof.byteLength) ||
        proof.byteLength > MAX_REPORT_BYTES
      )
        throw new Error("Native buffer delivery proof is corrupt and remains held");
      const floor = persistence ? await persistence.readClock(proof.reportId) : undefined;
      if (persistence && !floor) {
        await authenticate(owner, device);
        return false;
      }
      const find = async () => {
        let captured = await current(proof.reportId);
        if (
          !captured ||
          captured.snapshotDigest !== proof.snapshotDigest ||
          reportVersion(captured.value) !== proof.reportVersion
        )
          captured = await readArchive({ ...proof, ownerId: "delivery-proof", ownerVersion: 0 });
        return captured;
      };
      const captured = retention ? await retention.sqlOnly(find) : await find();
      const tag = captured?.value.originalDelivery;
      const matches =
        !!captured &&
        captured.value.device === device &&
        captured.raw.length === proof.byteLength &&
        captured.snapshotDigest === proof.snapshotDigest &&
        reportVersion(captured.value) === proof.reportVersion &&
        (!persistence ||
          (!!floor &&
            captured.value.recovery?.clockId === floor.clockId &&
            floor.highWater >= proof.reportVersion)) &&
        !!tag &&
        tag.originalId === binding.originalId &&
        tag.sha256 === binding.sha256 &&
        tag.byteLength === binding.byteLength &&
        tag.principalId === binding.principalId &&
        tag.environmentId === binding.environmentId;
      await authenticate(owner, device);
      return matches;
    });
  }
  return {
    initializeRetention,
    probe,
    updateBuffers,
    heartbeatBuffers: beats.heartbeat,
    verifyDelivery,
    retireBuffers,
    reconcileBuffers,
    listRecovery,
    readRecovery,
    recoveryStatus,
    closeRecoveryCatalog: () => deps.serial(() => catalog.close()),
  };
}
