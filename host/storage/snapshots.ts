import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import type { StoreDatabase } from "../store-db";

export type SnapshotFile = { path: string; bytes: number; sha256: string };
export type HostSnapshotManifest = {
  version: 1;
  snapshotId: string;
  environmentId: string;
  createdAt: number;
  coherence: "host-only";
  authorityReconciliationRequired: true;
  schemaDigest: string;
  files: SnapshotFile[];
};
const MAX_FILES = 10_000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export async function assertProfileNotStaged(profile: string): Promise<void> {
  try {
    await lstat(join(profile, "host-recovery.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Host profile requires staged authority/trust reconciliation before admission.");
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function inside(root: string, path: string): string {
  const result = relative(resolve(root), resolve(path));
  if (!result || isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`))
    throw new Error("Snapshot path escapes its root.");
  return result.split(sep).join("/");
}
async function inspectDatabase(path: string, finalize = false): Promise<unknown> {
  const worker = new Worker(new URL("./snapshot-worker.mjs", import.meta.url), {
    workerData: { path, finalize },
  });
  try {
    return await new Promise((resolveResult, reject) => {
      worker.once("message", (result) =>
        result.error ? reject(new Error(result.error)) : resolveResult(result.schema),
      );
      worker.once("error", () => reject(new Error("Snapshot integrity worker failed.")));
      worker.once("exit", () => reject(new Error("Snapshot integrity worker stopped.")));
    });
  } finally {
    await worker.terminate();
  }
}
async function durableFile(path: string): Promise<void> {
  const file = await open(path, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("Snapshot refuses linked external files.");
      if (info.isDirectory()) await walk(target);
      else if (info.isFile()) {
        result.push(target);
        if (result.length > MAX_FILES) throw new Error("Snapshot file limit exceeded.");
      } else throw new Error("Snapshot refuses special external files.");
    }
  };
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Invalid snapshot attachment root.");
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result;
}

/** Host-local cut only. Cross-native journal/authority reconciliation is mandatory. */
export async function captureHostSnapshot(input: {
  database: StoreDatabase;
  attachmentDir: string;
  destination: string;
  environmentId: string;
  flush: () => Promise<void>;
}): Promise<HostSnapshotManifest> {
  return input.database.scope(async () => {
    input.database.assertWriteAdmission();
    const destination = resolve(input.destination);
    const source = await realpath(dirname(input.attachmentDir));
    const targetParent = await realpath(dirname(destination));
    if (
      destination === source ||
      targetParent === source ||
      targetParent.startsWith(`${source}${sep}`)
    )
      throw new Error("Snapshot destination must be outside the active profile.");
    // Exclusive directory: existing files and active profiles can never be replaced.
    await mkdir(destination, { mode: 0o700 });
    await writeFile(
      join(destination, "host-recovery.json"),
      JSON.stringify({ state: "recovery-required", kind: "snapshot" }),
      { flag: "wx", mode: 0o600 },
    );
    await input.flush();
    const databasePath = join(destination, "host.db");
    await input.database.backupTo(databasePath);
    const schema = await inspectDatabase(databasePath, true);
    const manifest: HostSnapshotManifest = {
      version: 1,
      snapshotId: randomUUID(),
      environmentId: input.environmentId,
      createdAt: Date.now(),
      coherence: "host-only",
      authorityReconciliationRequired: true,
      schemaDigest: createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
      files: [],
    };
    const add = async (path: string) => {
      const info = await lstat(path);
      const bytes = manifest.files.reduce((total, file) => total + file.bytes, 0) + info.size;
      if (bytes > MAX_BYTES || manifest.files.length >= MAX_FILES)
        throw new Error("Snapshot size limit exceeded.");
      await durableFile(path);
      manifest.files.push({
        path: inside(destination, path),
        bytes: info.size,
        sha256: await digest(path),
      });
    };
    await add(databasePath);
    for (const path of await filesBelow(input.attachmentDir)) {
      const size = (await lstat(path)).size;
      if (
        size + manifest.files.reduce((total, file) => total + file.bytes, 0) > MAX_BYTES ||
        manifest.files.length >= MAX_FILES
      )
        throw new Error("Snapshot size limit exceeded.");
      const target = join(destination, "attachments", inside(input.attachmentDir, path));
      const expected = await digest(path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path, target, constants.COPYFILE_EXCL);
      if ((await digest(target)) !== expected)
        throw new Error("Attachment changed during snapshot capture.");
      await add(target);
    }
    await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest), {
      flag: "wx",
      mode: 0o600,
    });
    await durableFile(join(destination, "manifest.json"));
    await durableFile(join(destination, "host-recovery.json"));
    return manifest;
  });
}

/** Validate/copy into a NEW staging directory. Never replace or start an active Host. */
export async function stageHostRestore(
  snapshot: string,
  destination: string,
): Promise<{
  manifest: HostSnapshotManifest;
  restoreEpoch: string;
  state: "recovery-required";
}> {
  const root = await realpath(snapshot);
  const manifestInfo = await lstat(join(root, "manifest.json"));
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    manifestInfo.size > 2 * 1024 * 1024
  )
    throw new Error("Invalid snapshot manifest file.");
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as HostSnapshotManifest;
  if (
    manifest.version !== 1 ||
    manifest.coherence !== "host-only" ||
    manifest.authorityReconciliationRequired !== true ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 1 ||
    manifest.files.length > MAX_FILES ||
    typeof manifest.environmentId !== "string" ||
    typeof manifest.schemaDigest !== "string"
  )
    throw new Error("Unsupported snapshot manifest.");
  const seen = new Set<string>();
  let bytes = 0;
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !/^(host\.db|attachments\/[\s\S]+)$/.test(file.path) ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => part === ".." || part === "." || !part) ||
      file.path.includes(":") ||
      file.path.includes(String.fromCharCode(0)) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      seen.has(file.path)
    )
      throw new Error("Invalid snapshot file entry.");
    seen.add(file.path);
    bytes += file.bytes;
    if (bytes > MAX_BYTES) throw new Error("Snapshot size limit exceeded.");
    const path = join(root, file.path);
    inside(root, await realpath(path));
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size !== file.bytes ||
      (await digest(path)) !== file.sha256
    )
      throw new Error("Snapshot file verification failed.");
  }
  if (!seen.has("host.db")) throw new Error("Snapshot database is missing.");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(join(root, `host.db${suffix}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Snapshot contains an untracked database sidecar.");
  }
  const schema = await inspectDatabase(join(root, "host.db"));
  if (createHash("sha256").update(JSON.stringify(schema)).digest("hex") !== manifest.schemaDigest)
    throw new Error("Snapshot schema verification failed.");
  await mkdir(destination, { mode: 0o700 });
  await writeFile(
    join(destination, "host-recovery.json"),
    JSON.stringify({ state: "recovery-required", kind: "staged-restore" }),
    { flag: "wx", mode: 0o600 },
  );
  await durableFile(join(destination, "host-recovery.json"));
  for (const file of manifest.files) {
    const target = join(destination, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(root, file.path), target, constants.COPYFILE_EXCL);
    if ((await digest(target)) !== file.sha256)
      throw new Error("Snapshot changed during restore staging.");
    await durableFile(target);
  }
  const result = { manifest, restoreEpoch: randomUUID(), state: "recovery-required" as const };
  await inspectDatabase(join(destination, "host.db"));
  await writeFile(join(destination, "restore-state.json"), JSON.stringify(result), {
    flag: "wx",
    mode: 0o600,
  });
  await durableFile(join(destination, "restore-state.json"));
  return result;
}
