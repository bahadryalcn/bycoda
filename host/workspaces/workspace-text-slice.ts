import { constants, type BigIntStats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

/** Bytes per page; the same bound as the local paged reader (`SLICE_BYTES` in `src-tauri/src/fs/large_text.rs`). */
export const TEXT_SLICE_BYTES = 1024 * 1024;

/** Refusal when the file changed after the first page (the local reader's `FILE_CHANGED`). */
export const TEXT_FILE_CHANGED = "The file changed while it was open. Reopen it to continue.";

/** Identity of the file a paged view opened; later pages send it back. */
export type TextSliceStamp = { size: number; modifiedUs: number };

export type TextSlice = TextSliceStamp & {
  text: string;
  /** Byte offset where `text` starts. */
  offset: number;
  /** Byte offset just past `text`; the next page starts exactly here. */
  end: number;
};

/** Validates a `read_text_file_slice` request. */
export function parseTextSliceRequest(
  offset: unknown,
  expected: unknown,
): { offset: number; expected: TextSliceStamp | null } {
  if (!Number.isSafeInteger(offset) || Number(offset) < 0)
    throw new Error("Invalid file slice request");
  if (expected === undefined || expected === null) return { offset: Number(offset), expected: null };
  const stamp = expected as Partial<TextSliceStamp>;
  if (
    typeof expected !== "object" ||
    !Number.isSafeInteger(stamp.size) ||
    Number(stamp.size) < 0 ||
    !Number.isSafeInteger(stamp.modifiedUs) ||
    Number(stamp.modifiedUs) < 0
  )
    throw new Error("Invalid file slice request");
  return {
    offset: Number(offset),
    expected: { size: Number(stamp.size), modifiedUs: Number(stamp.modifiedUs) },
  };
}

/**
 * One page of a text file on this computer, with the local `read_text_file_slice` contract: it
 * starts exactly at `offset`, ends at a line break (or at a character boundary inside a line longer
 * than a page), and refuses a file whose identity differs from `expected` before or after the read.
 */
export async function readTextSlice(
  path: string,
  offset: number,
  expected: TextSliceStamp | null,
): Promise<TextSlice> {
  const file = await open(
    path,
    constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile()) throw new Error("Not a file");
    const stamp = stampOf(opened);
    if (expected && (expected.size !== stamp.size || expected.modifiedUs !== stamp.modifiedUs))
      throw new Error(TEXT_FILE_CHANGED);
    const start = Math.min(offset, stamp.size);
    // Never read past the size the identity was taken at, so a file that grows cannot widen a page.
    const bytes = await readRange(file, start, Math.min(TEXT_SLICE_BYTES, stamp.size - start));
    const after = stampOf(await file.stat({ bigint: true }));
    if (after.size !== stamp.size || after.modifiedUs !== stamp.modifiedUs)
      throw new Error(TEXT_FILE_CHANGED);
    if (bytes.includes(0)) throw new Error("Binary files cannot be previewed.");

    let tail = bytes.length;
    if (start + tail < stamp.size) {
      const newline = bytes.lastIndexOf(10);
      tail = newline >= 0 ? newline + 1 : completeUtf8Length(bytes);
    }
    return {
      // `ignoreBOM` keeps a leading byte-order mark, as the local lossy decoder does.
      text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, tail)),
      offset: start,
      end: start + tail,
      size: stamp.size,
      modifiedUs: stamp.modifiedUs,
    };
  } finally {
    await file.close();
  }
}

function stampOf(info: BigIntStats): TextSliceStamp {
  return { size: Number(info.size), modifiedUs: Number(info.mtimeNs / BigInt(1000)) };
}

async function readRange(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await file.read(bytes, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return bytes.subarray(0, filled);
}

/** Length of `bytes` without a trailing, incomplete UTF-8 sequence. Invalid bytes stay in place. */
function completeUtf8Length(bytes: Uint8Array): number {
  const len = bytes.length;
  for (let back = 1; back <= Math.min(len, 3); back++) {
    const byte = bytes[len - back];
    if ((byte & 0xc0) === 0x80) continue;
    const needed =
      byte >= 0xc2 && byte <= 0xdf
        ? 2
        : byte >= 0xe0 && byte <= 0xef
          ? 3
          : byte >= 0xf0 && byte <= 0xf4
            ? 4
            : 0;
    if (needed === 0) return len;
    return back < needed ? len - back : len;
  }
  return len;
}
