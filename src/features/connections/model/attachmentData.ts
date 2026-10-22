// Non-final chunks align with base64 triplets while staying below 512 KiB.
export const ATTACHMENT_CHUNK_BYTES = 3 * Math.floor((512 * 1024) / 3);
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function base64ByteLength(data: string): number {
  if (data.length % 4 !== 0) throw new Error("Invalid attachment data");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  if (data.indexOf("=") !== (padding ? data.length - padding : -1))
    throw new Error("Invalid attachment data");
  return (data.length / 4) * 3 - padding;
}

/** Extract a bounded, independently encoded chunk, including an unaligned resume. */
export function attachmentBase64Chunk(data: string, offset: number, length: number): string {
  const start = 4 * Math.floor(offset / 3);
  const end = 4 * Math.ceil((offset + length) / 3);
  const chunk = data.slice(start, end);
  if (offset % 3 === 0 && base64ByteLength(chunk) === length) return chunk;
  const decoded = atob(chunk);
  return btoa(decoded.slice(offset % 3, (offset % 3) + length));
}
