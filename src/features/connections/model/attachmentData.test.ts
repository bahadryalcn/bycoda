import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  ATTACHMENT_CHUNK_BYTES,
  attachmentBase64Chunk,
  base64ByteLength,
  MAX_ATTACHMENT_BYTES,
} from "./attachmentData";
import { createAttachmentPrefixHasher } from "./attachmentPrefixHash";
import { hashBase64Prefix } from "./attachmentPrefix";

afterEach(() => vi.unstubAllGlobals());

it("extracts independent chunks at every base64 alignment without losing final bytes", () => {
  const bytes = Buffer.from("abcdefghijklmnopq");
  const data = bytes.toString("base64");
  expect(base64ByteLength(data)).toBe(bytes.length);
  expect(base64ByteLength("")).toBe(0);
  for (let offset = 0; offset <= bytes.length; offset++) {
    for (let length = 0; length <= bytes.length - offset; length++) {
      expect(Buffer.from(attachmentBase64Chunk(data, offset, length), "base64")).toEqual(
        bytes.subarray(offset, offset + length),
      );
    }
  }
  for (const invalid of ["Y", "YW=J", "===="])
    expect(() => base64ByteLength(invalid)).toThrow("Invalid attachment data");
});

it("hashes an unaligned large prefix via ordered bounded worker messages and disposes the worker", async () => {
  const sent: Array<{ type: string; data?: string; offset?: number }> = [];
  const terminated = vi.fn();
  class WorkerFixture {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    process = createAttachmentPrefixHasher();
    postMessage(
      input: Parameters<ReturnType<typeof createAttachmentPrefixHasher>>[0] & { id: number },
    ) {
      sent.push(input);
      void this.process(input).then(
        (result) => this.onmessage?.({ data: { id: input.id, ...result } }),
        (error) => this.onmessage?.({ data: { id: input.id, error: String(error) } }),
      );
    }
    terminate = terminated;
  }
  vi.stubGlobal("Worker", WorkerFixture);
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 4, 23);
  const prefix = bytes.length - 2;
  expect(await hashBase64Prefix(bytes.toString("base64"), prefix)).toBe(
    createHash("sha256").update(bytes.subarray(0, prefix)).digest("hex"),
  );
  const chunks = sent.filter((message) => message.type === "chunk");
  expect(chunks).toHaveLength(Math.ceil(prefix / ATTACHMENT_CHUNK_BYTES));
  expect(
    chunks.every((chunk) => Buffer.from(chunk.data!, "base64").length <= ATTACHMENT_CHUNK_BYTES),
  ).toBe(true);
  expect(chunks.map((chunk) => chunk.offset)).toEqual(
    chunks.map((_, index) => index * ATTACHMENT_CHUNK_BYTES),
  );
  expect(terminated).toHaveBeenCalledOnce();
});

it("releases the worker on decode failure instead of resuming unverified bytes", async () => {
  const terminated = vi.fn();
  class WorkerFixture {
    onmessage?: (event: { data: unknown }) => void;
    postMessage(input: { id: number }) {
      queueMicrotask(() => this.onmessage?.({ data: { id: input.id, error: "decode failed" } }));
    }
    terminate = terminated;
  }
  vi.stubGlobal("Worker", WorkerFixture);
  await expect(hashBase64Prefix("YWJj", 3)).rejects.toThrow("decode failed");
  expect(terminated).toHaveBeenCalledOnce();
});

it("rejects holes, oversized prefixes and incomplete hashes in the worker", async () => {
  const process = createAttachmentPrefixHasher();
  await expect(process({ type: "start", size: MAX_ATTACHMENT_BYTES + 1 })).rejects.toThrow("size");
  await process({ type: "start", size: 3 });
  await expect(process({ type: "chunk", offset: 1, data: "YWJj" })).rejects.toThrow("chunk");
  await expect(process({ type: "finish" })).rejects.toThrow("incomplete");
  await expect(
    process({
      type: "chunk",
      offset: 0,
      data: Buffer.alloc(ATTACHMENT_CHUNK_BYTES + 1).toString("base64"),
    }),
  ).rejects.toThrow("size");
  await process({ type: "chunk", offset: 0, data: "YWJj" });
  expect(await process({ type: "finish" })).toEqual({
    hash: createHash("sha256").update("abc").digest("hex"),
  });
  await expect(process({ type: "finish" })).rejects.toThrow("incomplete");
});
