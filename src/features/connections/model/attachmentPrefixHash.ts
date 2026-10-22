import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from "./attachmentData";

export interface AttachmentPrefixInput {
  type: string;
  size?: number;
  offset?: number;
  data?: string;
}

/** Worker-owned state. Native paths use streaming SHA-256 instead. */
export function createAttachmentPrefixHasher() {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let offset = 0;
  return async (input: AttachmentPrefixInput): Promise<{ hash?: string }> => {
    if (input.type === "start") {
      if (
        !Number.isSafeInteger(input.size) ||
        input.size! < 0 ||
        input.size! > MAX_ATTACHMENT_BYTES
      )
        throw new Error("Invalid attachment prefix size");
      bytes = new Uint8Array(input.size!);
      offset = 0;
    } else if (input.type === "chunk") {
      if (!bytes || input.offset !== offset || typeof input.data !== "string")
        throw new Error("Invalid attachment prefix chunk");
      if (input.data.length > 4 * Math.ceil(ATTACHMENT_CHUNK_BYTES / 3))
        throw new Error("Invalid attachment prefix chunk size");
      const decoded = atob(input.data);
      if (decoded.length > ATTACHMENT_CHUNK_BYTES || offset + decoded.length > bytes.length)
        throw new Error("Invalid attachment prefix chunk size");
      // A loop avoids the callback allocation in Uint8Array.from(atob(...)).
      for (let index = 0; index < decoded.length; index++)
        bytes[offset + index] = decoded.charCodeAt(index);
      offset += decoded.length;
    } else if (input.type === "finish") {
      if (!bytes || offset !== bytes.length) throw new Error("Attachment prefix is incomplete");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      bytes = undefined;
      return { hash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") };
    } else {
      throw new Error("Invalid attachment prefix operation");
    }
    return {};
  };
}
