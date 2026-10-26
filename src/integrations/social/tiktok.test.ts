import { describe, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialJob,
  TikTokVideoOptions,
} from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import { createTikTokAdapter, parseTikTokOptions, tiktokContentIssue } from "./tiktok";
import { contentSupport } from "./platformAdapters";
import { accountCapabilities } from "./capabilities";
const account: SocialAccount = {
  id: "a",
  platform: "tiktok",
  platformId: "creator",
  name: "Owner",
  accountType: "member",
  scopes: ["user.info.basic", "video.publish"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};
const options: TikTokVideoOptions = {
  privacy: "SELF_ONLY",
  durationSeconds: 30,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: true,
  consent: true,
};
const creator = {
  creator_nickname: "Owner",
  privacy_level_options: ["SELF_ONLY"],
  comment_disabled: true,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 60,
};
const job = (): SocialJob => ({
  id: "j",
  operationId: "o",
  dedupeKey: "d",
  accountId: "a",
  projectIds: ["p"],
  provider: "owner",
  actorId: "owner",
  kind: "publish",
  payload: {
    text: "Caption",
    media: [{ kind: "video", url: "https://verified.example/video.mp4" }],
    tiktok: { ...options },
  },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
const response = (data: unknown) => Response.json({ data, error: { code: "ok" } });
function fixture() {
  let complete = false;
  const fetcher = vi.fn(async (raw: unknown, _options?: RequestInit) => {
    const path = new URL(String(raw)).pathname;
    if (path.includes("user/info")) return response({ user: { open_id: "creator" } });
    if (path.includes("creator_info")) return response(creator);
    if (path.includes("video/init")) return response({ publish_id: "v_pub~123" });
    if (path.includes("content/init")) return response({ publish_id: "p_pub~123" });
    if (path.includes("status/fetch"))
      return response({
        status: complete ? "PUBLISH_COMPLETE" : "PROCESSING_DOWNLOAD",
        publicaly_available_post_id: [],
      });
    throw new Error("Unexpected network target");
  });
  return {
    adapter: createTikTokAdapter(new SocialHttp(fetcher), () => 1000),
    fetcher,
    complete: () => {
      complete = true;
    },
  };
}
describe("TikTok Direct Post", () => {
  const photoJob = (): SocialJob => ({
    ...job(),
    payload: {
      ...job().payload,
      media: [
        { kind: "image", url: "https://verified.example/one.jpg" },
        { kind: "image", url: "https://verified.example/two.png" },
      ],
      tiktok: {
        ...options,
        mediaType: "photo",
        durationSeconds: 0,
        photoTitle: "A workflow",
        photoCoverIndex: 1,
        autoAddMusic: false,
      },
    },
  });
  it("posts photos with an explicit cover/music choice and durably checkpoints before polling", async () => {
    const s = fixture(),
      j = photoJob();
    expect(contentSupport(account, j)).toBeUndefined();
    let release!: () => void;
    const checkpoint = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = s.adapter.send(account, j, "secret", async () => new Uint8Array(), checkpoint);
    const completion = expect(pending).rejects.toMatchObject({ code: "processing" });
    await vi.waitFor(() =>
      expect(checkpoint).toHaveBeenCalledWith({ tiktokPublishId: "p_pub~123" }),
    );
    expect(s.fetcher.mock.calls.some(([url]) => String(url).includes("status/fetch"))).toBe(false);
    release();
    await completion;
    const create = s.fetcher.mock.calls.find(([url]) => String(url).includes("content/init"))!;
    expect(JSON.parse(create[1]!.body as string)).toEqual({
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      is_aigc: true,
      post_info: {
        title: "A workflow",
        description: "Caption",
        privacy_level: "SELF_ONLY",
        disable_comment: true,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 1,
        photo_images: ["https://verified.example/one.jpg", "https://verified.example/two.png"],
      },
    });
    s.complete();
    expect(
      await s.adapter.send(account, j, "secret", async () => new Uint8Array(), checkpoint),
    ).toEqual({
      platformId: "p_pub~123",
      visibility: "private",
    });
    expect(
      s.fetcher.mock.calls.filter(([url]) => String(url).includes("content/init")),
    ).toHaveLength(1);
    expect(
      s.fetcher.mock.calls.filter(([url]) => String(url).includes("creator_info")),
    ).toHaveLength(1);
  });
  it("parses photo options without requiring fictitious video duration or video-only interaction flags", () => {
    const value = { ...photoJob().payload.tiktok } as Record<string, unknown>;
    delete value.durationSeconds;
    delete value.allowDuet;
    delete value.allowStitch;
    expect(parseTikTokOptions(value)).toMatchObject({
      mediaType: "photo",
      durationSeconds: 0,
      allowDuet: false,
      allowStitch: false,
    });
    expect(() => parseTikTokOptions({ ...value, photoCoverIndex: 0.5 })).toThrow();
    expect(() => parseTikTokOptions({ ...value, autoAddMusic: undefined })).toThrow();
  });
  it.each(["photo", "video"])(
    "rechecks host permission after creator queries before %s initialization",
    async (type) => {
      const s = fixture();
      const beforeSubmit = vi.fn(async () => {
        throw new Error("Stopped");
      });
      await expect(
        s.adapter.send(
          account,
          type === "photo" ? photoJob() : job(),
          "secret",
          async () => new Uint8Array(),
          undefined,
          beforeSubmit,
        ),
      ).rejects.toThrow("Stopped");
      expect(beforeSubmit).toHaveBeenCalledExactlyOnceWith();
      expect(s.fetcher.mock.calls.some(([url]) => String(url).includes("/init/"))).toBe(false);
    },
  );
  it("rejects mixed media, unverified transport, invalid cover and oversize photo metadata before any request", async () => {
    const invalid: SocialJob[] = [];
    for (const patch of [
      { photoCoverIndex: 2 },
      { photoTitle: "x".repeat(91) },
      { allowDuet: true },
      { consent: false },
    ]) {
      const j = photoJob();
      j.payload.tiktok = { ...j.payload.tiktok!, ...patch };
      invalid.push(j);
    }
    for (const media of [
      [{ kind: "image" as const, url: "http://verified.example/one.jpg" }],
      [{ kind: "image" as const, url: "https://user:pass@verified.example/one.jpg" }],
      [{ kind: "image" as const, uploadId: "local" }],
      [{ kind: "video" as const, url: "https://verified.example/video.mp4" }],
      Array.from({ length: 5 }, () => ({
        kind: "image" as const,
        url: "https://verified.example/one.jpg",
      })),
    ]) {
      const j = photoJob();
      j.payload.media = media;
      invalid.push(j);
    }
    const tooLong = photoJob();
    tooLong.payload.text = "x".repeat(4001);
    invalid.push(tooLong);
    const s = fixture();
    for (const j of invalid) {
      expect(tiktokContentIssue(j)).toBeTruthy();
      await expect(
        s.adapter.send(account, j, "secret", async () => new Uint8Array()),
      ).rejects.toMatchObject({ code: "unsupported" });
    }
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("checkpoints an accepted publication and polls the same ID without publishing twice", async () => {
    const s = fixture(),
      j = job(),
      checkpoint = vi.fn();
    expect(contentSupport(account, j)).toBeUndefined();
    await expect(
      s.adapter.send(account, j, "secret", async () => new Uint8Array(), checkpoint),
    ).rejects.toMatchObject({ code: "processing", retryAt: 31000 });
    expect(checkpoint).toHaveBeenCalledWith({ tiktokPublishId: "v_pub~123" });
    const create = s.fetcher.mock.calls.find(([url]) => String(url).includes("video/init"))!;
    expect(JSON.parse(create[1]!.body as string)).toMatchObject({
      post_info: { privacy_level: "SELF_ONLY", disable_comment: true, is_aigc: true },
      source_info: { source: "PULL_FROM_URL" },
    });
    s.complete();
    expect(
      await s.adapter.send(account, j, "secret", async () => new Uint8Array(), checkpoint),
    ).toEqual({ platformId: "v_pub~123", visibility: "private" });
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes("video/init"))).toHaveLength(
      1,
    );
  });
  it.each([{ privacy: "PUBLIC_TO_EVERYONE" }, { durationSeconds: 61 }, { allowComment: true }])(
    "revalidates creator restrictions before posting: %j",
    async (patch) => {
      const s = fixture(),
        j = job();
      j.payload.tiktok = { ...options, ...patch };
      await expect(
        s.adapter.send(account, j, "secret", async () => new Uint8Array()),
      ).rejects.toMatchObject({ code: "denied" });
      expect(s.fetcher.mock.calls.some(([url]) => String(url).includes("video/init"))).toBe(false);
    },
  );
  it("requires visibility, preview duration and music consent, and rejects private branded content", () => {
    for (const patch of [
      { privacy: "" },
      { consent: false },
      { durationSeconds: 0 },
      { brandContent: true },
    ]) {
      const j = job();
      j.payload.tiktok = { ...options, ...patch };
      expect(tiktokContentIssue(j)).toBeTruthy();
    }
    const j = job();
    j.payload.text = "x".repeat(2201);
    expect(tiktokContentIssue(j)).toContain("2200");
  });
  it("an uncertain initialization does not silently retry and unsupported DMs never reach the network", async () => {
    const s = fixture();
    s.fetcher.mockImplementation(async (raw) =>
      String(raw).includes("user/info")
        ? response({ user: { open_id: "creator" } })
        : String(raw).includes("creator_info")
          ? response(creator)
          : response({}),
    );
    await expect(
      s.adapter.send(account, job(), "secret", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "unknown" });
    const count = s.fetcher.mock.calls.length,
      dm = job();
    dm.kind = "message";
    await expect(
      s.adapter.send(account, dm, "secret", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(s.fetcher).toHaveBeenCalledTimes(count);
  });
  it("personal-account DMs and comment reads stay unsupported while video posting has its own scope gate", () => {
    for (const operation of ["comments.read", "inbox.read", "message.reply", "message.start"])
      expect(accountCapabilities(account).find((c) => c.operation === operation)?.status).toBe(
        "unsupported",
      );
    expect(
      accountCapabilities({ ...account, scopes: ["user.info.basic"] }).find(
        (c) => c.operation === "publish",
      )?.status,
    ).toBe("pending");
  });
});
