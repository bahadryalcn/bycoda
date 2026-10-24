import { statSync, lstatSync, unlinkSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import type { Attachment } from "../src/features/sessions/model/session";
import type { RemoteAttachment } from "../src/features/connections/model/protocol";
import type { HostStore } from "./store";
import { mkdir, open, readdir, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseBrowserAnnotation } from "../src/shared/lib/browserAnnotation";

// Reads, status hashes and writes of the same file observe a single ordered stream.
// Each operation closes its handle; settled queues retain neither handles nor stores.
const attachmentOperations = new Map<string, Promise<void>>();
const attachmentTouches = new Map<string, number>();
const TOUCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let attachmentTouchOverflowUntil = 0;
function touchAttachment(key: string): void {
  const now = Date.now();
  for (const [entry, touched] of attachmentTouches) {
    if (touched > now - TOUCH_TTL_MS) break;
    attachmentTouches.delete(entry);
  }
  attachmentTouches.delete(key);
  if (attachmentTouches.size >= 10000) {
    // A bounded lease cache cannot prove all recent consumers are represented.
    // Suspend collection through the missing lease's protection interval.
    attachmentTouchOverflowUntil = now + TOUCH_TTL_MS;
    attachmentTouches.delete(attachmentTouches.keys().next().value!);
  }
  attachmentTouches.set(key, now);
}

function serializeAttachment<T>(path: string, operation: () => Promise<T>): Promise<T> {
  // UUID spelling is case-insensitive; Windows and common macOS volumes also
  // resolve upper/lower-case names to the same file. Serialize those aliases.
  const absolute = resolve(path);
  const key = join(dirname(absolute), basename(absolute).toLowerCase());
  touchAttachment(key);
  const previous = attachmentOperations.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(
    () => {},
    () => {},
  );
  attachmentOperations.set(key, settled);
  void settled.then(() => {
    if (attachmentOperations.get(key) === settled) attachmentOperations.delete(key);
  });
  return result;
}

async function readExactly(handle: FileHandle, bytes: Buffer, offset: number): Promise<void> {
  let read = 0;
  while (read < bytes.length) {
    const result = await handle.read(bytes, read, bytes.length - read, offset + read);
    if (!result.bytesRead) throw new Error("Attachment is incomplete");
    read += result.bytesRead;
  }
}

export async function attachmentUploadStatus(store: HostStore, input: Record<string, unknown>) {
  const path = attachmentPath(store, String(input.id ?? ""));
  if (
    !Number.isSafeInteger(input.size) ||
    Number(input.size) < 0 ||
    Number(input.size) > MAX_REMOTE_ATTACHMENT_BYTES
  )
    throw new Error("Invalid attachment size");
  return serializeAttachment(path, async () => {
    let handle: FileHandle;
    try {
      handle = await open(path, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { offset: 0 };
      throw error;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > Number(input.size))
        throw new Error("Uploaded attachment size mismatch");
      const hash = createHash("sha256");
      const bytes = Buffer.alloc(Math.min(64 * 1024, info.size));
      for (let offset = 0; offset < info.size; offset += bytes.length) {
        const chunk = bytes.subarray(0, Math.min(bytes.length, info.size - offset));
        await readExactly(handle, chunk, offset);
        hash.update(chunk);
      }
      if ((await handle.stat()).size !== info.size)
        throw new Error("Uploaded attachment size mismatch");
      return { offset: info.size, hash: hash.digest("hex") };
    } finally {
      await handle.close();
    }
  });
}

export const MAX_REMOTE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_CHUNK_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function attachmentPath(store: HostStore, id: string): string {
  if (!UUID.test(id)) throw new Error("Invalid attachment ID");
  return join(store.attachmentDir, id);
}

/** An offset makes a repeated chunk safe when its HTTP response was lost. */
export async function writeAttachmentChunk(
  store: HostStore,
  input: Record<string, unknown>,
): Promise<{ offset: number }> {
  const path = attachmentPath(store, String(input.id ?? ""));
  const offset = input.offset;
  const size = input.size;
  const encoded = input.data;
  if (
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isSafeInteger(size) ||
    Number(size) < 0 ||
    Number(size) > MAX_REMOTE_ATTACHMENT_BYTES ||
    typeof encoded !== "string" ||
    encoded.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 ||
    (encoded.length > 0 && (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4))
  )
    throw new Error("Invalid attachment chunk");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const byteLength = (encoded.length / 4) * 3 - padding;
  if (byteLength > MAX_CHUNK_BYTES || Number(offset) + byteLength > Number(size))
    throw new Error("Invalid attachment chunk size");
  return serializeAttachment(path, async () => {
    const bytes = Buffer.from(encoded, "base64");
    await mkdir(store.attachmentDir, { recursive: true, mode: 0o700 });
    let handle: FileHandle;
    try {
      handle = await open(path, "r+");
    } catch (error) {
      if (Number(offset) !== 0 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      handle = await open(path, "wx+", 0o600);
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > Number(size))
        throw new Error("Uploaded attachment size mismatch");
      if (info.size === Number(offset)) {
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(
            bytes,
            written,
            bytes.length - written,
            Number(offset) + written,
          );
          if (!result.bytesWritten) throw new Error("Could not write attachment chunk");
          written += result.bytesWritten;
        }
      } else if (info.size >= Number(offset) + bytes.length) {
        const existing = Buffer.alloc(bytes.length);
        await readExactly(handle, existing, Number(offset));
        if (!existing.equals(bytes))
          throw new Error("Attachment retry does not match uploaded bytes");
      } else {
        throw new Error("Attachment chunks are out of order");
      }
      return { offset: Number(offset) + bytes.length };
    } finally {
      await handle.close();
    }
  });
}

