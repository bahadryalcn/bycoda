import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp } from "../adapter";
import { createLinkedInAdapter } from "./linkedin";

const version = "202609";
const orgAccount = (
  scopes: string[] = [
    "w_organization_social",
    "r_organization_social_feed",
    "r_organization_social",
  ],
) =>
  ({
    id: "synthetic",
    platform: "linkedin",
    platformId: "urn:li:organization:123",
    name: "Bycoda",
    accountType: "organization",
    scopes,
    connected: true,
    accessApproved: true,
    connection: "api",
    paused: false,
    executorId: "synthetic-host",
    grants: {},
    createdAt: 1,
  }) as unknown as SocialAccount;
const memberAccount = () =>
  ({
    ...orgAccount(["w_member_social"]),
    accountType: "member",
    platformId: "urn:li:person:me",
  }) as unknown as SocialAccount;
const publishJob = (payload: Partial<SocialJob["payload"]> = {}) =>
  ({
    id: "job",
    kind: "publish",
    payload: { text: "A Bycoda update", media: [], ...payload },
    status: "running",
    attempts: 1,
  }) as unknown as SocialJob;
const pdf = () => new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF");
const json = (value: unknown) => Response.json(value);

describe("LinkedIn API adapter", () => {
  it("finalizes the exact ordered video parts and resumes processing before creating one post", async () => {
    const videoId = "urn:li:video:C123";
    const postId = "urn:li:ugcPost:999";
    const bytes = new Uint8Array(4 * 1024 * 1024 + 32);
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    bytes.set([42, 43], bytes.length - 2);
    const split = 4 * 1024 * 1024;
    const job = publishJob({ media: [{ kind: "video", uploadId: "local" }] });
    const beforeSubmit = vi.fn();
    const read = vi.fn(async () => bytes);
    let processing = true;
    const fetcher = vi.fn(async (raw: string | URL | Request, request?: RequestInit) => {
      const url = String(raw);
      if (url.includes("?action=initializeUpload")) {
        expect(JSON.parse(String(request?.body))).toEqual({
          initializeUploadRequest: {
            owner: "urn:li:person:me",
            fileSizeBytes: bytes.length,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        });
        return json({
          value: {
            video: videoId,
            uploadToken: "opaque-test-token",
            uploadUrlsExpireAt: Date.now() + 60_000,
            uploadInstructions: [
              {
                firstByte: 0,
                lastByte: split - 1,
                uploadUrl: "https://www.linkedin.com/dms-uploads/part1",
              },
              {
                firstByte: split,
                lastByte: 2 * split - 1,
                uploadUrl: "https://www.linkedin.com/dms-uploads/part2",
              },
            ],
          },
        });
      }
      if (url.includes("/dms-uploads/")) {
        const first = url.endsWith("part1");
        expect(request?.method).toBe("PUT");
        expect(new Headers(request?.headers).has("authorization")).toBe(false);
        const body = request?.body as Uint8Array;
        expect(body.byteLength).toBe(first ? split : 32);
        expect(body.at(-1)).toBe(first ? 0 : 43);
        return new Response(null, {
          headers: { ETag: first ? '"first-etag"' : "/ambry-videoei/signedId/second.bin" },
        });
      }
      if (url.includes("?action=finalizeUpload")) {
        expect(JSON.parse(String(request?.body))).toEqual({
          finalizeUploadRequest: {
            video: videoId,
            uploadToken: "opaque-test-token",
            uploadedPartIds: ["first-etag", "/ambry-videoei/signedId/second.bin"],
          },
        });
        return new Response(null, { headers: { "content-length": "0" } });
      }
      if (url.includes("/rest/videos/"))
        return json({
          id: videoId,
          owner: "urn:li:person:me",
          status: processing ? "PROCESSING" : "AVAILABLE",
        });
      expect(url).toBe("https://api.linkedin.com/rest/posts");
      expect(JSON.parse(String(request?.body)).content).toEqual({ media: { id: videoId } });
      expect(beforeSubmit).toHaveBeenCalledOnce();
      return new Response(null, { status: 201, headers: { "x-restli-id": postId } });
    });
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const save = vi.fn((preparation: NonNullable<SocialJob["preparation"]>) => {
      job.preparation = preparation;
    });
    await expect(
      adapter.send(memberAccount(), job, "t", read, save, beforeSubmit),
    ).rejects.toMatchObject({ code: "processing" });
    expect(job.preparation).toEqual({ mediaIds: [videoId] });
    expect(beforeSubmit).not.toHaveBeenCalled();
    processing = false;
    await expect(
      adapter.send(memberAccount(), job, "t", read, save, beforeSubmit),
    ).resolves.toMatchObject({ platformId: postId });
    expect(read).toHaveBeenCalledOnce();
    expect(
      fetcher.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/rest/posts")),
    ).toHaveLength(1);
  });

  it.each(["absent ETag", "invalid range"])(
    "never finalizes or publishes if multipart preparation has %s",
    async (failure) => {
      const bytes = new Uint8Array(80_000);
      bytes.set(new TextEncoder().encode("ftyp"), 4);
      const fetcher = vi.fn(async (raw: string | URL | Request) => {
        if (String(raw).endsWith("?action=initializeUpload")) {
          return json({
            value: {
              video: "urn:li:video:C123",
              uploadToken: "synthetic",
              uploadUrlsExpireAt: Date.now() + 60_000,
              uploadInstructions: [
                {
                  firstByte: failure === "invalid range" ? 1 : 0,
                  lastByte: bytes.length - 1,
                  uploadUrl: "https://www.linkedin.com/dms-uploads/part1",
                },
              ],
            },
          });
        }
        return new Response(null);
      });
      const checkpoint = vi.fn();
      const beforeSubmit = vi.fn();
      await expect(
        createLinkedInAdapter(new SocialHttp(fetcher), version).send(
          memberAccount(),
          publishJob({ media: [{ kind: "video", uploadId: "local" }] }),
          "t",
          async () => bytes,
          checkpoint,
          beforeSubmit,
        ),
      ).rejects.toMatchObject({ code: "unknown" });
      expect(fetcher).toHaveBeenCalledTimes(failure === "invalid range" ? 1 : 2);
      expect(checkpoint).not.toHaveBeenCalled();
      expect(beforeSubmit).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { kind: "poll", question: "Question?", options: ["First", "Second"], duration: "THREE_DAYS" },
      {
        poll: {
          question: "Question?",
          options: [{ text: "First" }, { text: "Second" }],
          settings: { duration: "THREE_DAYS" },
        },
      },
    ],
    [
      {
        kind: "article",
        source: "https://example.test/article",
        title: "Title",
        description: "Description",
      },
      {
        article: {
          source: "https://example.test/article",
          title: "Title",
          description: "Description",
        },
      },
    ],
  ] as const)("publishes the selected native Posts API content", async (format, content) => {
    const fetcher = vi.fn(async (_raw: string | URL | Request, request?: RequestInit) => {
      expect(JSON.parse(String(request?.body)).content).toEqual(content);
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
    });
    const linkedinFormat =
      format.kind === "poll" ? { ...format, options: [...format.options] } : format;
    await expect(
      createLinkedInAdapter(new SocialHttp(fetcher), version).send(
        memberAccount(),
        publishJob({ linkedinFormat }),
        "t",
        async () => new Uint8Array(),
      ),
    ).resolves.toMatchObject({ platformId: "urn:li:share:999" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: "poll", question: "?".repeat(141), options: ["First", "Second"], duration: "ONE_DAY" },
    { kind: "poll", question: "Question?", options: ["Same", "same"], duration: "ONE_DAY" },
    { kind: "article", source: "https://secret@example.test/article", title: "Title" },
    { kind: "article", source: "https://example.test/article", title: " " },
  ] satisfies NonNullable<SocialJob["payload"]["linkedinFormat"]>[])(
    "rejects invalid format before any provider call",
    async (linkedinFormat) => {
      const fetcher = vi.fn();
      await expect(
        createLinkedInAdapter(new SocialHttp(fetcher), version).send(
          memberAccount(),
          publishJob({ linkedinFormat }),
          "t",
          async () => new Uint8Array(),
        ),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("refuses commentary over the platform limit before any request", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ text: "x".repeat(3001) }),
        "t",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("assigns the member article attachment as an uploaded thumbnail with alt text", async () => {
    const image = "urn:li:image:safeThumbnail";
    const fetcher = vi.fn(async (raw: string | URL | Request, request?: RequestInit) => {
      const url = String(raw);
      if (url.includes("/rest/images?action=initializeUpload"))
        return json({ value: { image, uploadUrl: "https://www.linkedin.com/dms-uploads/image" } });
      if (url.includes("/dms-uploads/")) return new Response(null, { status: 201 });
      expect(url).toBe("https://api.linkedin.com/rest/posts");
      expect(JSON.parse(String(request?.body)).content).toEqual({
        article: {
          source: "https://example.test/article",
          title: "Title",
          thumbnail: image,
          thumbnailAltText: "A description",
        },
      });
      return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
    });
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const job = publishJob({
      linkedinFormat: { kind: "article", source: "https://example.test/article", title: "Title" },
      media: [{ kind: "image", uploadId: "local", alt: "A description" }],
    });
    await expect(
      adapter.send(
        memberAccount(),
        job,
        "t",
        async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    ).resolves.toMatchObject({ platformId: "urn:li:share:999" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a single image whose bytes are not PNG or JPEG before registering an upload", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ media: [{ kind: "image", uploadId: "local" }] } as Partial<
          SocialJob["payload"]
        >),
        "t",
        async () => new Uint8Array([1, 2, 3, 4]),
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([orgAccount(), memberAccount()])(
    "publishes a PDF through the Documents API and checkpoints the document",
    async (account) => {
      const calls: string[] = [];
      const fetcher = vi.fn(async (raw: string | URL | Request, request?: RequestInit) => {
        const url = String(raw);
        calls.push(url);
        if (url.includes("/rest/documents?action=initializeUpload")) {
          expect(JSON.parse(String(request?.body))).toEqual({
            initializeUploadRequest: { owner: account.platformId },
          });
          return json({
            value: {
              document: "urn:li:document:123",
              uploadUrl: "https://www.linkedin.com/dms-uploads/doc",
            },
          });
        }
        if (url.includes("/dms-uploads/")) return new Response(null, { status: 201 });
        if (url.includes("/rest/documents/"))
          return json({
            id: "urn:li:document:123",
            owner: account.platformId,
            status: "AVAILABLE",
          });
        return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } });
      });
      const checkpoint = vi.fn();
      const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
      const result = await adapter.send(
        account,
        publishJob({ media: [{ kind: "document", uploadId: "local", title: "Guide" }] } as Partial<
          SocialJob["payload"]
        >),
        "t",
        async () => pdf(),
        checkpoint,
      );
      expect(result.platformId).toBe("urn:li:share:999");
      expect(checkpoint).toHaveBeenCalledWith({ mediaIds: ["urn:li:document:123"] });
      const post = fetcher.mock.calls.find(([raw]) => String(raw).endsWith("/rest/posts"));
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
        content: { media: { id: "urn:li:document:123", title: "Guide" } },
      });
    },
  );

  it("refuses a PDF title with a line break before any request", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.send(
        orgAccount(),
        publishJob({ media: [{ kind: "document", uploadId: "local", title: "a\nb" }] } as Partial<
          SocialJob["payload"]
        >),
        "t",
        async () => pdf(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("collects organization post commenters with the actor URN and a next cursor", async () => {
    const fetcher = vi.fn(async () =>
      json({
        elements: Array.from({ length: 100 }, (_, index) => ({
          actor: `urn:li:person:p${index}`,
          commentUrn: `urn:li:comment:(urn:li:share:999,${index})`,
          created: { time: 1790000000000 },
        })),
        paging: { total: 150 },
      }),
    );
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const page = await adapter.collectAudience!(orgAccount(), "t", {
      kind: "own_post_comments",
      accountId: "synthetic",
      postRef: "urn:li:share:999",
    });
    expect(page.people).toHaveLength(100);
    expect(page.people[0]).toMatchObject({
      platformId: "urn:li:person:p0",
      kind: "comment",
      at: 1790000000000,
    });
    expect(page.next).toBe("100");
  });

  it("collects reactors of the owner's post as like interactions", async () => {
    const fetcher = vi.fn(async () =>
      json({
        elements: [{ actor: "urn:li:person:liker", created: { time: 1790000000000 } }],
        paging: { total: 1 },
      }),
    );
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    const page = await adapter.collectAudience!(orgAccount(), "t", {
      kind: "own_post_likes",
      accountId: "synthetic",
      postRef: "urn:li:share:999",
    });
    expect(page.people).toEqual([
      {
        platformId: "urn:li:person:liker",
        name: "urn:li:person:liker",
        kind: "like",
        ref: "urn:li:share:999",
        at: 1790000000000,
      },
    ]);
    expect(page.next).toBeUndefined();
  });

  it("refuses audience sources it does not implement and member accounts", async () => {
    const fetcher = vi.fn();
    const adapter = createLinkedInAdapter(new SocialHttp(fetcher), version);
    await expect(
      adapter.collectAudience!(orgAccount(), "t", { kind: "mentions", accountId: "synthetic" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      adapter.collectAudience!(memberAccount(), "t", {
        kind: "own_post_likes",
        accountId: "synthetic",
        postRef: "urn:li:share:999",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
