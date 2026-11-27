import { describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError, type SocialAccount, type SocialJob } from "../adapter";
import { createFacebookPublishing } from "./facebook-publishing";
import { facebookScheduleTime, updateFacebookPost } from "./facebook-schedule";

const now = 1_800_000_000_000;
const account: SocialAccount = {
  id: "page",
  platform: "facebook",
  platformId: "123",
  name: "Page",
  accountType: "page",
  connection: "oauth",
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "host",
  scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
  grants: {},
  createdAt: now,
};
const mp4 = Uint8Array.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
const readVideo = async () => mp4;

function job(payload: SocialJob["payload"]): SocialJob {
  return {
    id: "job",
    operationId: "op",
    dedupeKey: "key",
    accountId: account.id,
    projectIds: [],
    actorId: "owner",
    provider: "owner",
    kind: "publish",
    payload,
    createdAt: now,
    scheduledAt: now,
    status: "running",
    attempts: 1,
  };
}

function fixture(handler: (url: URL, options?: RequestInit) => Response) {
  const fetcher = vi.fn(async (raw: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(raw));
    return url.pathname.endsWith("/me") ? Response.json({ id: "123" }) : handler(url, options);
  });
  const http = new SocialHttp(fetcher, () => now);
  return { fetcher, http, adapter: createFacebookPublishing(http, "v25.0", () => now) };
}

describe("Facebook Page publishing", () => {
  it("checkpoints an ordinary video ID then only reads it while processing", async () => {
    let ready = false;
    const submit = vi.fn();
    const f = fixture((url, options) => {
      if (url.hostname === "graph-video.facebook.com") {
        submit(options?.body);
        return Response.json({ id: "456" });
      }
      expect(url.pathname).toBe("/v25.0/456");
      return Response.json({
        id: "456",
        from: { id: "123" },
        published: ready,
        status: { video_status: ready ? "ready" : "processing" },
      });
    });
    const item = job({
      facebook: { target: "video" },
      text: "Caption",
      media: [{ kind: "video", uploadId: "file" }],
    });
    const checkpoint = vi.fn();
    await expect(
      f.adapter.send(account, item, "token", readVideo, checkpoint),
    ).rejects.toMatchObject({ code: "processing" });
    expect(checkpoint.mock.calls.map(([state]) => state.facebookMedia?.mediaId)).toEqual([
      undefined,
      "456",
    ]);
    ready = true;
    await expect(
      f.adapter.send(account, item, "token", readVideo, checkpoint),
    ).resolves.toMatchObject({ platformId: "456" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].get("source").type).toBe("video/mp4");
    expect(submit.mock.calls[0][0].get("description")).toBe("Caption");
  });

  it("does not repeat an ordinary video submit with an unknown outcome", async () => {
    const submit = vi.fn(() => new Response(null, { status: 503 }));
    const f = fixture(submit);
    const item = job({
      facebook: { target: "video" },
      text: "",
      media: [{ kind: "video", url: "https://cdn.example/video.mp4" }],
    });
    await expect(f.adapter.send(account, item, "token", readVideo)).rejects.toMatchObject({
      code: "unknown",
    });
    await expect(f.adapter.send(account, item, "token", readVideo)).rejects.toMatchObject({
      code: "unknown",
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("uploads a photo without publishing it, then posts that photo as a Story", async () => {
    const submit = vi.fn();
    const f = fixture((url, options) => {
      submit(url.pathname, JSON.parse(String(options?.body)));
      return url.pathname.endsWith("/photos")
        ? Response.json({ id: "456" })
        : Response.json({ success: true, post_id: 789 });
    });
    const item = job({
      facebook: { target: "story" },
      text: "",
      media: [{ kind: "image", url: "https://cdn.example/cover.jpg" }],
    });
    await expect(f.adapter.send(account, item, "token", readVideo)).resolves.toEqual({
      platformId: "789",
    });
    await expect(f.adapter.reconcile!(account, item, "token")).resolves.toEqual({
      platformId: "789",
    });
    expect(submit.mock.calls).toEqual([
      ["/v25.0/123/photos", { url: "https://cdn.example/cover.jpg", published: false }],
      ["/v25.0/123/photo_stories", { photo_id: "456" }],
    ]);
  });

  it("reconciles an uncertain video Story finish by exact media ID without a second POST", async () => {
    const finish = vi.fn();
    const f = fixture((url, options) => {
      if (url.hostname === "rupload.facebook.com") return Response.json({ success: true });
      if (url.pathname.endsWith("/123/stories"))
        return Response.json({
          data: [
            { status: "PUBLISHED", media_type: "video", media_id: "4567", post_id: "888" },
            { status: "PUBLISHED", media_type: "video", media_id: "456", post_id: "789" },
          ],
        });
      const body = JSON.parse(String(options?.body));
      if (body.upload_phase === "start")
        return Response.json({
          video_id: "456",
          upload_url: "https://rupload.facebook.com/video-upload/v25.0/456",
        });
      finish(body);
      return new Response(null, { status: 503 });
    });
    const item = job({
      facebook: { target: "story" },
      text: "",
      media: [{ kind: "video", uploadId: "file" }],
    });
    await expect(f.adapter.send(account, item, "token", readVideo)).rejects.toMatchObject({
      code: "unknown",
    });
    await expect(f.adapter.reconcile!(account, item, "token")).resolves.toEqual({
      platformId: "789",
    });
    expect(finish).toHaveBeenCalledExactlyOnceWith({ video_id: "456", upload_phase: "finish" });
  });

  it("submits native scheduling settings and refuses invalid times before a write", async () => {
    const submit = vi.fn();
    const f = fixture((url, options) => {
      submit(url.pathname, JSON.parse(String(options?.body)));
      return Response.json({ id: "123_456" });
    });
    const scheduledPublishAt = now + 20 * 60_000;
    const item = job({
      facebook: { target: "feed", scheduledPublishAt },
      text: "Later",
      media: [],
    });
    await expect(f.adapter.send(account, item, "token", readVideo)).resolves.toEqual({
      platformId: "123_456",
    });
    await expect(
      f.adapter.send(
        account,
        job({ ...item.payload, facebook: { target: "feed", scheduledPublishAt: now } }),
        "token",
        readVideo,
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(submit).toHaveBeenCalledExactlyOnceWith("/v25.0/123/feed", {
      message: "Later",
      published: false,
      scheduled_publish_time: scheduledPublishAt / 1000,
    });
    expect(facebookScheduleTime(now + 10 * 60_000, now)).toBe((now + 10 * 60_000) / 1000);
    expect(facebookScheduleTime(now + 75 * 86_400_000 + 1_000, now)).toBeUndefined();
  });

  it("updates the exact Page-owned post only after submission authority is checked", async () => {
    const submit = vi.fn();
    const f = fixture((url, options) => {
      expect(url.pathname).toBe("/v25.0/123_456");
      if (options?.method !== "POST") return Response.json({ id: "123_456", from: { id: "123" } });
      submit(JSON.parse(String(options.body)));
      return Response.json({ success: true });
    });
    const edit = (id: string, beforeSubmit?: () => Promise<void>) =>
      updateFacebookPost(f.http, "v25.0", account, "token", id, "Edited", beforeSubmit);
    await expect(edit("234_456")).rejects.toMatchObject({ code: "denied" });
    await expect(
      edit("123_456", async () => {
        throw new SocialPlatformError("denied");
      }),
    ).rejects.toMatchObject({ code: "denied" });
    await edit("123_456");
    expect(submit).toHaveBeenCalledExactlyOnceWith({ message: "Edited" });
  });
});
