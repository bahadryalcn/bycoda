import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "./adapter";
import { linkedInMultiImageIssue, publishLinkedInMultiImage } from "./linkedinMedia";

const author = "urn:li:organization:1234";
const account = (): SocialAccount => ({
  id: "account",
  platform: "linkedin",
  platformId: author,
  name: "Bycoda",
  accountType: "organization",
  connection: "oauth",
  connected: true,
  accessApproved: true,
  scopes: ["w_organization_social"],
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (count = 2): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "owner",
  kind: "publish",
  payload: {
    text: "Bycoda photos",
    link: "https://bycoda.com",
    media: Array.from({ length: count }, (_, index) => ({
      kind: "image",
      uploadId: `upload-${index}`,
      alt: `Description ${index + 1}`,
    })),
  },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function fixture(
  options: {
    status?: () => string;
    owner?: string;
    imageId?: string;
    postId?: string | null;
    uploadFailure?: boolean;
    uploadUrl?: string;
  } = {},
) {
  const calls: { url: string; options: RequestInit }[] = [];
  let index = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input),
      request = init ?? {};
    calls.push({ url, options: request });
    if (url.endsWith("?action=initializeUpload")) {
      index++;
      return Response.json({
        value: {
          image: `urn:li:image:photo${index}`,
          uploadUrlExpiresAt: 60_000,
          uploadUrl:
            options.uploadUrl ??
            `https://www.linkedin.com/dms-uploads/photo${index}/upload?token=synthetic`,
        },
      });
    }
    if (url.startsWith("https://www.linkedin.com/dms-uploads/")) {
      if (options.uploadFailure) throw new Error("synthetic upload error");
      return new Response(null, { status: 201 });
    }
    if (url.includes("/rest/images/"))
      return Response.json({
        id: options.imageId ?? decodeURIComponent(url.split("/").at(-1)!),
        owner: options.owner ?? author,
        status: options.status?.() ?? "AVAILABLE",
      });
    if (url.endsWith("/rest/posts"))
      return new Response(null, {
        status: 201,
        headers:
          options.postId === null
            ? {}
            : { "x-restli-id": options.postId ?? "urn:li:ugcPost:98765" },
      });
    throw new Error("unexpected test endpoint");
  });
  const read = vi.fn(async (_id: string) => png);
  const checkpoint = vi.fn<(state: NonNullable<SocialJob["preparation"]>) => Promise<void>>(
    async () => {},
  );
  const guard = vi.fn<() => Promise<void>>(async () => {});
  const send = (sendJob: SocialJob, sendAccount = account()) =>
    publishLinkedInMultiImage(
      new SocialHttp(fetcher),
      sendAccount,
      sendJob,
      "synthetic",
      "202609",
      read,
      checkpoint,
      guard,
      () => 1000,
    );
  return { fetcher, calls, read, checkpoint, guard, send };
}

