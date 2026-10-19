import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "../../sessions/model/session";
import type { RemoteAttachment } from "./protocol";
import { remoteRequest } from "./connections";
import {
  ATTACHMENT_CHUNK_BYTES,
  MAX_ATTACHMENT_BYTES,
  attachmentBase64Chunk,
  base64ByteLength,
} from "./attachmentData";
import { hashBase64Prefix } from "./attachmentPrefix";
import type { AttachmentOwnership } from "./attachmentOwnership";

// Keep bytes in-flight bounded, and preserve ordered offsets within each file.
const UPLOAD_CONCURRENCY = 2;
const acknowledged = new Map<string, { size: number; offset: number }>();

export async function uploadRemoteAttachments(
  machineId: string,
  attachments: Attachment[],
  options: {
    environmentId?: string;
    resumable?: boolean;
    ownership?: AttachmentOwnership;
    ownershipSource?: string;
    onProgress?: (id: string, offset: number, size: number) => void;
  } = {},
): Promise<RemoteAttachment[]> {
  if (attachments.length > 20) throw new Error("Too many attachments");
  if (options.ownership) {
    if (!options.ownershipSource) throw new Error("Missing attachment ownership source");
    options.ownership.beginJob(options.ownershipSource);
    try {
      await options.ownership.acquire(
        options.ownershipSource,
        attachments.map((file) => file.id),
      );
    } catch (error) {
      options.ownership.finishJob(options.ownershipSource);
      throw error;
    }
  }
  const uploaded: RemoteAttachment[] = new Array(attachments.length);
  let next = 0;
  const worker = async () => {
    while (next < attachments.length) {
      const indexInBatch = next++;
      const file = attachments[indexInBatch]!;
      const owner = options.ownership
        ? { ownerId: options.ownership.ownerId, claimId: options.ownership.claimId(file.id) }
        : {};
      if (file.hostEnvironmentId && file.hostEnvironmentId === options.environmentId) {
        const { id, name, mimeType, kind, size, browserAnnotation } = file;
        uploaded[indexInBatch] = {
          id,
          name,
          mimeType,
          kind,
          size,
          ...(browserAnnotation ? { browserAnnotation } : {}),
        };
        continue;
      }
      if (!Number.isSafeInteger(file.size) || file.size < 0)
        throw new Error("Invalid attachment size");
      if (file.size > MAX_ATTACHMENT_BYTES)
        throw new Error(`${file.name} is too large to send to a remote machine (20 MB maximum)`);
      if (file.data === undefined && !file.path)
        throw new Error(`Cannot read ${file.name} for remote upload`);
      if (file.data !== undefined && base64ByteLength(file.data) !== file.size)
        throw new Error("Attachment data does not match declared size");
      const readChunk = async (offset: number) => {
        const length = Math.min(ATTACHMENT_CHUNK_BYTES, file.size - offset);
        if (file.data !== undefined) {
          return {
            data: attachmentBase64Chunk(file.data, offset, length),
            offset: offset + length,
            size: file.size,
          };
        }
        const chunk = await invoke<{ data: string; offset: number; size: number }>(
          "read_attachment_chunk",
          { path: file.path, size: file.size, offset, length: ATTACHMENT_CHUNK_BYTES },
        );
        if (
          chunk.size !== file.size ||
          chunk.offset !== offset + length ||
          typeof chunk.data !== "string" ||
          base64ByteLength(chunk.data) !== length
        )
          throw new Error("Invalid attachment read");
        return chunk;
      };
      const key = `${machineId}:${file.id}`;
      const prior = acknowledged.get(key);
      let offset = prior?.size === file.size ? prior.offset : 0;
      if (options.resumable) {
        const status = await remoteRequest<{ offset: number; hash?: string }>(
          machineId,
          "attachments.status",
          { id: file.id, size: file.size, ...owner },
        );
        if (!Number.isSafeInteger(status.offset) || status.offset < 0 || status.offset > file.size)
          throw new Error("Invalid upload status");
        if (status.offset > 0) {
          const hash =
            file.data !== undefined
              ? await hashBase64Prefix(file.data, status.offset)
              : await invoke<string>("hash_attachment_prefix", {
                  path: file.path,
                  size: file.size,
                  offset: status.offset,
                });
          if (hash !== status.hash)
            throw new Error("Attachment retry does not match uploaded bytes");
        }
        offset = status.offset;
      }
      // Only acknowledged chunks are skipped. An uncertain chunk is retried at
      // its original offset and the host verifies byte equality before accepting.
      if (offset === file.size && file.size > 0 && file.data === undefined && !options.resumable)
        await readChunk(offset);
      if (file.size === 0) {
        await readChunk(0);
        const reply = await remoteRequest<{ offset: number }>(machineId, "attachments.upload", {
          id: file.id,
          offset: 0,
          size: file.size,
          data: "",
          ...owner,
        });
        if (reply.offset !== 0) throw new Error("Invalid upload acknowledgement");
        options.onProgress?.(file.id, 0, 0);
      }
      while (offset < file.size) {
        const chunk = await readChunk(offset);
        const reply = await remoteRequest<{ offset: number }>(machineId, "attachments.upload", {
          id: file.id,
          offset,
          size: file.size,
          data: chunk.data,
          ...owner,
        });
        if (reply.offset !== chunk.offset || reply.offset > file.size)
          throw new Error("Invalid upload acknowledgement");
        offset = reply.offset;
        options.onProgress?.(file.id, offset, file.size);
        acknowledged.set(key, { size: file.size, offset });
        if (acknowledged.size > 256) acknowledged.delete(acknowledged.keys().next().value!);
      }
      if (offset !== file.size) throw new Error(`Could not finish uploading ${file.name}`);
      uploaded[indexInBatch] = {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        kind: file.kind,
        size: file.size,
        ...(file.browserAnnotation ? { browserAnnotation: file.browserAnnotation } : {}),
      };
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, attachments.length) }, worker),
  );
  const failed = workers.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    if (options.ownershipSource) options.ownership?.finishJob(options.ownershipSource);
    throw failed.reason;
  }
  return uploaded;
}
