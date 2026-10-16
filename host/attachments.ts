import { statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import type { Attachment } from "../src/features/sessions/model/session";
import type { RemoteAttachment } from "../src/features/connections/model/protocol";
import type { HostStore } from "./store";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseBrowserAnnotation } from "../src/shared/lib/browserAnnotation";

// Reads, status hashes and writes of the same file observe a single ordered stream.
// Each operation closes its handle; settled queues retain neither handles nor stores.
const attachmentOperations = new Map<string, Promise<void>>();

function serializeAttachment<T>(path: string, operation: () => Promise<T>): Promise<T> {
  // UUID spelling is case-insensitive; Windows and common macOS volumes also
  // resolve upper/lower-case names to the same file. Serialize those aliases.
  const absolute = resolve(path);
  const key = join(dirname(absolute), basename(absolute).toLowerCase());
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
    if (statSync(path).size !== ref.size) throw new Error(`Attachment ${ref.name} is incomplete`);
    return { ...ref, path };
  });
}

/** Reads only an attachment already accepted into this session. Paths supplied
 * by the client are never used, and each response stays below the RPC cap. */
export async function readAttachmentChunk(store: HostStore, input: Record<string, unknown>) {
  const session = store.session(String(input.sessionId ?? ""));
  const generated = session.session.blocks.find(
    (block) => block.id === input.id && block.image,
  )?.image;
  const attachment = generated
    ? { ...generated, id: basename(generated.path), kind: "image" as const }
    : session.session.blocks
        .flatMap((block) => block.attachments ?? [])
        .find((file) => file.id === input.id);
  if (!attachment) throw new Error("Session attachment not found");
  if (!Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > MAX_REMOTE_ATTACHMENT_BYTES)
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
