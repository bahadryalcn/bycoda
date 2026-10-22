import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveHostGeneratedImage, deleteHostGeneratedImages } from "./generated-images";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("persists a PNG on a headless host and confines cleanup to its artifact directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "host-image-"));
  directories.push(directory);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lX8AAAAASUVORK5CYII=",
    "base64",
  );
  const asset = await saveHostGeneratedImage(directory, {
    data: png.toString("base64"),
    name: "../image",
  });
  expect(await readFile(asset.path)).toEqual(png);
  expect(asset).toMatchObject({ mimeType: "image/png", size: png.length });
  expect(asset.name).not.toContain("/");
  await expect(
    deleteHostGeneratedImages(directory, [join(directory, "..", "outside")]),
  ).rejects.toThrow("Invalid generated image path");
  await deleteHostGeneratedImages(directory, [asset.path]);
  await expect(readFile(asset.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects malformed base64 and non PNG data", async () => {
  await expect(
    saveHostGeneratedImage(tmpdir(), { data: "not base64!", name: "image" }),
  ).rejects.toThrow("valid base64 PNG");
  await expect(
    saveHostGeneratedImage(tmpdir(), {
      data: Buffer.from("text").toString("base64"),
      name: "image",
    }),
  ).rejects.toThrow("valid base64 PNG");
});

it.each([-1, 0, 1])("uses the remote attachment boundary end to end (%i bytes)", async (delta) => {
  const { MAX_REMOTE_ATTACHMENT_BYTES, readAttachmentChunk } = await import("./attachments");
  const { HostStore } = await import("./store");
  const directory = await mkdtemp(join(tmpdir(), "host-image-limit-"));
  directories.push(directory);
  const bytes = Buffer.alloc(MAX_REMOTE_ATTACHMENT_BYTES + delta);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  if (delta > 0) {
    await expect(
      saveHostGeneratedImage(directory, { data: bytes.toString("base64"), name: "large" }),
    ).rejects.toThrow("remote attachment limit");
    return;
  }
  const asset = await saveHostGeneratedImage(directory, {
    data: bytes.toString("base64"),
    name: "large",
  });
  // The same metadata returned by generation is accepted by the session chunk reader.
  const store = {
    attachmentDir: directory,
    session: () => ({ session: { blocks: [{ id: "image", image: asset }] } }),
  } as unknown as InstanceType<typeof HostStore>;
  const result = await readAttachmentChunk(store, {
    sessionId: "session",
    id: "image",
    offset: asset.size - 17,
  });
  expect(Buffer.from(result.data, "base64")).toEqual(bytes.subarray(-17));
  expect(result.offset).toBe(asset.size);
});
