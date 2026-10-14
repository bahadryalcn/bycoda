import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SocialVideoUploads } from "./social-media";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "social-video-"));
  directories.push(directory);
  return { directory, uploads: new SocialVideoUploads(directory) };
}
const bytes = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
describe("Owner-only host video ingestion", () => {
  it("keeps sequential chunks intact and completed media survives a new uploader", async () => {
    const s = await fixture();
    const { uploadId } = await s.uploads.call("owner", {
      mode: "begin",
      size: bytes.length,
    });
    await s.uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 0,
      base64: bytes.subarray(0, 8).toString("base64"),
    });
    await expect(s.uploads.call("owner", { mode: "finish", uploadId })).rejects.toThrow(
      "incomplete",
    );
    await s.uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 8,
      base64: bytes.subarray(8).toString("base64"),
    });
    await s.uploads.call("owner", { mode: "finish", uploadId });
    expect(await readFile(join(s.directory, "media", uploadId))).toEqual(bytes);
    await expect(
      new SocialVideoUploads(s.directory).call("owner", {
        mode: "chunk",
        uploadId,
        offset: 0,
        base64: bytes.toString("base64"),
      }),
    ).rejects.toThrow("invalid");
    expect(await readFile(join(s.directory, "media", uploadId))).toEqual(bytes);
  });
  it("rejects cross-owner writes, duplicate offsets, oversize files and path claims", async () => {
    const s = await fixture();
    await expect(
      s.uploads.call("owner", { mode: "begin", size: 64 * 1024 * 1024 + 1 }),
    ).rejects.toThrow("64 MiB");
    const { uploadId } = await s.uploads.call("owner", {
      mode: "begin",
      size: bytes.length,
    });
    await expect(
      s.uploads.call("other", {
        mode: "chunk",
        uploadId,
        offset: 0,
        base64: bytes.toString("base64"),
      }),
    ).rejects.toThrow("invalid");
    await expect(
      s.uploads.call("owner", { mode: "cancel", uploadId: "../../secret" }),
    ).rejects.toThrow("invalid");
    await s.uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 0,
      base64: bytes.toString("base64"),
    });
    await expect(
      s.uploads.call("owner", {
        mode: "chunk",
        uploadId,
        offset: 0,
        base64: bytes.toString("base64"),
      }),
    ).rejects.toThrow("sequential");
    await s.uploads.call("owner", { mode: "cancel", uploadId });
    await expect(readFile(join(s.directory, "media", uploadId))).rejects.toThrow();
  });
  it("checks file signatures and bounds concurrent allocations", async () => {
    const s = await fixture();
    const { uploadId } = await s.uploads.call("owner", {
      mode: "begin",
      size: 16,
    });
    await s.uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 0,
      base64: Buffer.alloc(16).toString("base64"),
    });
    await expect(s.uploads.call("owner", { mode: "finish", uploadId })).rejects.toThrow(
      "extension",
    );
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => s.uploads.call("owner", { mode: "begin", size: 16 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
  });
});
