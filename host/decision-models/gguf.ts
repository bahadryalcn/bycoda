import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

export type GgufHeader = { version: number; tensorCount: bigint; metadataCount: bigint };

const HEADER_BYTES = 24;

/**
 * Reads the fixed GGUF header (magic, version, tensor and metadata counts). Returns undefined for
 * any file that is not GGUF. Metadata key/value pairs are not parsed.
 */
export async function readGgufHeader(path: string): Promise<GgufHeader | undefined> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    if (bytesRead < HEADER_BYTES || buffer.toString("latin1", 0, 4) !== "GGUF") return undefined;
    const version = buffer.readUInt32LE(4);
    if (version < 1 || version > 3) return undefined;
    return {
      version,
      tensorCount: buffer.readBigUInt64LE(8),
      metadataCount: buffer.readBigUInt64LE(16),
    };
  } finally {
    await handle.close();
  }
}

/** Streams the file through SHA256; an abort rejects with the signal's reason. */
export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
    signal?.throwIfAborted();
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