export function parseRemoteAttachments(value: unknown): RemoteAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid attachments");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid attachment");
    const v = entry as Record<string, unknown>;
    if (
      !UUID.test(String(v.id ?? "")) ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 255 ||
      typeof v.mimeType !== "string" ||
      !v.mimeType.trim() ||
      v.mimeType.length > 128 ||
      !["image", "audio", "file"].includes(String(v.kind)) ||
      !Number.isSafeInteger(v.size) ||
      Number(v.size) < 0 ||
      Number(v.size) > MAX_REMOTE_ATTACHMENT_BYTES
    )
      throw new Error("Invalid attachment");
    return {
      id: v.id as string,
      name: v.name,
      mimeType: v.mimeType,
      kind: v.kind as RemoteAttachment["kind"],
      size: v.size as number,
      ...(v.browserAnnotation
        ? { browserAnnotation: parseBrowserAnnotation(v.browserAnnotation) }
        : {}),
    };
  });
}

export function resolveAttachments(store: HostStore, refs: RemoteAttachment[]): Attachment[] {
  return refs.map((ref) => {
    const path = attachmentPath(store, ref.id);
    touchAttachment(join(dirname(resolve(path)), basename(path).toLowerCase()));
    if (statSync(path).size !== ref.size) throw new Error(`Attachment ${ref.name} is incomplete`);
    return { ...ref, path };
  });
}

/** Reads only an attachment already accepted into this session. Paths supplied
 * by the client are never used, and each response stays below the RPC cap. */
export async function readAttachmentChunk(
  store: HostStore,
  input: Record<string, unknown>,
  sessionFor: HostStore["session"] = (id) => store.session(id),
) {
  const session = sessionFor(String(input.sessionId ?? ""));
  const generated = session.session.blocks.find(
    (block) => block.id === input.id && block.image,
  )?.image;
  const attachment = generated
    ? { ...generated, id: basename(generated.path), kind: "image" as const }
    : session.session.blocks
        .flatMap((block) => block.attachments ?? [])
        .find((file) => file.id === input.id);
  if (!attachment) throw new Error("Session attachment not found");
  if (
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 0 ||
    attachment.size > MAX_REMOTE_ATTACHMENT_BYTES
  )
    throw new Error("Invalid attachment size");
  const offset = input.offset;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > attachment.size)
    throw new Error("Invalid attachment offset");
  const path = attachmentPath(store, attachment.id);
  if (generated && resolve(generated.path) !== resolve(path))
    throw new Error("Invalid generated image path");
  // Non-final chunks are divisible by three, so the client can join base64.
  return serializeAttachment(path, async () => {
    const handle = await open(path, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== attachment.size)
        throw new Error("Attachment is incomplete");
      const bytes = Buffer.alloc(
        Math.min(3 * Math.floor(MAX_CHUNK_BYTES / 3), attachment.size - Number(offset)),
      );
      await readExactly(handle, bytes, Number(offset));
      return {
        data: bytes.toString("base64"),
        offset: Number(offset) + bytes.length,
        size: attachment.size,
      };
    } finally {
      await handle.close();
    }
  });
}

/** A reference authority must include external drafts/desktop consumers. Unknown
 * consumers return undefined, which suspends deletion rather than guessing. */
