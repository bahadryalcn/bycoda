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
  it("rechecks authority after chunk preparation and retains a retryable upload", async () => {
    const { directory } = await fixture();
    let revokeDuringWrite = false;
    let checks = 0;
    const uploads = new SocialVideoUploads(directory, Date.now, async () => {
      if (revokeDuringWrite && ++checks === 2)
        throw new Error("Request authorization was revoked.");
    });
    const { uploadId } = await uploads.call("owner", { mode: "begin", size: bytes.length });
    revokeDuringWrite = true;
    await expect(
      uploads.call("owner", {
        mode: "chunk",
        uploadId,
        offset: 0,
        base64: bytes.toString("base64"),
      }),
    ).rejects.toThrow("authorization was revoked");
    expect((await readFile(join(directory, "media", "incoming", uploadId))).length).toBe(0);
    revokeDuringWrite = false;
    await uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 0,
      base64: bytes.toString("base64"),
    });
    await uploads.call("owner", { mode: "finish", uploadId });
    expect(await readFile(join(directory, "media", uploadId))).toEqual(bytes);
  });
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
  it("reports the committed offset to the owner only, without changing it", async () => {
    const s = await fixture();
    const { uploadId } = await s.uploads.call("owner", { mode: "begin", size: bytes.length });
    await s.uploads.call("owner", {
      mode: "chunk",
      uploadId,
      offset: 0,
      base64: bytes.subarray(0, 8).toString("base64"),
    });
    await expect(s.uploads.call("owner", { mode: "status", uploadId })).resolves.toEqual({
      uploadId,
      offset: 8,
    });
    await expect(s.uploads.call("other", { mode: "status", uploadId })).rejects.toThrow("invalid");
    await expect(s.uploads.call("owner", { mode: "status", uploadId })).resolves.toMatchObject({
      offset: 8,
    });
  });
  it("extends the idle expiry per accepted chunk but never past the absolute bound", async () => {
    const { directory } = await fixture();
    const minute = 60_000;
    let clock = 1_000_000;
    const uploads = new SocialVideoUploads(directory, () => clock);
    const big = Buffer.alloc(3, 1);
    const { uploadId } = await uploads.call("owner", { mode: "begin", size: 12 });
    const chunk = (offset: number) =>
      uploads.call("owner", { mode: "chunk", uploadId, offset, base64: big.toString("base64") });
    // Each chunk lands 20 minutes after the last, so the first 30-minute window alone would lapse.
    clock += 20 * minute;
    await chunk(0);
    clock += 20 * minute;
    await chunk(3);
    clock += 20 * minute;
    await expect(uploads.call("owner", { mode: "status", uploadId })).resolves.toMatchObject({
      offset: 6,
    });
    // Idle past the refreshed window: gone.
    clock += 31 * minute;
    await expect(uploads.call("owner", { mode: "status", uploadId })).rejects.toThrow("expired");
    await expect(readFile(join(directory, "media", "incoming", uploadId))).rejects.toThrow();
  });
  it("expires an upload that keeps progressing once its absolute lifetime passes", async () => {
    const { directory } = await fixture();
    const minute = 60_000;
    let clock = 1_000_000;
    const uploads = new SocialVideoUploads(directory, () => clock);
    const piece = Buffer.alloc(1, 1).toString("base64");
    const { uploadId } = await uploads.call("owner", { mode: "begin", size: 12 });
    for (let offset = 0; offset < 8; offset++) {
      clock += 29 * minute;
      await uploads.call("owner", { mode: "chunk", uploadId, offset, base64: piece });
    }
    // 8 x 29 minutes is 232 minutes: inside the 4 hour bound, and still live.
    await expect(uploads.call("owner", { mode: "status", uploadId })).resolves.toMatchObject({
      offset: 8,
    });
    // The last chunk would have kept it 30 minutes, but the 240 minute bound clamps that.
    clock += 9 * minute;
    await expect(uploads.call("owner", { mode: "status", uploadId })).rejects.toThrow("expired");
  });
});
