import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rm, rmdir, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { renameWithRetry } from "../storage/rename-retry";
import { invalidateHostFilePaths } from "./workspace";
import {
  fileChangedError,
  fileVersion,
  serializeTextSave,
  statSaveTarget,
} from "./workspace-text-save";

/**
 * Chunked save of a text file too large for one remote message. The client stages the bytes in a
 * temporary file next to the target (`write_file_begin` / `write_file_chunk`), then
 * `write_file_commit` swaps it in under the same per-path queue, version check and identity check
 * as `write_text_file`. Nothing touches the target until commit, so an interrupted upload leaves
 * the original intact; abandoned temporaries expire and are swept on the next Host start.
 *
 * Temporaries live in a Host-created staging folder beside the target (same filesystem, so the
 * final rename is atomic). The Host keeps the file open and, before the rename, checks that the
 * staged entry is still the very file it wrote (device/inode of the held handle against the
 * path, not a link) and has exactly the announced size. Cleanup removes a path only while it
 * still is the recorded file.
 */

/** Largest text a manual edit may load or save, matching the local editor. */
export const MAX_EDIT_TEXT_BYTES = 8 * 1024 * 1024;
/** One chunk's decoded bytes; base64 of this stays well inside the 1 MiB message cap. */
export const MAX_UPLOAD_CHUNK_BYTES = 512 * 1024;
const MAX_UPLOADS = 4;
const MAX_STAGED_BYTES = 4 * MAX_EDIT_TEXT_BYTES;
export const UPLOAD_TTL_MS = 10 * 60_000;
const COMPLETED_TTL_MS = 5 * 60_000;
const MAX_COMPLETED = 16;
const TEMPORARY_NAME = /^\.bycoda-upload-[0-9a-f-]{36}$/;
const STAGING_NAME = ".bycoda-uploads";
const JOURNAL_NAME = "workspace-text-uploads.json";

/** The file a temporary was created as; device and inode as decimal strings. */
type Identity = { dev: string; ino: string };
type JournalEntry = Identity & { path: string; size: number };

type Upload = {
  id: string;
  owner: string;
  root: string;
  path: string;
  temporary: string;
  baseVersion?: string;
  size: number;
  received: number;
  mode?: number;
  handle: FileHandle;
  identity: Identity;
  /** The last accepted chunk, so a retry of exactly that chunk is acknowledged, not appended. */
  last?: { offset: number; length: number; digest: string };
  tail: Promise<unknown>;
  timer: NodeJS.Timeout;
  stateDir: string;
};

const uploads = new Map<string, Upload>();
const completed = new Map<string, { owner: string; version: string; at: number }>();
const swept = new Map<string, Promise<void>>();
const journals = new Map<string, Promise<void>>();
/** Slots and bytes claimed by begins still opening their temporary, so parallel begins add up. */
const reserved = { count: 0, bytes: 0 };

function identityOf(info: { dev: bigint; ino: bigint }): Identity {
  return { dev: String(info.dev), ino: String(info.ino) };
}

function sameIdentity(info: { dev: bigint; ino: bigint }, identity: Identity): boolean {
  return String(info.dev) === identity.dev && String(info.ino) === identity.ino;
}

async function lstatOrUndefined(path: string) {
  return await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
}

/** Writes all of `bytes` at `position`; a short write continues, a stalled one fails. */
async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let done = 0;
  while (done < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    if (bytesWritten < 1) throw new Error("The file could not be written completely.");
    done += bytesWritten;
  }
}