export async function collectAttachmentGarbage(
  store: HostStore,
  externalReferences: () => ReadonlySet<string> | undefined,
  now = Date.now(),
  graceMs = 7 * 24 * 60 * 60 * 1000,
  eligible?: ReadonlySet<string>,
  onRemoved?: (id: string) => void,
  shouldContinue: () => boolean = () => true,
): Promise<string[]> {
  if (eligible?.size === 0) return [];
  if (!Number.isFinite(graceMs) || graceMs < 24 * 60 * 60 * 1000)
    throw new Error("Attachment grace period must be at least one day");
  const entries = eligible
    ? Array.from(eligible).slice(0, 200)
    : await readdir(store.attachmentDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
  if (attachmentTouchOverflowUntil > now) return [];
  const external = externalReferences();
  if (!external) return [];
  if (entries.length > 10000) return [];
  // Flush may fail: never delete if the authoritative durable scan cannot run.
  store.flushAll();
  const candidates = new Set(entries.map((id) => id.toLowerCase()));
  const referenced = new Set(Array.from(external, (id) => id.toLowerCase()));
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
  const stamp = () =>
    `${store.changeVersion}:${store.db.prepare("SELECT total_changes() AS changes").get()?.changes}:${store.db.prepare("PRAGMA data_version").get()?.data_version}`;
  const startedStamp = stamp();
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const scanStarted = performance.now();
  let sliceStarted = scanStarted;
  let sliceCharacters = 0;
  // The SELECT cursor may span yields. Any local or external write invalidates
  // this scan; no deletion occurs until a stable, complete inventory finishes.
  for (const table of store.db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()) {
    if (
      eligible &&
      ["attachment_ownership_files", "attachment_ownership_claims"].includes(String(table.name))
    )
      continue;
    for (const row of store.db.prepare(`SELECT * FROM ${quote(String(table.name))}`).iterate()) {
      for (const value of Object.values(row)) {
        if (value instanceof Uint8Array) return [];
        if (typeof value !== "string") continue;
        for (let at = 0; at < value.length; at += 256 * 1024) {
          // A UUID split at a chunk boundary must still be seen exactly once or
          // conservatively twice. Only candidate IDs are retained in memory.
          const chunk = value.slice(Math.max(0, at - 35), at + 256 * 1024);
          for (const match of chunk.matchAll(uuid)) {
            const id = match[0].toLowerCase();
            if (candidates.has(id)) referenced.add(id);
          }
          sliceCharacters += chunk.length;
          if (sliceCharacters >= 256 * 1024 || performance.now() - sliceStarted >= 8) {
            await new Promise<void>((done) => setImmediate(done));
            if (
              !shouldContinue() ||
              stamp() !== startedStamp ||
              performance.now() - scanStarted > 120000
            )
              return [];
            sliceStarted = performance.now();
            sliceCharacters = 0;
          }
        }
      }
      if (performance.now() - sliceStarted >= 8) {
        await new Promise<void>((done) => setImmediate(done));
        if (
          !shouldContinue() ||
          stamp() !== startedStamp ||
          performance.now() - scanStarted > 120000
        )
          return [];
        sliceStarted = performance.now();
        sliceCharacters = 0;
      }
    }
  }
  // Flush newly pending session state before the final revision check. Refresh
  // external ownership after all yields; nothing below this point awaits.
  if (!shouldContinue()) return [];
  store.flushAll();
  // Reserve the SQLite writer for the final check and unlink phase too: a
  // different connection cannot publish a new reference between them. Ledger
  // removals share this transaction rather than committing per file.
  return store.transaction(() => {
    if (stamp() !== startedStamp) return [];
    const currentExternal = externalReferences();
    if (!currentExternal) return [];
    for (const id of currentExternal) referenced.add(id.toLowerCase());
    const directory = lstatSync(store.attachmentDir, { throwIfNoEntry: false });
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) return [];
    const removed: string[] = [];
    // No await between the reference scan, final lease/stat recheck and unlink:
    // this process cannot accept a new reference or upload in that interval.
    for (const id of entries) {
      if (
        !UUID.test(id) ||
        (eligible && !eligible.has(id.toLowerCase())) ||
        referenced.has(id.toLowerCase())
      )
        continue;
      const path = attachmentPath(store, id);
      const key = join(dirname(resolve(path)), basename(path).toLowerCase());
      if (attachmentOperations.has(key) || (attachmentTouches.get(key) ?? 0) > now - graceMs)
        continue;
      const info = lstatSync(path, { throwIfNoEntry: false });
      if (!info) {
        if (eligible) onRemoved?.(id.toLowerCase());
        continue;
      }
      if (!info.isFile() || Math.max(info.mtimeMs, info.ctimeMs) > now - graceMs) continue;
      unlinkSync(path);
      attachmentTouches.delete(key);
      removed.push(id);
      onRemoved?.(id.toLowerCase());
    }
    for (const [key, touched] of attachmentTouches)
      if (touched < now - graceMs && !attachmentOperations.has(key)) attachmentTouches.delete(key);
    return removed;
  });
}