describe("LinkedIn organization multi-image API", () => {
  it("uploads and checks each image, preserves order and alternative text, then posts once", async () => {
    const f = fixture();
    const send = job();
    const snapshots: string[] = [];
    f.checkpoint.mockImplementation(async (state) => {
      snapshots.push(JSON.stringify(state));
    });
    expect(await f.send(send)).toEqual({
      platformId: "urn:li:ugcPost:98765",
      url: "https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A98765/",
    });
    expect(f.read.mock.calls.map((call) => call[0])).toEqual(["upload-0", "upload-1"]);
    expect(f.calls.map((call) => call.url)).toEqual([
      "https://api.linkedin.com/rest/images?action=initializeUpload",
      "https://www.linkedin.com/dms-uploads/photo1/upload?token=synthetic",
      "https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3Aphoto1",
      "https://api.linkedin.com/rest/images?action=initializeUpload",
      "https://www.linkedin.com/dms-uploads/photo2/upload?token=synthetic",
      "https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3Aphoto2",
      "https://api.linkedin.com/rest/posts",
    ]);
    expect(JSON.parse(f.calls[0]!.options.body as string)).toEqual({
      initializeUploadRequest: { owner: author },
    });
    expect(JSON.parse(f.calls.at(-1)!.options.body as string)).toMatchObject({
      author,
      commentary: "Bycoda photos\nhttps://bycoda.com",
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      content: {
        multiImage: {
          images: [
            { id: "urn:li:image:photo1", altText: "Description 1" },
            { id: "urn:li:image:photo2", altText: "Description 2" },
          ],
        },
      },
    });
    expect(f.calls[0]!.options.headers).toMatchObject({
      "LinkedIn-Version": "202609",
      "X-Restli-Protocol-Version": "2.0.0",
    });
    expect(
      snapshots.map((snapshot) =>
        JSON.parse(snapshot).linkedinMedia.images.map((image: { status: string }) => image.status),
      ),
    ).toEqual([
      ["registered"],
      ["uploaded"],
      ["ready"],
      ["ready", "registered"],
      ["ready", "uploaded"],
      ["ready", "ready"],
      ["ready", "ready"],
    ]);
    expect(
      snapshots.every(
        (snapshot) => !snapshot.includes("dms-uploads") && !snapshot.includes("token=synthetic"),
      ),
    ).toBe(true);
    expect(f.guard).toHaveBeenCalledOnce();
    expect(f.guard.mock.invocationCallOrder[0]).toBeLessThan(
      f.fetcher.mock.invocationCallOrder.at(-1)!,
    );
    expect(send.preparation?.linkedinMedia?.publishedId).toBe("urn:li:ugcPost:98765");
  });

  it("supports four reviewed images and a numeric organization identity", async () => {
    const f = fixture({ postId: "urn:li:share:98765" });
    const a = account();
    a.platformId = "1234";
    expect((await f.send(job(4), a)).platformId).toBe("urn:li:share:98765");
    expect(f.read).toHaveBeenCalledTimes(4);
    expect(f.calls.filter((call) => call.url.endsWith("/rest/posts"))).toHaveLength(1);
  });

  it("resumes image processing without reinitializing or uploading the prepared image", async () => {
    let status = "PROCESSING";
    const f = fixture({ status: () => status });
    const send = job();
    await expect(f.send(send)).rejects.toMatchObject({ code: "processing", retryAt: 61_000 });
    expect(send.preparation?.linkedinMedia?.images).toEqual([
      { uploadId: "upload-0", id: "urn:li:image:photo1", status: "uploaded" },
    ]);
    expect(f.guard).not.toHaveBeenCalled();
    status = "AVAILABLE";
    expect((await f.send(send)).platformId).toBe("urn:li:ugcPost:98765");
    expect(f.calls.filter((call) => call.url.endsWith("?action=initializeUpload"))).toHaveLength(2);
    expect(f.read).toHaveBeenCalledTimes(2);
  });

  it("persists initialized identity before upload and does not invent a signed-URL retry", async () => {
    const f = fixture({ uploadFailure: true, status: () => "WAITING_UPLOAD" });
    const send = job();
    await expect(f.send(send)).rejects.toMatchObject({ code: "unknown" });
    expect(send.preparation?.linkedinMedia?.images[0]?.status).toBe("registered");
    expect(f.checkpoint).toHaveBeenCalledOnce();
    await expect(f.send(send)).rejects.toMatchObject({ code: "rejected" });
    expect(f.calls.filter((call) => call.url.endsWith("?action=initializeUpload"))).toHaveLength(1);
    expect(f.calls.filter((call) => call.url.endsWith("/rest/posts"))).toHaveLength(0);
  });

  it("prevents upload when registration persistence fails", async () => {
    const f = fixture();
    f.checkpoint.mockImplementation(async () => {
      throw new Error("persist failed");
    });
    await expect(f.send(job())).rejects.toThrow("persist failed");
    expect(f.calls).toHaveLength(1);
    expect(f.guard).not.toHaveBeenCalled();
  });

  it("retains ready images across a final permission denial and rechecks before publishing", async () => {
    const f = fixture();
    const send = job();
    f.guard.mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(f.send(send)).rejects.toMatchObject({ code: "denied" });
    expect(f.calls.filter((call) => call.url.endsWith("/rest/posts"))).toHaveLength(0);
    expect((await f.send(send)).platformId).toBe("urn:li:ugcPost:98765");
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.calls.filter((call) => call.url.includes("/rest/images/"))).toHaveLength(4);
    expect(f.guard).toHaveBeenCalledTimes(2);
  });

  it("returns a checkpointed exact post receipt without another external submission", async () => {
    const f = fixture();
    const send = job();
    await f.send(send);
    const callCount = f.calls.length;
    expect((await f.send(send)).platformId).toBe("urn:li:ugcPost:98765");
    expect(f.calls).toHaveLength(callCount);
  });

  it.each(["actor", "caption", "alt", "order"] as const)(
    "rejects prepared state after changing %s",
    async (change) => {
      const f = fixture();
      const send = job(),
        a = account();
      await f.send(send);
      if (change === "actor") a.platformId = "urn:li:organization:5678";
      if (change === "caption") send.payload.text = "Changed";
      if (change === "alt") send.payload.media[0]!.alt = "Changed";
      if (change === "order") send.payload.media.reverse();
      const count = f.calls.length;
      await expect(f.send(send, a)).rejects.toMatchObject({ code: "rejected" });
      expect(f.calls).toHaveLength(count);
    },
  );

  it.each([{ owner: "urn:li:organization:9999" }, { imageId: "urn:li:image:other" }])(
    "rejects a readiness response for another actor or image",
    async (options) => {
      const f = fixture(options);
      await expect(f.send(job())).rejects.toMatchObject({ code: "denied" });
      expect(f.guard).not.toHaveBeenCalled();
      expect(f.calls.filter((call) => call.url.endsWith("/rest/posts"))).toHaveLength(0);
    },
  );

  it.each([null, "1234", "urn:li:comment:98765", "urn:li:share:bad"])(
    "holds a missing or invalid post receipt as unknown",
    async (postId) => {
      const f = fixture({ postId });
      await expect(f.send(job())).rejects.toMatchObject({ code: "unknown" });
      expect(f.calls.filter((call) => call.url.endsWith("/rest/posts"))).toHaveLength(1);
    },
  );

  it("rejects unsupported payloads and permissions before network calls", async () => {
    const f = fixture();
    const invalid = [job(1), job(5), job(), job(), job(), job(), job(), job()];
    invalid[2]!.payload.media[0]!.kind = "video";
    invalid[3]!.payload.media[0]!.url = "https://example.com/photo.png";
    invalid[4]!.payload.media[0]!.alt = "a".repeat(4087);
    invalid[5]!.payload.media[1]!.uploadId = "upload-0";
    invalid[6]!.payload.media[0]!.title = "Ignored title";
    invalid[7]!.payload.text = "a".repeat(3001);
    for (const send of invalid)
      await expect(f.send(send)).rejects.toMatchObject({ code: "unsupported" });
    const a = account();
    a.scopes = [];
    await expect(f.send(job(), a)).rejects.toMatchObject({ code: "denied" });
    a.accountType = "member";
    expect(linkedInMultiImageIssue(a, job())).toContain("organization");
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("validates bytes before registering the first image", async () => {
    const f = fixture();
    f.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
    await expect(f.send(job())).rejects.toMatchObject({ code: "rejected" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("retains signed-URL origin validation without forwarding credentials elsewhere", async () => {
    const f = fixture({ uploadUrl: "https://example.com/dms-uploads/photo" });
    await expect(f.send(job())).rejects.toMatchObject({ code: "denied" });
    expect(f.calls).toHaveLength(1);
    expect(f.guard).not.toHaveBeenCalled();
  });
});
