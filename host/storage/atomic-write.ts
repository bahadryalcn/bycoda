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
 * Reads distinguish missing state from corrupt state. Security-sensitive callers must
 * retain corrupt state (quarantine: false) and fail closed until explicitly repaired.
 * This helper is for private Host state, not permission-preserving workspace saves.
 */
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

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
  } catch (error) {
    if (!["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw new AtomicWritePublishedError(error);
  }
}

/** Publication succeeded, but its directory durability could not be confirmed. */
export class AtomicWritePublishedError extends Error {
  readonly published = true;
  constructor(cause: unknown) {
    super("State file was replaced, but directory sync failed; read back before retrying", {
      cause,
    });
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
  const handle = await open(temp, "wx", mode ?? 0o600);
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(target));
}

/** Synchronous variant for process-lifetime locks and shutdown paths. */
export function writeFileAtomicSync(
  target: string,
  data: string | Uint8Array,
  { mode }: WriteOptions = {},
): void {
  mkdirSync(dirname(target), { recursive: true });
  const temp = tempPath(target);
  const descriptor = openSync(temp, "wx", mode ?? 0o600);
  try {
    try {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset);
        if (written === 0) throw new Error("State write made no progress");
        offset += written;
      }
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temp, target);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* The original publication error is authoritative. */
    }
    throw error;
  }
  if (process.platform !== "win32") {
    try {
      const directory = openSync(dirname(target), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      if (!["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw new AtomicWritePublishedError(error);
    }
  }
}

export type StateFileResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing"; value: undefined }
  | { status: "corrupt"; value: undefined; quarantined: string | undefined; error: unknown };

export type ReadStateOptions = {
  /** Save a unique evidence copy. The invalid source always stays until explicitly repaired. */
  quarantine?: boolean;
};

function evidencePath(target: string, bytes: Buffer): string {
  return `${target}.corrupt-${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseState<T>(bytes: Buffer, parse: (text: string) => T): T {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim()) throw new Error("State file is empty");
  return parse(text);
}

/**
 * Missing, corrupt and unreadable are distinct. Optional quarantine copies the bytes read
 * into an exclusive, synced evidence file; it never moves a concurrently replaced source.
 * Corrupt state stays corrupt across restarts until its owning workflow repairs it.
 */
export async function readStateFile<T>(
  target: string,
  parse: (text: string) => T,
  { quarantine = true }: ReadStateOptions = {},
): Promise<StateFileResult<T>> {
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        await lstat(target);
      } catch (inspection) {
        if ((inspection as NodeJS.ErrnoException).code === "ENOENT")
          return { status: "missing", value: undefined };
        throw inspection;
      }
    }
    throw error;
  }
  try {
    return { status: "ok", value: parseState(bytes, parse) };
  } catch (error) {
    if (!quarantine) return { status: "corrupt", value: undefined, quarantined: undefined, error };
    let quarantined = evidencePath(target, bytes);
    try {
      for (let attempt = 0; ; attempt++) {
        let handle;
        let created = false;
        try {
          handle = await open(quarantined, "wx", 0o600);
          created = true;
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code !== "EEXIST") throw copyError;
          if (!(await readFile(quarantined)).equals(bytes)) {
            if (attempt === 3) throw new Error("Could not retain state evidence");
            quarantined = `${evidencePath(target, bytes)}-${randomBytes(6).toString("hex")}`;
            continue;
          }
          handle = await open(quarantined, "r+");
        }
        try {
          if (created) await handle.writeFile(bytes);
          // Re-sync an existing complete copy after an earlier uncertain flush.
          await handle.sync();
        } finally {
          await handle.close();
        }
        break;
      }
      await syncDirectory(dirname(target));
      return { status: "corrupt", value: undefined, quarantined, error };
    } catch {
      return { status: "corrupt", value: undefined, quarantined: undefined, error };
    }
  }
}

/** Synchronous read for CLI polling and the process owner lock protocol. */
export function readStateFileSync<T>(
  target: string,
  parse: (text: string) => T,
  { quarantine = true }: ReadStateOptions = {},
): StateFileResult<T> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        lstatSync(target);
      } catch (inspection) {
        if ((inspection as NodeJS.ErrnoException).code === "ENOENT")
          return { status: "missing", value: undefined };
        throw inspection;
      }
    }
    throw error;
  }
  try {
    return { status: "ok", value: parseState(bytes, parse) };
  } catch (error) {
    if (!quarantine) return { status: "corrupt", value: undefined, quarantined: undefined, error };
    let quarantined = evidencePath(target, bytes);
    try {
      for (let attempt = 0; ; attempt++) {
        let descriptor: number;
        let created = false;
        try {
          descriptor = openSync(quarantined, "wx", 0o600);
          created = true;
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code !== "EEXIST") throw copyError;
          if (!readFileSync(quarantined).equals(bytes)) {
            if (attempt === 3) throw new Error("Could not retain state evidence");
            quarantined = `${evidencePath(target, bytes)}-${randomBytes(6).toString("hex")}`;
            continue;
          }
          descriptor = openSync(quarantined, "r+");
        }
        try {
          if (created) writeFileSync(descriptor, bytes);
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        break;
      }
      if (process.platform !== "win32") {
        const directory = openSync(dirname(target), "r");
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
      return { status: "corrupt", value: undefined, quarantined, error };
    } catch {
      return { status: "corrupt", value: undefined, quarantined: undefined, error };
    }
  }
}
