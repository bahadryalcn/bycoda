import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NativeDeliveryIdentitySchema } from "../../src/shared/model/host-contracts/native-delivery-identity";
import {
  NATIVE_BUFFER_ARTIFACT_MAX_BYTES as MAX_ARTIFACT,
  NATIVE_BUFFER_BATCH_MAX_BYTES as MAX_BATCH,
  type NativeBufferArtifactReference,
  type NativeBufferClockBacking,
  type NativeBufferClockState,
  type NativeBufferCompletionCertificate,
  type NativeBufferPersistence,
} from "../ports/native-buffer-persistence";
import { createGitObjectStore, gitBlobOid, type GitTreeChange } from "./git-object-store";
import { unreferencedSharedKeys } from "./native-buffer-git-prune";

/** Per reportId, the newest history versions kept in the tree; older ones become unreachable. */
export const NATIVE_BUFFER_HISTORY_VERSIONS = 20;
export type NativeBufferGitPersistenceOptions = {
  /** Bare repository path, created on first use (`git init --bare`). */
  gitDir: string;
  /** Clock backing stays in SQL. */
  clocks: NativeBufferClockBacking;
  /** git executable; default "git" resolved on PATH. */
  git?: string;
  /** Per-command deadline in ms; default 30_000. */
  commandTimeoutMs?: number;
};
export type NativeBufferGitPersistence = NativeBufferPersistence & {
  /** Runs `git gc --prune=now --quiet` (bounded); safe to call hourly. Returns bytes before/after if cheap. */
  gc(): Promise<{ beforeBytes?: number; afterBytes?: number }>;
  /** True when the repository exists and `git` answered; used to decide the wiring fallback. */
  available(): Promise<boolean>;
  close(): void;
};

const REF = "refs/bycoda/native-buffer";
const SEQUENCE = /^Native-Buffer-Sequence: ([0-9]{1,16})$/m;
const CURSOR = /^directory-rowid:([1-9][0-9]{0,15})$/;
const CERTIFICATE_METADATA_MAX = 32 * 1024 * 1024;
// History keys that carry a version, written by native-buffer-reports.ts (manifestPath/rawArchivePath).
const VERSIONED =
  /^native-activity\/buffer-history\/(?:reports|raw)\/([a-f0-9]{64})\/(\d{16})-[a-f0-9]{64}\.(?:json|bin)$/;
const CERTIFICATE = /^certificates\/([a-f0-9]{64})\/(\d{16})-[a-f0-9]{64}\.json$/;
const CURRENT = /^native-activity\/buffers\/[a-f0-9]{64}\.json$/;
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const pad = (version: number) => version.toString().padStart(16, "0");
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const failure = () =>
  new Error("Native buffer git retention is missing, conflicting or corrupt; sources remain held");
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.filter((key) => key !== "originalDelivery").every((key) => Object.hasOwn(value, key));
const certificateKey = (ref: { reportId: string; reportVersion: number; snapshotDigest: string }) =>
  `certificates/${ref.reportId}/${pad(ref.reportVersion)}-${ref.snapshotDigest}.json`;
const ancestors = (key: string) => {
  const parts = key.split("/");
  return parts.slice(1, -1).map((_, index) => parts.slice(0, index + 2).join("/"));
};

// Validation mirrors native-buffer-persistence-store.ts so both backends admit the same batches.
function artifactKey(key: unknown, directory = false): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length > 1024 ||
    !/^[A-Za-z0-9._/-]+$/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..") ||
    key.split("/").length > 16 ||
    !(
      key.startsWith("native-activity/buffers/") ||
      key.startsWith("native-activity/buffer-history/") ||
      (directory && (key === "native-activity/buffers" || key === "native-activity/buffer-history"))
    ) ||
    key === "native-activity/buffer-history/clocks" ||
    key.startsWith("native-activity/buffer-history/clocks/")
  )
    throw failure();
}
function bound(value: unknown, maximum: number): asserts value is number {
  if (!integer(value) || value > maximum) throw failure();
}
function clockState(state: NativeBufferClockState): NativeBufferClockState {
  if (
    !state ||
    !exactKeys(state, ["version", "reportId", "clockId", "base", "highWater", "digest"]) ||
    state.version !== 1 ||
    !hex.test(state.reportId) ||
    !uuid.test(state.clockId) ||
    !integer(state.base) ||
    !integer(state.highWater) ||
    state.highWater < state.base ||
    !hex.test(state.digest)
  )
    throw failure();
  const { version, reportId, clockId, base, highWater, digest } = state;
  return { version, reportId, clockId, base, highWater, digest };
}
const sameClock = (a: NativeBufferClockState, b: NativeBufferClockState) =>
  JSON.stringify(clockState(a)) === JSON.stringify(clockState(b));
