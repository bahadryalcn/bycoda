import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob, SocialMedia } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "./adapter";
import { metaPublishingIssue, publishMetaMedia } from "./metaMedia";

const now = 1_800_000_000_000;
const account = (platform: "instagram" | "facebook"): SocialAccount => ({
  id: "account",
  platform,
  platformId: "123",
  name: "Owner",
  accountType: platform === "instagram" ? "professional" : "page",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const image = (n = 1): SocialMedia => ({ kind: "image", url: `https://cdn.test/${n}.jpg` });
const video = (): SocialMedia => ({ kind: "video", url: "https://cdn.test/video.mp4" });
const job = (media: SocialMedia[] = [image()]): SocialJob => ({
  id: "job",
  operationId: "op",
  accountId: "account",
  projectIds: [],
  actorId: "owner",
  provider: "owner",
  dedupeKey: "key",
  kind: "publish",
  payload: { text: "Exact caption", link: "https://bycoda.test", media },
  status: "running",
  scheduledAt: now,
  attempts: 1,
  createdAt: now,
});
type Call = { path: string; method: string; body?: Record<string, any> };
function api(
  handler?: (call: Call, index: number) => Record<string, unknown> | Response | undefined,
) {
  const calls: Call[] = [];
  let nextId = 0;
  const fetcher = vi.fn(async (raw: string | URL | Request, options?: RequestInit) => {
    const parsed = new URL(String(raw));
    const call: Call = {
      path: parsed.pathname,
      method: options?.method ?? "GET",
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
    };
    calls.push(call);
    const custom = handler?.(call, calls.length - 1);
    if (custom instanceof Response) return custom;
    if (custom) return Response.json(custom);
    if (call.path.endsWith("/media")) return Response.json({ id: `container${++nextId}` });
    if (call.path.endsWith("/media_publish")) return Response.json({ id: "published" });
    if (call.path.endsWith("/photos")) return Response.json({ id: `photo${++nextId}` });
    if (call.path.endsWith("/feed")) return Response.json({ id: "123_post" });
    if (call.path.endsWith("/published"))
      return Response.json({ permalink: "https://www.instagram.com/p/created/" });
    return Response.json({ status_code: "FINISHED" });
  });
  return { calls, fetcher, http: new SocialHttp(fetcher) };
}
const send = (
  mock: ReturnType<typeof api>,
  platform: "instagram" | "facebook",
  publish: SocialJob,
  checkpoint?: (state: NonNullable<SocialJob["preparation"]>) => void | Promise<void>,
  guard?: () => Promise<void>,
  time = () => now,
) =>
  publishMetaMedia(
    mock.http,
    platform,
    account(platform),
    publish,
    "synthetic",
    "v25.0",
    checkpoint,
    guard,
    time,
  );

describe("Meta public media publication", () => {
  it("creates a Reel and waits for its container before one guarded publish", async () => {
    const mock = api();
    const publish = job([video()]);
    const guard = vi.fn(async () => {
      expect(mock.calls.at(-1)?.method).toBe("GET");
      expect(mock.calls.at(-1)?.path).toBe("/v25.0/container1");
    });
    expect(await send(mock, "instagram", publish, undefined, guard)).toEqual({
      platformId: "published",
      url: "https://www.instagram.com/p/created/",
    });
    expect(mock.calls[0].body).toEqual({
      media_type: "REELS",
      video_url: "https://cdn.test/video.mp4",
      share_to_feed: true,
      caption: "Exact caption\nhttps://bycoda.test",
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(publish.preparation?.metaMedia?.publishedId).toBe("published");
    expect(publish.preparation?.metaMedia?.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps carousel item order and alt text and captions only the parent", async () => {
    const mock = api();
    const publish = job([{ ...image(), alt: "First image" }, video(), image(2)]);
    await send(mock, "instagram", publish);
    const creates = mock.calls.filter((call) => call.path.endsWith("/media"));
    expect(creates.map((call) => call.body)).toEqual([
      { image_url: "https://cdn.test/1.jpg", alt_text: "First image", is_carousel_item: true },
      { media_type: "VIDEO", video_url: "https://cdn.test/video.mp4", is_carousel_item: true },
      { image_url: "https://cdn.test/2.jpg", is_carousel_item: true },
      {
        media_type: "CAROUSEL",
        children: ["container1", "container2", "container3"],
        caption: "Exact caption\nhttps://bycoda.test",
      },
    ]);
    expect(publish.preparation?.mediaIds).toEqual(["container1", "container2", "container3"]);
    expect(publish.preparation?.containerId).toBe("container4");
  });

  it("resumes a processing carousel child without recreating or prematurely creating its parent", async () => {
    let ready = false;
    const mock = api((call) =>
      call.path === "/v25.0/container1"
        ? { status_code: ready ? "FINISHED" : "IN_PROGRESS" }
        : undefined,
    );
    const publish = job([video(), image()]);
    await expect(send(mock, "instagram", publish)).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: now + 60_000,
    });
    expect(mock.calls.filter((call) => call.path.endsWith("/media"))).toHaveLength(1);
    expect(publish.preparation?.mediaIds).toEqual(["container1"]);
    ready = true;
    await send(mock, "instagram", publish);
    expect(mock.calls.filter((call) => call.path.endsWith("/media"))).toHaveLength(3);
    expect(mock.calls.filter((call) => call.path.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("awaits child durability before preparing the next item", async () => {
    const mock = api();
    const publish = job([image(), image(2)]);
    let unblock!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const saving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const checkpoint = vi.fn(async (state: NonNullable<SocialJob["preparation"]>) => {
      if (state.mediaIds?.length === 1 && !state.containerId) {
        entered();
        await held;
      }
    });
    const result = send(mock, "instagram", publish, checkpoint);
    await saving;
    expect(mock.calls).toHaveLength(1);
    unblock();
    await result;
    expect(mock.calls.filter((call) => call.path.endsWith("/media_publish"))).toHaveLength(1);
  });

  it.each(["instagram", "facebook"] as const)(
    "retains %s preparation when final authority is denied",
    async (platform) => {
      const mock = api();
      const publish = job([image(), image(2)]);
      await expect(
        send(mock, platform, publish, undefined, async () => {
          throw new SocialPlatformError("denied");
        }),
      ).rejects.toMatchObject({ code: "denied" });
      expect(mock.calls.some((call) => /\/(?:feed|media_publish)$/.test(call.path))).toBe(false);
      const preparedCount = mock.calls.filter((call) =>
        /\/(?:media|photos)$/.test(call.path),
      ).length;
      await send(mock, platform, publish);
      expect(mock.calls.filter((call) => /\/(?:media|photos)$/.test(call.path))).toHaveLength(
        preparedCount,
      );
    },
  );

  it("uploads Facebook photos unpublished with alt text before creating one attached-media post", async () => {
    const mock = api();
    const publish = job([{ ...image(), alt: "First image" }, image(2)]);
    expect(await send(mock, "facebook", publish)).toEqual({
      platformId: "123_post",
      url: "https://www.facebook.com/123_post",
    });
    expect(mock.calls.map((call) => call.body)).toEqual([
      { url: "https://cdn.test/1.jpg", published: false, alt_text_custom: "First image" },
      { url: "https://cdn.test/2.jpg", published: false },
      {
        message: "Exact caption\nhttps://bycoda.test",
        attached_media: [{ media_fbid: "photo1" }, { media_fbid: "photo2" }],
      },
    ]);
  });

  it("retains the first Facebook photo after a later preparation error", async () => {
    let failed = false;
    const mock = api((call) => {
      if (call.body?.url === "https://cdn.test/2.jpg" && !failed) {
        failed = true;
        return new Response("", { status: 503 });
      }
    });
    const publish = job([image(), image(2)]);
    await expect(send(mock, "facebook", publish)).rejects.toMatchObject({ code: "unknown" });
    expect(publish.preparation?.mediaIds).toEqual(["photo1"]);
    await send(mock, "facebook", publish);
    expect(mock.calls.filter((call) => call.body?.url === "https://cdn.test/1.jpg")).toHaveLength(
      1,
    );
    expect(mock.calls.filter((call) => call.path.endsWith("/feed"))).toHaveLength(1);
  });

  it.each(["instagram", "facebook"] as const)(
    "reuses a known %s publish receipt without resubmission",
    async (platform) => {
      const mock = api();
      const publish = job(platform === "instagram" ? [video()] : [image(), image(2)]);
      await send(mock, platform, publish);
      const count = mock.calls.filter((call) => call.method === "POST").length;
      const guard = vi.fn(async () => {});
      await send(mock, platform, publish, undefined, guard, () => now + 30 * 60 * 60_000);
      expect(mock.calls.filter((call) => call.method === "POST")).toHaveLength(count);
      expect(guard).not.toHaveBeenCalled();
    },
  );

  it("preserves a legacy single-image Instagram container checkpoint", async () => {
    const mock = api();
    const publish = job();
    publish.preparation = { containerId: "legacy" };
    await send(mock, "instagram", publish);
    expect(mock.calls.some((call) => call.path.endsWith("/media"))).toBe(false);
    expect(mock.calls.find((call) => call.path.endsWith("/media_publish"))?.body).toEqual({
      creation_id: "legacy",
    });
  });

  it("does not reinterpret an unbound legacy container as video or an unbound photo list as carousel", async () => {
    const mock = api();
    const reel = job([video()]);
    reel.preparation = { containerId: "legacy" };
    await expect(send(mock, "instagram", reel)).rejects.toMatchObject({ code: "unknown" });
    const carousel = job([image(), image(2)]);
    carousel.preparation = { mediaIds: ["legacy"] };
    await expect(send(mock, "instagram", carousel)).rejects.toMatchObject({ code: "unknown" });
    expect(mock.calls).toHaveLength(0);
  });

  it.each(["ERROR", "EXPIRED", "PUBLISHED", "MYSTERY", undefined])(
    "never publishes a container with status %s",
    async (status_code) => {
      const mock = api((call) => (call.method === "GET" ? { status_code } : undefined));
      const publish = job([video()]);
      await expect(send(mock, "instagram", publish)).rejects.toMatchObject({
        code: ["ERROR", "EXPIRED"].includes(status_code ?? "") ? "rejected" : "unknown",
      });
      expect(mock.calls.some((call) => call.path.endsWith("/media_publish"))).toBe(false);
    },
  );

  it.each(["caption", "actor", "platform", "expired", "future"])(
    "refuses unsafe checkpoint reuse after %s changes",
    async (change) => {
      const mock = api();
      const publish = job([video()]);
      await expect(
        send(mock, "instagram", publish, undefined, async () => {
          throw new SocialPlatformError("denied");
        }),
      ).rejects.toMatchObject({ code: "denied" });
      if (change === "caption") publish.payload.text = "Changed";
      if (change === "actor") publish.preparation!.metaMedia!.actorId = "456";
      if (change === "platform") publish.preparation!.metaMedia!.platform = "facebook";
      if (change === "expired") publish.preparation!.metaMedia!.startedAt = now - 24 * 60 * 60_000;
      if (change === "future") publish.preparation!.metaMedia!.startedAt = now + 6 * 60_000;
      const before = mock.calls.length;
      await expect(send(mock, "instagram", publish)).rejects.toMatchObject({
        code: change === "expired" ? "rejected" : "denied",
      });
      expect(mock.calls).toHaveLength(before);
    },
  );

  it("holds an absent final ID and a lost durable final receipt as unknown", async () => {
    const mock = api((call) => (call.path.endsWith("/feed") ? { success: true } : undefined));
    await expect(send(mock, "facebook", job([image(), image(2)]))).rejects.toMatchObject({
      code: "unknown",
    });
    const mock2 = api();
    const publish = job([video()]);
    await expect(
      send(mock2, "instagram", publish, (state) => {
        if (state.metaMedia?.publishedId) throw new Error("Storage failed");
      }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(mock2.calls.filter((call) => call.path.endsWith("/media_publish"))).toHaveLength(1);
  });

  it("ignores an untrusted permalink without turning confirmed publication into another send", async () => {
    const mock = api((call) =>
      call.path.endsWith("/published") ? { permalink: "https://attacker.test/" } : undefined,
    );
    expect(await send(mock, "instagram", job([video()]))).toEqual({
      platformId: "published",
      url: undefined,
    });
  });
});

describe("Meta media content validation", () => {
  it.each([
    { kind: "document", url: "https://cdn.test/file.pdf" },
    { kind: "image", url: "http://cdn.test/file.jpg" },
    { kind: "image", url: "https://user:password@cdn.test/file.jpg" },
    { kind: "image", url: "https://cdn.test/file.jpg#fragment" },
    { kind: "image", uploadId: "upload" },
    { kind: "image", url: "https://cdn.test/file.jpg", uploadId: "upload" },
    { kind: "video", url: "https://cdn.test/file.mp4", alt: "Unapplied alt" },
  ] as SocialMedia[])("rejects unsupported media before network: %j", async (item) => {
    const mock = api();
    const publish = job([item]);
    expect(metaPublishingIssue("instagram", publish)).toBeTruthy();
    await expect(send(mock, "instagram", publish)).rejects.toMatchObject({ code: "unsupported" });
    expect(mock.calls).toHaveLength(0);
  });
  it("checks media count, image alternative text, caption length and Facebook video limits", () => {
    expect(metaPublishingIssue("instagram", job([]))).toBeTruthy();
    expect(
      metaPublishingIssue("instagram", job(Array.from({ length: 5 }, (_, n) => image(n)))),
    ).toBeTruthy();
    expect(
      metaPublishingIssue("instagram", job([{ ...image(), alt: "a".repeat(1001) }])),
    ).toBeTruthy();
    const publish = job();
    publish.payload.text = "a".repeat(2201);
    expect(metaPublishingIssue("instagram", publish)).toBeTruthy();
    expect(metaPublishingIssue("facebook", job([video()]))).toBeTruthy();
    expect(metaPublishingIssue("facebook", job([]))).toBeUndefined();
  });
  it("rejects browser and mismatched accounts before preparing media", async () => {
    const mock = api();
    const own = account("instagram");
    own.connection = "browser";
    await expect(
      publishMetaMedia(mock.http, "instagram", own, job(), "synthetic", "v25.0"),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(
      publishMetaMedia(mock.http, "facebook", account("instagram"), job(), "synthetic", "v25.0"),
    ).rejects.toMatchObject({ code: "denied" });
    expect(mock.calls).toHaveLength(0);
  });
});