/** Creates the Host's staging folder next to the target; a link or file of that name is refused. */
async function ensureStagingDirectory(path: string): Promise<string> {
  const staging = join(dirname(path), STAGING_NAME);
  await mkdir(staging, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  // lstat does not follow links, so a symlinked or plain-file staging name is not a directory.
  if (!(await lstat(staging)).isDirectory()) throw new Error("Cannot stage the upload here.");
  return staging;
}

/** Removes the staging folder once nothing is staged in it; a non-empty one stays. */
async function removeStagingIfEmpty(staging: string): Promise<void> {
  await rmdir(staging).catch(() => {});
}

/** Removes `path` only while it is still the file recorded in `identity` and not a link. */
async function removeIfSame(path: string, identity: Identity, maxSize?: number): Promise<void> {
  const info = await lstatOrUndefined(path).catch(() => undefined);
  if (!info || !info.isFile() || !sameIdentity(info, identity)) return;
  if (maxSize !== undefined && info.size > BigInt(maxSize)) return;
  await rm(path, { force: true }).catch(() => {});
}

function journalPath(stateDir: string): string {
  return join(stateDir, JOURNAL_NAME);
}

/** Journal writes run one at a time per state folder, each from the live set of temporaries. */
function writeJournal(stateDir: string): Promise<void> {
  const next = (journals.get(stateDir) ?? Promise.resolve()).then(async () => {
    const entries: JournalEntry[] = [...uploads.values()]
      .filter((upload) => upload.stateDir === stateDir)
      .map((upload) => ({ path: upload.temporary, size: upload.size, ...upload.identity }));
    await writeFileAtomic(journalPath(stateDir), JSON.stringify({ temporaries: entries }));
  });
  journals.set(
    stateDir,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Removes temporaries an earlier Host process left behind. Runs once per state folder and
 * process; later calls share it, so a begin never races a sweep of its own temporaries.
 */
export function sweepStaleTextUploads(stateDir: string): Promise<void> {
  let sweep = swept.get(stateDir);
  if (!sweep) {
    sweep = (async () => {
      const state = await readStateFile(
        journalPath(stateDir),
        (text) => {
          const parsed = JSON.parse(text) as { temporaries?: unknown };
          const entries: JournalEntry[] = [];
          if (Array.isArray(parsed.temporaries))
            for (const item of parsed.temporaries as Partial<JournalEntry>[])
              if (
                item &&
                typeof item.path === "string" &&
                typeof item.dev === "string" &&
                typeof item.ino === "string" &&
                typeof item.size === "number"
              )
                entries.push({ path: item.path, dev: item.dev, ino: item.ino, size: item.size });
          return entries;
        },
        { quarantine: false },
      );
      if (state.status !== "ok") return;
      for (const entry of state.value) {
        // Only a staged temporary that still is the recorded file is ours; anything else stays.
        if (
          !TEMPORARY_NAME.test(basename(entry.path)) ||
          basename(dirname(entry.path)) !== STAGING_NAME
        )
          continue;
        await removeIfSame(entry.path, entry, entry.size);
        await removeStagingIfEmpty(dirname(entry.path));
      }
      await writeFileAtomic(journalPath(stateDir), JSON.stringify({ temporaries: [] }));
    })().catch(() => {
      // A failed sweep may retry on the next start; it must never block saving.
    });
    swept.set(stateDir, sweep);
  }
  return sweep;
}

async function discard(upload: Upload): Promise<void> {
  clearTimeout(upload.timer);
  uploads.delete(upload.id);
  await upload.handle.close().catch(() => {});
  await removeIfSame(upload.temporary, upload.identity);
  await removeStagingIfEmpty(dirname(upload.temporary));
  await writeJournal(upload.stateDir).catch(() => {});
}

function arm(upload: Upload): void {
  clearTimeout(upload.timer);
  upload.timer = setTimeout(() => {
    // Expiry is cleanup only; a failure leaves the journal entry for the next start's sweep.
    void upload.tail.then(() => discard(upload)).catch(() => {});
  }, UPLOAD_TTL_MS);
  upload.timer.unref();
}

function owned(owner: string, id: unknown): Upload {
  const upload = typeof id === "string" ? uploads.get(id) : undefined;
  if (!upload || upload.owner !== owner)
    throw new Error("Upload not found or expired. Save again.");
  return upload;
}

/** Serializes one upload's operations, so a retry never overlaps the request it repeats. */
function exclusive<T>(upload: Upload, operation: () => Promise<T>): Promise<T> {
  const run = upload.tail.then(operation, operation);
  upload.tail = run.catch(() => {});
  return run;
}

/** The target path of a staged upload, for the delivery fence that guards its commit. */
export function stagedTextUploadPath(owner: string, id: unknown): string | undefined {
  return typeof id === "string" && uploads.get(id)?.owner === owner
    ? uploads.get(id)?.path
    : undefined;
}

export async function beginTextUpload(input: {
  owner: string;
  root: string;
  path: string;
  size: unknown;
  baseVersion: unknown;
  stateDir: string;
}): Promise<{ uploadId: string; chunkBytes: number; expiresInMs: number }> {
  const { owner, root, path, size, baseVersion, stateDir } = input;
  if (!Number.isSafeInteger(size) || (size as number) < 0) throw new Error("Invalid upload size");
  if ((size as number) > MAX_EDIT_TEXT_BYTES)
    throw new Error(`File is too large to save (maximum ${MAX_EDIT_TEXT_BYTES / 1024 / 1024} MB).`);
  if (baseVersion !== undefined && (typeof baseVersion !== "string" || baseVersion.length > 256))
    throw new Error("Invalid file version");
  // Claim the slot and bytes before the first await, so parallel begins cannot all pass the check.
  const staged = [...uploads.values()].reduce((sum, upload) => sum + upload.size, 0);
  if (
    uploads.size + reserved.count >= MAX_UPLOADS ||
    staged + reserved.bytes + (size as number) > MAX_STAGED_BYTES
  )
    throw new Error("Too many file saves are in progress on this computer. Try again shortly.");
  reserved.count += 1;
  reserved.bytes += size as number;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reserved.count -= 1;
    reserved.bytes -= size as number;
  };
  try {
    await sweepStaleTextUploads(stateDir);
    const previous = await statSaveTarget(path);
    if (previous?.isDirectory()) throw new Error("Cannot save text to a directory.");
    // Refuse early so an obviously stale save does not upload anything.
    if (baseVersion !== undefined && (!previous || fileVersion(previous) !== baseVersion))
      throw fileChangedError();
    const mode = previous ? Number(previous.mode) : undefined;
    const id = randomUUID();
    let temporary = "";
    let handle: FileHandle | undefined;
    // A concurrent cleanup may remove the empty staging folder between its creation and the open.
    for (let attempt = 0; !handle; attempt++) {
      const staging = await ensureStagingDirectory(path);
      temporary = join(staging, `.bycoda-upload-${randomUUID()}`);
      try {
        handle = await open(temporary, "wx", mode);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= 2) throw error;
      }
    }
    const created = await handle.stat({ bigint: true }).catch(async (error) => {
      await handle.close().catch(() => {});
      throw error;
    });
    const upload: Upload = {
      id,
      owner,
      root,
      path,
      temporary,
      baseVersion: baseVersion as string | undefined,
      size: size as number,
      received: 0,
      mode,
      handle,
      identity: identityOf(created),
      tail: Promise.resolve(),
      timer: setTimeout(() => {}, 0),
      stateDir,
    };
    uploads.set(id, upload);
    release();
    try {
      // The journal names the temporary before any byte lands, so a crash can always sweep it.
      await writeJournal(stateDir);
    } catch (error) {
      await discard(upload);
      throw error;
    }
    arm(upload);
    return { uploadId: id, chunkBytes: MAX_UPLOAD_CHUNK_BYTES, expiresInMs: UPLOAD_TTL_MS };
  } finally {
    release();
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function writeTextUploadChunk(
  owner: string,
  input: Record<string, unknown>,
): Promise<{ received: number }> {
  const upload = owned(owner, input.uploadId);
  const { offset, data } = input;
  if (
    !Number.isSafeInteger(offset) ||
    (offset as number) < 0 ||
    typeof data !== "string" ||
    data.length > Math.ceil((MAX_UPLOAD_CHUNK_BYTES * 4) / 3) + 4 ||
    data.length % 4 !== 0 ||
    !BASE64.test(data)
  )
    throw new Error("Invalid upload chunk");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 1 || bytes.length > MAX_UPLOAD_CHUNK_BYTES)
    throw new Error("Invalid upload chunk");
  return await exclusive(upload, async () => {
    if (uploads.get(upload.id) !== upload)
      throw new Error("Upload not found or expired. Save again.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const last = upload.last;
    // A retry of the chunk just written is acknowledged without writing it twice.
    if (
      last &&
      offset === last.offset &&
      bytes.length === last.length &&
      digest === last.digest &&
      upload.received === last.offset + last.length
    ) {
      arm(upload);
      return { received: upload.received };
    }
    if (offset !== upload.received) throw new Error("Invalid upload offset");
    if (upload.received + bytes.length > upload.size)
      throw new Error("The upload is larger than announced.");
    await writeAll(upload.handle, bytes, upload.received);
    upload.received += bytes.length;
    upload.last = { offset: offset as number, length: bytes.length, digest };
    arm(upload);
    return { received: upload.received };
  });
}

export async function abortTextUpload(owner: string, id: unknown): Promise<{ aborted: boolean }> {
  const upload = typeof id === "string" ? uploads.get(id) : undefined;
  if (!upload || upload.owner !== owner) return { aborted: false };
  await exclusive(upload, () => discard(upload));
  return { aborted: true };
}

export async function commitTextUpload(
  owner: string,
  id: unknown,
  invalidate: (root: string) => void = invalidateHostFilePaths,
): Promise<{ version: string }> {
  const done = typeof id === "string" ? completed.get(id) : undefined;
  // A retried commit whose first answer was lost reports the version it produced.
  if (done && done.owner === owner && Date.now() - done.at < COMPLETED_TTL_MS)
    return { version: done.version };
  const upload = owned(owner, id);
  return await exclusive(upload, async () => {
    if (uploads.get(upload.id) !== upload)
      throw new Error("Upload not found or expired. Save again.");
    clearTimeout(upload.timer);
    try {
      if (upload.received !== upload.size) throw new Error("The upload is incomplete. Save again.");
      const { root, path, temporary, baseVersion, mode, handle } = upload;
      if (mode !== undefined) await handle.chmod(mode);
      await handle.sync();
      const written = await handle.stat({ bigint: true });
      // The real size, not the count of acknowledged chunks, decides whether the file is complete.
      if (written.size !== BigInt(upload.size))
        throw new Error("The upload is incomplete. Save again.");
      const version = await serializeTextSave(root, path, async () => {
        const previous = await statSaveTarget(path);
        if (previous?.isDirectory()) throw new Error("Cannot save text to a directory.");
        if (baseVersion !== undefined && (!previous || fileVersion(previous) !== baseVersion))
          throw fileChangedError();
        // The staged entry must still be the file this upload wrote, never a swapped-in file or link.
        const [live, staging] = await Promise.all([
          lstatOrUndefined(temporary),
          lstat(dirname(temporary)),
        ]);
        if (
          !staging.isDirectory() ||
          !live ||
          !live.isFile() ||
          !sameIdentity(live, upload.identity) ||
          live.dev !== written.dev ||
          live.ino !== written.ino ||
          live.size !== BigInt(upload.size)
        )
          throw new Error("The staged upload changed on disk. Save again.");
        await renameWithRetry(temporary, path);
        await handle.close().catch(() => {});
        invalidate(root);
        // Only report a version of the file we just renamed into place.
        const after = await statSaveTarget(path);
        if (
          !after ||
          after.dev !== written.dev ||
          after.ino !== written.ino ||
          after.size !== written.size
        )
          throw fileChangedError();
        return fileVersion(after);
      });
      completed.set(upload.id, { owner, version, at: Date.now() });
      while (completed.size > MAX_COMPLETED) completed.delete(completed.keys().next().value!);
      uploads.delete(upload.id);
      await removeStagingIfEmpty(dirname(upload.temporary));
      await writeJournal(upload.stateDir).catch(() => {});
      return { version };
    } catch (error) {
      // Any failure ends the upload: the staged bytes are not a safe base for a later commit.
      await discard(upload);
      throw error;
    }
  });
}