function artifactReference(ref: NativeBufferArtifactReference) {
  if (!ref || !exactKeys(ref, ["key", "sha256", "byteLength"])) throw failure();
  artifactKey(ref.key);
  bound(ref.byteLength, MAX_ARTIFACT);
  if (!hex.test(ref.sha256)) throw failure();
  return { key: ref.key, sha256: ref.sha256, byteLength: ref.byteLength };
}
type Metadata = ReturnType<typeof certificateMetadata>;
function certificateMetadata(value: Omit<NativeBufferCompletionCertificate, "raw">) {
  if (
    !value ||
    !exactKeys(value, [
      "reportId",
      "reportVersion",
      "snapshotDigest",
      "byteLength",
      "clockId",
      "artifacts",
      "originalDelivery",
    ]) ||
    !hex.test(value.reportId) ||
    !hex.test(value.snapshotDigest) ||
    !integer(value.reportVersion) ||
    value.reportVersion < 1 ||
    !uuid.test(value.clockId) ||
    !integer(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > MAX_ARTIFACT ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 100_000
  )
    throw failure();
  const artifacts = Array.from(value.artifacts, artifactReference).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  if (artifacts.some((ref, index) => index > 0 && artifacts[index - 1].key === ref.key))
    throw failure();
  const referenced = new Map<string, number>([[value.snapshotDigest, value.byteLength]]);
  let referencedBytes = value.byteLength;
  for (const ref of artifacts) {
    const previous = referenced.get(ref.sha256);
    if (previous !== undefined && previous !== ref.byteLength) throw failure();
    if (previous === undefined) {
      referenced.set(ref.sha256, ref.byteLength);
      referencedBytes += ref.byteLength;
    }
    if (referencedBytes > MAX_BATCH) throw failure();
  }
  let originalDelivery;
  if (value.originalDelivery !== undefined) {
    const binding = value.originalDelivery;
    if (
      !binding ||
      !exactKeys(binding, ["originalId", "sha256", "byteLength", "principalId", "environmentId"]) ||
      !hex.test(binding.principalId) ||
      typeof binding.environmentId !== "string" ||
      !/^[A-Za-z0-9._:@/-]{1,200}$/.test(binding.environmentId)
    )
      throw failure();
    originalDelivery = {
      ...NativeDeliveryIdentitySchema.parse({
        originalId: binding.originalId,
        sha256: binding.sha256,
        byteLength: binding.byteLength,
      }),
      principalId: binding.principalId,
      environmentId: binding.environmentId,
    };
  }
  return {
    reportId: value.reportId,
    reportVersion: value.reportVersion,
    snapshotDigest: value.snapshotDigest,
    byteLength: value.byteLength,
    clockId: value.clockId,
    ...(originalDelivery ? { originalDelivery } : {}),
    artifacts,
  };
}
const clockAdmits = (state: NativeBufferClockState | null, meta: Metadata) =>
  !!state &&
  state.clockId === meta.clockId &&
  meta.reportVersion >= state.base &&
  meta.reportVersion <= state.highWater;

type Write = { key: string; bytes: Buffer; sha256: string; oid: string; immutable: boolean };
type Certificate = { meta: Metadata; key: string; bytes: Buffer; oid: string };

/** Content-addressed storage in a bycoda-owned bare repository: one parentless snapshot commit
 * per completion, moved by CAS. Clocks stay in SQL. Internal storage, never a grant. */
export function createNativeBufferGitPersistence(
  options: NativeBufferGitPersistenceOptions,
): NativeBufferGitPersistence {
  const { gitDir, clocks } = options,
    timeoutMs = options.commandTimeoutMs ?? 30_000;
  const git = createGitObjectStore({ git: options.git ?? "git", gitDir, timeoutMs });
  // shortcut: views handed out by this process only; a view whose commit was pruned by gc fails closed.
  const views = new Map<number, string>();
  let listing: { id: string; entries: { name: string; isDirectory: boolean }[] } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let ready: Promise<void> | null = null;
  let closed = false;

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  const open = () => {
    if (closed) throw new Error("Native buffer git persistence is closed");
  };
  async function exists() {
    try {
      return (await stat(join(gitDir, "HEAD"))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  function ensure() {
    ready ??= (async () => {
      if (!(await exists())) {
        await mkdir(dirname(gitDir), { recursive: true });
        await git.exec(["init", "--bare", "--quiet", "--object-format=sha1"]);
        // No reflog (it would keep superseded snapshots reachable) and no automatic gc.
        await git.exec(["config", "core.logAllRefUpdates", "false"]);
        await git.exec(["config", "gc.auto", "0"]);
      }
      if ((await git.text(["rev-parse", "--is-bare-repository"])) !== "true") throw failure();
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  }
  async function head() {
    open();
    if (!(await exists())) return null;
    const value = await git.readHead(REF);
    if (!value) return null;
    const match = SEQUENCE.exec(value.message),
      sequence = Number(match?.[1]);
    if (!match || !integer(sequence) || sequence < 1) throw failure();
    remember(sequence, value.tree);
    return { ...value, sequence };
  }
  function remember(sequence: number, tree: string) {
    views.delete(sequence);
    views.set(sequence, tree);
    while (views.size > 64) views.delete(views.keys().next().value!);
  }
  async function treeAt(view?: number): Promise<string | null> {
    if (view !== undefined) bound(view, Number.MAX_SAFE_INTEGER);
    const current = await head();
    if (!current || view === 0) return null;
    if (view === undefined || view === current.sequence) return current.tree;
    if (view > current.sequence) throw failure();
    const tree = views.get(view);
    if (!tree || !(await git.batchCheck([tree]))[0]) throw failure();
    return tree;
  }

  function admit(batch: Parameters<NativeBufferPersistence["complete"]>[0]) {
    if (
      !batch ||
      !Array.isArray(batch.writes) ||
      !Array.isArray(batch.certificates) ||
      batch.writes.length > 100_000 ||
      batch.certificates.length > 4096 ||
      typeof batch.authorize !== "function"
    )
      throw failure();
    const sizes = new Map<string, number>(),
      writes = new Map<string, Write>();
    let bytes = 0;
    const account = (hash: string, length: number) => {
      const previous = sizes.get(hash);
      if (previous !== undefined && previous !== length) throw failure();
      if (previous === undefined) {
        sizes.set(hash, length);
        bytes += length;
        if (bytes > MAX_BATCH) throw failure();
      }
    };
    for (const write of batch.writes) {
      if (
        !write ||
        !exactKeys(write, ["key", "bytes", "immutable"]) ||
        typeof write.immutable !== "boolean" ||
        !Buffer.isBuffer(write.bytes) ||
        write.bytes.length > MAX_ARTIFACT
      )
        throw failure();
      artifactKey(write.key);
      const current = CURRENT.test(write.key);
      if (
        (!write.immutable && !current) ||
        (write.key.startsWith("native-activity/buffers/") && !current)
      )
        throw failure();
      const hash = sha(write.bytes);
      account(hash, write.bytes.length);
      const existing = writes.get(write.key);
      if (existing && (existing.sha256 !== hash || existing.immutable !== write.immutable))
        throw failure();
      writes.set(write.key, {
        key: write.key,
        bytes: write.bytes,
        sha256: hash,
        oid: "",
        immutable: write.immutable,
      });
    }
    if (
      batch.initializeClocks !== undefined &&
      (!Array.isArray(batch.initializeClocks) || batch.initializeClocks.length > 4096)
    )
      throw failure();
    const initial = (batch.initializeClocks ?? []).map(clockState);
    let references = 0;
    const certificates = new Map<string, Certificate>();
    for (const certificate of batch.certificates) {
      if (
        !certificate ||
        !exactKeys(certificate, [
          "reportId",
          "reportVersion",
          "snapshotDigest",
          "byteLength",
          "clockId",
          "raw",
          "artifacts",
          "originalDelivery",
        ])
      )
        throw failure();
      const { raw, ...rest } = certificate,
        meta = certificateMetadata(rest);
      if (!Buffer.isBuffer(raw) || raw.length > MAX_ARTIFACT) throw failure();
      const hash = sha(raw);
      account(hash, raw.length);
      for (const artifact of meta.artifacts) account(artifact.sha256, artifact.byteLength);
      references += meta.artifacts.length;
      if (
        references > 100_000 ||
        Buffer.byteLength(JSON.stringify(meta)) > CERTIFICATE_METADATA_MAX
      )
        throw failure();
      if (raw.length !== meta.byteLength || hash !== meta.snapshotDigest) throw failure();
      const key = certificateKey(meta),
        body = Buffer.from(JSON.stringify({ ...meta, raw: raw.toString("base64") }));
      const previous = certificates.get(key);
      if (previous && !previous.bytes.equals(body)) throw failure();
      certificates.set(key, { meta, key, bytes: body, oid: gitBlobOid(body) });
    }
    // Freeze borrowed buffers only after all individual and distinct batch sizes are checked.
    for (const write of writes.values()) {
      write.bytes = Buffer.from(write.bytes);
      if (sha(write.bytes) !== write.sha256) throw failure();
      write.oid = gitBlobOid(write.bytes);
    }
    for (const key of writes.keys())
      if (ancestors(key).some((parent) => writes.has(parent))) throw failure();
    return { writes, certificates: [...certificates.values()], initial };
  }

  /** Versions beyond the newest NATIVE_BUFFER_HISTORY_VERSIONS per report, as keys to drop. */
  async function pruned(base: string | null, added: string[], touched: Set<string>) {
    const keys = new Set(added);
    if (base && touched.size)
      for (const key of await git.listFiles(
        base,
        [...touched].flatMap((id) => [
          `native-activity/buffer-history/reports/${id}/`,
          `native-activity/buffer-history/raw/${id}/`,
          `certificates/${id}/`,
        ]),
      ))
        keys.add(key);
    const versions = new Map<string, Map<number, string[]>>();
    for (const key of keys) {
      const match = VERSIONED.exec(key) ?? CERTIFICATE.exec(key);
      if (!match || !touched.has(match[1])) continue;
      const byVersion = versions.get(match[1]) ?? new Map<number, string[]>(),
        version = Number(match[2]);
      byVersion.set(version, [...(byVersion.get(version) ?? []), key]);
      versions.set(match[1], byVersion);
    }
    const drop = new Set<string>();
    for (const byVersion of versions.values())
      [...byVersion.keys()]
        .sort((a, b) => b - a)
        .slice(NATIVE_BUFFER_HISTORY_VERSIONS)
        .forEach((version) => byVersion.get(version)!.forEach((key) => drop.add(key)));
    return drop;
  }

  async function verifyArtifacts(
    base: string | null,
    certificates: Certificate[],
    writes: Map<string, Write>,
  ) {
    const pending = new Map<string, NativeBufferArtifactReference>();
    let bytes = 0;
    for (const { meta } of certificates)
      for (const ref of meta.artifacts) {
        const write = writes.get(ref.key);
        if (write) {
          if (write.sha256 !== ref.sha256 || write.bytes.length !== ref.byteLength) throw failure();
        } else if (!pending.has(ref.key)) {
          pending.set(ref.key, ref);
          bytes += ref.byteLength;
        }
      }
    if (!pending.size) return;
    if (!base || bytes > MAX_BATCH) throw failure();
    const refs = [...pending.values()],
      bodies = await git.catBatch(
        refs.map((ref) => `${base}:${ref.key}`),
        bytes,
      );
    refs.forEach((ref, index) => {
      const body = bodies[index];
      if (!body || body.length !== ref.byteLength || sha(body) !== ref.sha256) throw failure();
    });
    for (const { meta } of certificates)
      for (const ref of meta.artifacts) {
        const expected = pending.get(ref.key);
        if (expected && expected.sha256 !== ref.sha256) throw failure();
      }
  }

  /** One attempt: true when the ref moved (or nothing changed), false on a lost CAS. */
  async function attempt(
    admitted: ReturnType<typeof admit>,
    authorize: () => Promise<void>,
  ): Promise<boolean> {
    const { writes, certificates } = admitted;
    const current = await head(),
      base = current?.tree ?? null;
    await authorize();
    const files = new Map<string, string>([
      ...[...writes.values()].map((write) => [write.key, write.oid] as [string, string]),
      ...certificates.map((certificate) => [certificate.key, certificate.oid] as [string, string]),
    ]);
    const probes = [...new Set([...files.keys()].flatMap((key) => [...ancestors(key), key]))];
    const found = base ? await git.batchCheck(probes.map((path) => `${base}:${path}`)) : [];
    const existing = new Map(probes.map((path, index) => [path, found[index] ?? null]));
    for (const [key, oid] of files) {
      const before = existing.get(key);
      if (ancestors(key).some((parent) => existing.get(parent)?.type === "blob")) throw failure();
      if (before && before.type !== "blob") throw failure();
      // History keys and certificates are immutable once written; only current heads move.
      if (before && before.oid !== oid && !CURRENT.test(key)) throw failure();
    }
    await verifyArtifacts(base, certificates, writes);
    const touched = new Set<string>();
    for (const key of files.keys()) {
      const match = VERSIONED.exec(key) ?? CERTIFICATE.exec(key);
      if (match) touched.add(match[1]);
    }
    const drop = await pruned(base, [...files.keys()], touched);
    // Shared chunks/templates are swept only in a commit that dropped at least one version.
    if (drop.size)
      for (const key of await unreferencedSharedKeys(
        git,
        base,
        new Map([...writes.values()].map((write) => [write.key, write.bytes])),
        drop,
      ))
        drop.add(key);
    const changes: GitTreeChange[] = [];
    const blobs = new Map<string, Buffer>();
    let added = 0;
    for (const [key, oid] of files) {
      if (drop.has(key) || existing.get(key)?.oid === oid) continue;
      if (!existing.get(key)) added++;
      changes.push({ path: key, oid });
      blobs.set(oid, writes.get(key)?.bytes ?? certificates.find((c) => c.key === key)!.bytes);
    }
    for (const key of drop) if (existing.get(key) !== null) changes.push({ path: key, oid: null });
    if (!changes.length) return true;
    const present = await git.batchCheck([...blobs.keys()]);
    await git.writeBlobs([...blobs.values()].filter((_, index) => !present[index]));
    const tree = await git.buildTree(base, changes),
      sequence = (current?.sequence ?? 0) + Math.max(1, added);
    if (!integer(sequence)) throw failure();
    const commit = await git.commitTree(tree, [
      `native-buffer view ${sequence}`,
      `Native-Buffer-Sequence: ${sequence}`,
    ]);
    await authorize();
    if (!(await git.updateRef(REF, commit, current?.commit ?? null))) return false;
    remember(sequence, tree);
    return true;
  }

  return {
    readClock: (reportId) => clocks.readClock(reportId),
    initializeClock: (state, authorize) => clocks.initializeClock(state, authorize),
    advanceClock: (expected, next, authorize) => clocks.advanceClock(expected, next, authorize),
    async read(key, limit) {
      artifactKey(key);
      bound(limit, MAX_ARTIFACT);
      const current = await head();
      if (!current) return null;
      try {
        return await git.readBlob(`${current.commit}:${key}`, limit);
      } catch {
        throw failure();
      }
    },
    async directoryView() {
      return (await head())?.sequence ?? 0;
    },
    async entries(directory, after, limit, view) {
      artifactKey(directory, true);
      bound(limit, 1024);
      if (limit < 1) throw failure();
      let start = 0;
      if (after !== null) {
        const match = typeof after === "string" ? CURSOR.exec(after) : null;
        start = Number(match?.[1]);
        if (!match || !integer(start) || after !== `directory-rowid:${start}`) throw failure();
      }
      const tree = await treeAt(view);
      if (!tree) {
        if (start) throw failure();
        return { entries: [], nextAfter: null };
      }
      // Tree order is stable for an unchanged view; the cursor is a 1-based position in it.
      const id = `${tree}:${directory}`;
      if (listing?.id !== id) listing = { id, entries: await git.listDirectory(tree, directory) };
      const all = listing.entries;
      if (start > all.length) throw failure();
      const entries = all.slice(start, start + limit);
      return {
        entries,
        nextAfter: start + limit < all.length ? `directory-rowid:${start + limit}` : null,
      };
    },
    async hasEntry(directory, name, view) {
      artifactKey(directory, true);
      if (
        typeof name !== "string" ||
        !/^[A-Za-z0-9._-]{1,1024}$/.test(name) ||
        name === "." ||
        name === ".."
      )
        throw failure();
      const key = directory + "/" + name;
      artifactKey(key, true);
      const tree = await treeAt(view);
      if (!tree) return false;
      return !!(await git.batchCheck([`${tree}:${key}`]))[0];
    },
    async complete(batch) {
      open();
      const admitted = admit(batch);
      return serial(async () => {
        await batch.authorize();
        await ensure();
        // Clock admission happens before any object is written; new clocks are adopted after the ref move.
        for (const state of admitted.initial) {
          const known = await clocks.readClock(state.reportId);
          if (known && !sameClock(known, state)) throw failure();
        }
        for (const { meta } of admitted.certificates) {
          const state =
            (await clocks.readClock(meta.reportId)) ??
            admitted.initial.find((clock) => clock.reportId === meta.reportId) ??
            null;
          if (!clockAdmits(state, meta)) throw failure();
        }
        if (!(await attempt(admitted, batch.authorize))) {
          listing = null;
          if (!(await attempt(admitted, batch.authorize)))
            throw new Error("Native buffer git snapshot ref moved concurrently twice; retry later");
        }
        for (const state of admitted.initial) await clocks.initializeClock(state, batch.authorize);
        await batch.authorize();
      });
    },
    async readCertificate(ref, limit) {
      if (
        !ref ||
        !exactKeys(ref, ["reportId", "reportVersion", "snapshotDigest"]) ||
        !hex.test(ref.reportId) ||
        !hex.test(ref.snapshotDigest) ||
        !integer(ref.reportVersion) ||
        ref.reportVersion < 1
      )
        throw failure();
      bound(limit, MAX_ARTIFACT);
      const current = await head();
      if (!current) return null;
      let body: Buffer | null;
      try {
        body = await git.readBlob(
          `${current.commit}:${certificateKey(ref)}`,
          CERTIFICATE_METADATA_MAX + Math.ceil(limit / 3) * 4 + 64,
        );
      } catch {
        throw failure();
      }
      if (!body) return null;
      let meta: Metadata, raw: Buffer;
      try {
        const { raw: encoded, ...rest } = JSON.parse(body.toString("utf8")) as Omit<
          NativeBufferCompletionCertificate,
          "raw"
        > & { raw: unknown };
        if (typeof encoded !== "string") throw failure();
        meta = certificateMetadata(rest);
        raw = Buffer.from(encoded, "base64");
      } catch {
        throw failure();
      }
      if (
        meta.reportId !== ref.reportId ||
        meta.reportVersion !== ref.reportVersion ||
        meta.snapshotDigest !== ref.snapshotDigest
      )
        throw failure();
      bound(meta.byteLength, limit);
      if (raw.length !== meta.byteLength || sha(raw) !== meta.snapshotDigest) throw failure();
      if (!clockAdmits(await clocks.readClock(ref.reportId), meta)) throw failure();
      return { ...meta, raw };
    },
    gc() {
      open();
      // Serialized with complete(): loose blobs written before the ref move must not be pruned.
      return serial(async () => {
        if (!(await exists())) return {};
        const size = async () => {
          const raw = await git.text(["count-objects", "-v"]);
          const kib = (name: string) => Number(new RegExp(`^${name}: (\\d+)$`, "m").exec(raw)?.[1]);
          const total = (kib("size") + kib("size-pack") + kib("size-garbage")) * 1024;
          return Number.isSafeInteger(total) ? total : undefined;
        };
        const beforeBytes = await size().catch(() => undefined);
        await git.exec(
          [
            "-c",
            "gc.reflogExpire=now",
            "-c",
            "gc.reflogExpireUnreachable=now",
            "gc",
            "--prune=now",
            "--quiet",
          ],
          { timeoutMs: timeoutMs * 4 },
        );
        listing = null;
        const afterBytes = await size().catch(() => undefined);
        return { beforeBytes, afterBytes };
      });
    },
    async available() {
      if (closed) return false;
      try {
        await git.exec(["--version"]);
        await ensure();
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      views.clear();
      listing = null;
    },
  };
}
