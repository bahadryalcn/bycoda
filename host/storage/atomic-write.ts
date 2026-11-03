/**
 * Crash-safe state files for the Host.
 *
 * `writeFileSync(path, data)` truncates the file first and writes afterwards, so a crash or
 * power loss between the two leaves an empty file. A temp file renamed into place is better,
 * but only once the temp file's bytes are on disk: APFS and NTFS may otherwise commit the
 * rename before the data, which again yields a zero-byte file after power loss (this is how
 * `grants.json`, `skill-policy.json` and `owner.lock` could stop the app or the Host from
 * starting). `writeFileAtomic` fsyncs the temp file, renames it, then fsyncs the directory.
 *
 * Reading has the matching rule: an unparsable state file is never fatal at startup. It is
 * moved aside with a `.corrupt-<timestamp>` suffix so a person can inspect it, and the
 * caller continues with "absent".
 */
import { closeSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type WriteOptions = {
  /** File mode for a newly created target (the temp file is created with it). */
  mode?: number;
};

function tempPath(target: string): string {
  return join(dirname(target), `.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows cannot fsync a directory handle; the rename itself is journaled there.
  if (process.platform === "win32") return;
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // A read-only or virtual filesystem; the file fsync above is the strongest guarantee left.
  }
}

/** Replace `target` with `data` so that readers see either the old or the new content. */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  { mode }: WriteOptions = {},
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = tempPath(target);
  const handle = await open(temp, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
  await syncDirectory(dirname(target));
}

/** Synchronous variant for process-lifetime locks and shutdown paths. */
export function writeFileAtomicSync(
  target: string,
  data: string | Uint8Array,
  { mode }: WriteOptions = {},
): void {
  const temp = tempPath(target);
  const descriptor = openSync(temp, "w", mode);
  try {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temp, target);
  if (process.platform !== "win32") {
    try {
      const directory = openSync(dirname(target), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      // See syncDirectory.
    }
  }
}

export type StateFileResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing"; value: undefined }
  | { status: "corrupt"; value: undefined; quarantined: string | undefined; error: unknown };

/**
 * Read and parse a state file. A missing file is `missing`; an empty or unparsable file is
 * moved to `<file>.corrupt-<timestamp>` and reported as `corrupt`. Only genuine I/O errors
 * (permissions, EIO) propagate, because those are not something a restart can repair.
 */
export async function readStateFile<T>(
  target: string,
  parse: (text: string) => T,
): Promise<StateFileResult<T>> {
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "missing", value: undefined };
    throw error;
  }
  try {
    if (!text.trim()) throw new Error("State file is empty");
    return { status: "ok", value: parse(text) };
  } catch (error) {
    const quarantined = `${target}.corrupt-${Date.now()}`;
    try {
      await rename(target, quarantined);
      return { status: "corrupt", value: undefined, quarantined, error };
    } catch {
      return { status: "corrupt", value: undefined, quarantined: undefined, error };
    }
  }
}
