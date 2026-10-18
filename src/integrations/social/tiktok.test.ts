import { describe, expect, it, vi } from "vitest";
import type {
  SocialAccount,
  SocialJob,
  TikTokVideoOptions,
} from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import { createTikTokAdapter, tiktokContentIssue } from "./tiktok";
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
