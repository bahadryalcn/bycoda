import { ATTACHMENT_CHUNK_BYTES, attachmentBase64Chunk } from "./attachmentData";

/** WebCrypto needs a contiguous input; build it only in a short-lived worker.
 * Transfer bounded base64 slices one at a time, never decode a prefix on the UI thread. */
export async function hashBase64Prefix(data: string, size: number): Promise<string> {
  const worker = new Worker(new URL("./attachmentPrefix.worker.ts", import.meta.url), {
    type: "module",
  });
  let requestId = 0;
  const request = (input: Record<string, unknown>) =>
    new Promise<{ hash?: string }>((resolve, reject) => {
      const id = ++requestId;
      worker.onmessage = (event: MessageEvent<{ id: number; error?: string; hash?: string }>) => {
        if (event.data.id !== id) return;
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = () => reject(new Error("Could not verify attachment prefix"));
      worker.postMessage({ ...input, id });
    });
  try {
    await request({ type: "start", size });
    for (let offset = 0; offset < size; offset += ATTACHMENT_CHUNK_BYTES) {
      await request({
        type: "chunk",
        offset,
        data: attachmentBase64Chunk(data, offset, Math.min(ATTACHMENT_CHUNK_BYTES, size - offset)),
      });
    }
    const reply = await request({ type: "finish" });
    if (!reply.hash) throw new Error("Invalid attachment prefix hash");
    return reply.hash;
  } finally {
    worker.terminate();
  }
}
