import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import {
  writeAttachmentChunk,
  attachmentUploadStatus,
  readAttachmentChunk,
  attachmentPath,
  MAX_REMOTE_ATTACHMENT_BYTES,
} from "./attachments";
import { createHash } from "node:crypto";

const cleanups: Array<() => void> = [];

it.skipIf(process.platform !== "win32")(
  "serializes UUID case aliases before accepting a conflicting retry",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "remote-upload-alias-"));
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const replies = await Promise.allSettled([
      writeAttachmentChunk(store, {
        id,
        offset: 0,
        size: 6,
        data: Buffer.from("before").toString("base64"),
      }),
      writeAttachmentChunk(store, {
        id: id.toUpperCase(),
        offset: 0,
        size: 6,
        data: Buffer.from("after!").toString("base64"),
      }),
    ]);
    expect(replies[0].status).toBe("fulfilled");
    expect(replies[1].status).toBe("rejected");
    if (replies[1].status === "rejected")
      expect(String(replies[1].reason)).toContain("does not match");
    expect(readFileSync(attachmentPath(store, id), "utf8")).toBe("before");
  },
);

it("reports a durable offset and prefix hash after a host store reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "remote-resume-test-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await writeAttachmentChunk(store, {
    id,
    offset: 0,
    size: 6,
    data: Buffer.from("abc").toString("base64"),
  });
  store.close();
  const reopened = new HostStore(path);
  cleanups.push(() => {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  expect(await attachmentUploadStatus(reopened, { id, size: 6 })).toEqual({
    offset: 3,
    hash: createHash("sha256").update("abc").digest("hex"),
  });
  expect(
    await writeAttachmentChunk(reopened, {
      id,
      offset: 3,
      size: 6,
      data: Buffer.from("def").toString("base64"),
    }),
  ).toEqual({ offset: 6 });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

it("reads non-image files only after session acceptance and ignores client-supplied paths", async () => {
  const { store, id } = fixture();
  const bytes = Buffer.from("# Saved note\n");
  await writeAttachmentChunk(store, { id, size: bytes.length, offset: 0, data: bytes.toString("base64") });
  vi.spyOn(store, "session").mockImplementation((sessionId) => ({ session: { blocks: sessionId === "owner" ? [{ attachments: [{ id, name: "note.md", kind: "file", mimeType: "text/markdown", size: bytes.length }] }] : [] } }) as ReturnType<HostStore["session"]>);
  const read = await readAttachmentChunk(store, { sessionId: "owner", id, offset: 0, path: "C:/private/secret" });
  expect(Buffer.from(read.data, "base64")).toEqual(bytes);
  await expect(readAttachmentChunk(store, { sessionId: "other", id, offset: 0 })).rejects.toThrow("not found");
  await expect(readAttachmentChunk(store, { sessionId: "owner", id: "../secret", offset: 0 })).rejects.toThrow("not found");
});

it("preserves generated-image ownership and metadata size bounds", async () => {
  const { store, id } = fixture();
  const image = { path: join(store.attachmentDir, "..", id), name: "generated.png", mimeType: "image/png", size: 0 };
  vi.spyOn(store, "session").mockReturnValue({ session: { blocks: [{ id: "generated", image }] } } as ReturnType<HostStore["session"]>);
  await expect(readAttachmentChunk(store, { sessionId: "owner", id: "generated", offset: 0 })).rejects.toThrow("generated image path");
  image.size = MAX_REMOTE_ATTACHMENT_BYTES + 1;
  await expect(readAttachmentChunk(store, { sessionId: "owner", id: "generated", offset: 0 })).rejects.toThrow("size");
});

it("accepts ordered chunks and an identical retry while rejecting changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "remote-upload-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const chunk = (offset: number, data: string) =>
    writeAttachmentChunk(store, {
      id,
      offset,
      size: 6,
      data: Buffer.from(data).toString("base64"),
    });
  expect(await chunk(0, "abc")).toEqual({ offset: 3 });
  expect(await chunk(0, "abc")).toEqual({ offset: 3 });
  await expect(chunk(0, "xyz")).rejects.toThrow("does not match");
  await expect(chunk(4, "ef")).rejects.toThrow("out of order");
  expect(await chunk(3, "def")).toEqual({ offset: 6 });
  await expect(
    writeAttachmentChunk(store, {
      id: "../escape",
      offset: 0,
      size: 1,
      data: "YQ==",
    }),
  ).rejects.toThrow("Invalid attachment ID");
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "remote-attachment-async-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
}

it("serializes simultaneous identical retries, status and later chunks without poisoning the queue", async () => {
  const { store, id } = fixture();
  const chunk = (offset: number, text: string) =>
    writeAttachmentChunk(store, {
      id,
      offset,
      size: 6,
      data: Buffer.from(text).toString("base64"),
    });
  const first = chunk(0, "abc");
  const retry = chunk(0, "abc");
  const mismatch = expect(chunk(0, "xyz")).rejects.toThrow("does not match");
  const status = attachmentUploadStatus(store, { id, size: 6 });
  const last = chunk(3, "def");
  expect(await first).toEqual({ offset: 3 });
  expect(await retry).toEqual({ offset: 3 });
  await mismatch;
  expect(await status).toEqual({
    offset: 3,
    hash: createHash("sha256").update("abc").digest("hex"),
  });
  expect(await last).toEqual({ offset: 6 });
  expect(readFileSync(attachmentPath(store, id)).toString()).toBe("abcdef");
});

it("streams a large prefix and bounds concurrent session image reads", async () => {
  const { store, id } = fixture();
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 2, 91);
  const session = {
    session: {
      blocks: [
        {
          attachments: [
            {
              id,
              name: "image",
              kind: "image",
              mimeType: "image/png",
              size: bytes.length,
            },
          ],
        },
      ],
    },
  } as ReturnType<HostStore["session"]>;
  vi.spyOn(store, "session").mockImplementation((sessionId) => {
    if (sessionId !== "allowed")
      return { session: { blocks: [] } } as ReturnType<HostStore["session"]>;
    return session;
  });
  const uploads = [];
  for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
    uploads.push(
      writeAttachmentChunk(store, {
        id,
        offset,
        size: bytes.length,
        data: bytes.subarray(offset, offset + 512 * 1024).toString("base64"),
      }),
    );
  }
  const status = attachmentUploadStatus(store, { id, size: bytes.length });
  const firstRead = readAttachmentChunk(store, { sessionId: "allowed", id, offset: 0 });
  await Promise.all(uploads);
  expect(await status).toEqual({
    offset: bytes.length,
    hash: createHash("sha256").update(bytes).digest("hex"),
  });
  const first = await firstRead;
  expect(Buffer.from(first.data, "base64")).toEqual(bytes.subarray(0, 524286));
  expect(first.offset).toBe(524286);
  const last = await readAttachmentChunk(store, {
    sessionId: "allowed",
    id,
    offset: bytes.length - 2,
  });
  expect(last).toEqual({
    data: bytes.subarray(-2).toString("base64"),
    offset: bytes.length,
    size: bytes.length,
  });
  await expect(readAttachmentChunk(store, { sessionId: "other", id, offset: 0 })).rejects.toThrow(
    "not found",
  );
  await expect(
    readAttachmentChunk(store, { sessionId: "allowed", id, offset: bytes.length + 1 }),
  ).rejects.toThrow("offset");
});

it("accepts an empty attachment and rejects declared-size, path and chunk limit violations", async () => {
  const { store, id } = fixture();
  expect(await attachmentUploadStatus(store, { id, size: 0 })).toEqual({ offset: 0 });
  expect(await writeAttachmentChunk(store, { id, offset: 0, size: 0, data: "" })).toEqual({
    offset: 0,
  });
  expect(await attachmentUploadStatus(store, { id, size: 0 })).toEqual({
    offset: 0,
    hash: createHash("sha256").update("").digest("hex"),
  });
  await expect(
    writeAttachmentChunk(store, { id, offset: 0, size: 0, data: "YQ==" }),
  ).rejects.toThrow("size");
  await expect(attachmentUploadStatus(store, { id: "../escape", size: 0 })).rejects.toThrow("ID");
  await expect(
    attachmentUploadStatus(store, { id, size: MAX_REMOTE_ATTACHMENT_BYTES + 1 }),
  ).rejects.toThrow("size");
  await expect(
    writeAttachmentChunk(store, {
      id,
      offset: 0,
      size: MAX_REMOTE_ATTACHMENT_BYTES,
      data: Buffer.alloc(512 * 1024 + 1).toString("base64"),
    }),
  ).rejects.toThrow("size");
  writeFileSync(attachmentPath(store, id), "abcdef");
  await expect(attachmentUploadStatus(store, { id, size: 5 })).rejects.toThrow("size mismatch");
  await expect(
    writeAttachmentChunk(store, { id, offset: 0, size: 5, data: "YWJj" }),
  ).rejects.toThrow("size mismatch");
});
