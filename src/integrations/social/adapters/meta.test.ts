import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../adapter";
import { createSocialAdapters } from "../platformAdapters";
import { metaCommentAction } from "./meta-extended";

const account = (platform: "facebook" | "instagram"): SocialAccount => ({
  id: "account",
  platform,
  platformId: platform === "facebook" ? "111" : "17841",
  name: "Account",
  accountType: platform === "facebook" ? "page" : "professional",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
const job = (kind: SocialJob["kind"] = "publish"): SocialJob => ({
  id: "job",
  operationId: "op",
  dedupeKey: "key",
  accountId: "account",
  projectIds: ["project"],
  provider: "owner",
  actorId: "device",
  kind,
  payload: { text: "Public text", media: [] },
  status: "running",
  scheduledAt: 1,
  attempts: 1,
  createdAt: 1,
});
/** replyUntil is recorded by the host on the thread and copied onto the job payload when present. */
const withWindow = (value: SocialJob, replyUntil: number) =>
  Object.assign(value.payload, { replyUntil });
const json = (value: unknown) => Response.json(value);
const calls = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls.map(([raw, init]) => ({
    url: new URL(String(raw)),
    method: (init as RequestInit | undefined)?.method ?? "GET",
    body: (init as RequestInit | undefined)?.body,
  }));

describe("Meta adapter contracts (mocked Graph)", () => {
  it("deletes a Facebook post with one DELETE edge call and maps a refusal to unknown", async () => {
    const fetcher = vi.fn(async () => json({ success: true }));
    const adapters = createSocialAdapters(new SocialHttp(fetcher));
    await adapters.facebook.deletePost!(account("facebook"), "synthetic", "post_1");
    expect(calls(fetcher)).toMatchObject([
      { url: { href: "https://graph.facebook.com/v25.0/post_1" }, method: "DELETE" },
    ]);
    const refused = vi.fn(async () => json({ success: false }));
    await expect(
      createSocialAdapters(new SocialHttp(refused)).facebook.deletePost!(
        account("facebook"),
        "synthetic",
        "post_1",
      ),
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("exposes no Instagram post deletion", () => {
    expect(createSocialAdapters(new SocialHttp(vi.fn())).instagram.deletePost).toBeUndefined();
  });

  it("refuses a direct-message reply after the 24-hour window before any request", async () => {
    const fetcher = vi.fn();
    const reply = job("reply");
    reply.payload.recipientId = "555";
    withWindow(reply, Date.now() - 1);
    const error = await createSocialAdapters(new SocialHttp(fetcher))
      .facebook.send(account("facebook"), reply, "synthetic", async () => new Uint8Array())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SocialPlatformError);
    expect(error).toMatchObject({
      code: "rejected",
      detail: { reasonCode: "meta.window_closed" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a direct-message reply inside the window", async () => {
    const fetcher = vi.fn(async () => json({ message_id: "mid_1" }));
    const reply = job("reply");
    reply.payload.recipientId = "555";
    withWindow(reply, Date.now() + 60_000);
    const result = await createSocialAdapters(new SocialHttp(fetcher)).facebook.send(
      account("facebook"),
      reply,
      "synthetic",
      async () => new Uint8Array(),
    );
    expect(result.platformId).toBe("mid_1");
    expect(calls(fetcher)[0]).toMatchObject({
      url: { pathname: "/v25.0/111/messages" },
      method: "POST",
    });
  });

  it("publishes a Facebook single image as an unpublished photo, checkpoints it, then attaches it to one feed post", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const path = new URL(String(raw)).pathname;
      if (path.endsWith("/photos")) return json({ id: "photo_1" });
      return json({ id: "post_1" });
    });
    const checkpoint = vi.fn();
    const publish = job();
    publish.payload.media = [{ kind: "image", url: "https://cdn.test/one.jpg", alt: "One" }];
    const result = await createSocialAdapters(new SocialHttp(fetcher)).facebook.send(
      account("facebook"),
      publish,
      "synthetic",
      async () => new Uint8Array(),
      checkpoint,
    );
    expect(result).toEqual({ platformId: "post_1", url: "https://www.facebook.com/post_1" });
    const [photo, feed] = calls(fetcher);
    expect(photo.url.pathname).toBe("/v25.0/111/photos");
    expect(JSON.parse(String(photo.body))).toMatchObject({
      published: false,
      alt_text_custom: "One",
    });
    expect(feed.url.pathname).toBe("/v25.0/111/feed");
    expect(JSON.parse(String(feed.body))).toMatchObject({
      attached_media: [{ media_fbid: "photo_1" }],
    });
    expect(checkpoint).toHaveBeenCalled();
    expect(checkpoint.mock.calls.at(-1)?.[0]).toMatchObject({ mediaIds: ["photo_1"] });
  });

  it("refuses a Facebook text over 63,206 characters before any request", async () => {
    const fetcher = vi.fn();
    const long = job();
    long.payload.text = "a".repeat(63_207);
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).facebook.send(
        account("facebook"),
        long,
        "synthetic",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses an Instagram caption over 2,200 characters before the container request", async () => {
    const fetcher = vi.fn();
    const long = job();
    long.payload.text = "b".repeat(2_201);
    long.payload.media = [{ kind: "image", url: "https://cdn.test/one.jpg" }];
    await expect(
      createSocialAdapters(new SocialHttp(fetcher)).instagram.send(
        account("instagram"),
        long,
        "synthetic",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("replies to an Instagram comment through its replies edge", async () => {
    const fetcher = vi.fn(async () => json({ id: "reply_1" }));
    const reply = job("reply");
    reply.payload.postId = "17900";
    reply.payload.text = "Thanks";
    const result = await createSocialAdapters(new SocialHttp(fetcher)).instagram.send(
      account("instagram"),
      reply,
      "synthetic",
      async () => new Uint8Array(),
    );
    expect(result.platformId).toBe("reply_1");
    expect(calls(fetcher)[0]).toMatchObject({
      url: { pathname: "/v25.0/17900/replies" },
      method: "POST",
    });
    expect(JSON.parse(String(calls(fetcher)[0].body))).toEqual({ message: "Thanks" });
  });

  it("maps Facebook post insights and edge counts", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname.endsWith("/insights"))
        return json({ data: [{ name: "post_impressions_unique", values: [{ value: 42 }] }] });
      return json({
        likes: { summary: { total_count: 5 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 1 },
      });
    });
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).facebook;
    await expect(adapter.getAnalytics!(account("facebook"), "synthetic", ["p1"])).resolves.toEqual({
      p1: { views: 42, likes: 5, comments: 2, shares: 1 },
    });
  });

  it("maps Instagram media insights by metric name and leaves absent metrics undefined", async () => {
    const fetcher = vi.fn(async () =>
      json({
        data: [
          { name: "views", values: [{ value: 10 }] },
          { name: "likes", values: [{ value: 3 }] },
        ],
      }),
    );
    const result = await createSocialAdapters(new SocialHttp(fetcher)).instagram.getAnalytics!(
      account("instagram"),
      "synthetic",
      ["m1"],
    );
    expect(result).toEqual({ m1: { views: 10, likes: 3, comments: undefined, shares: undefined } });
  });

  it("collects commenters of a selected own post and skips the account's own comments", async () => {
    const fetcher = vi.fn(async () =>
      json({
        data: [
          {
            id: "c1",
            from: { id: "555", name: "Ayse" },
            message: "hi",
            created_time: "2026-11-01T10:00:00+00:00",
          },
          {
            id: "c2",
            from: { id: "111", name: "Page" },
            message: "me",
            created_time: "2026-11-01T10:01:00+00:00",
          },
        ],
      }),
    );
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).facebook;
    const { people } = await adapter.collectAudience!(account("facebook"), "synthetic", {
      kind: "own_post_comments",
      accountId: "account",
      postRef: "p1",
    });
    expect(people).toMatchObject([{ platformId: "555", kind: "comment", ref: "c1" }]);
    await expect(
      adapter.collectAudience!(account("facebook"), "synthetic", {
        kind: "own_post_comments",
        accountId: "account",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("collects direct-message senders from conversation messages other than the account's", async () => {
    const fetcher = vi.fn(async () =>
      json({
        data: [
          {
            id: "t1",
            messages: {
              data: [
                {
                  id: "m1",
                  message: "hello",
                  from: { id: "777", name: "Bora" },
                  created_time: "2026-11-01T10:00:00+00:00",
                },
                {
                  id: "m2",
                  message: "reply",
                  from: { id: "111" },
                  created_time: "2026-11-01T10:02:00+00:00",
                },
              ],
            },
          },
        ],
      }),
    );
    const { people } = await createSocialAdapters(new SocialHttp(fetcher)).facebook
      .collectAudience!(account("facebook"), "synthetic", {
      kind: "dm_senders",
      accountId: "account",
    });
    expect(people).toMatchObject([{ platformId: "777", name: "Bora", kind: "dm", ref: "t1" }]);
  });

  it("refuses Instagram hashtag and own-post-likes audiences as unsupported without a request", async () => {
    const fetcher = vi.fn();
    const adapter = createSocialAdapters(new SocialHttp(fetcher)).instagram;
    await expect(
      adapter.collectAudience!(account("instagram"), "synthetic", {
        kind: "hashtag",
        accountId: "account",
        query: "coffee",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      adapter.collectAudience!(account("instagram"), "synthetic", {
        kind: "own_post_likes",
        accountId: "account",
        postRef: "m1",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hides and deletes Facebook comments; Instagram hides through the query flag", async () => {
    const fetcher = vi.fn(async () => json({ success: true }));
    const http = new SocialHttp(fetcher);
    await metaCommentAction(http, "v25.0", "facebook", "synthetic", "c9", "hide");
    await metaCommentAction(http, "v25.0", "facebook", "synthetic", "c9", "delete");
    await metaCommentAction(http, "v25.0", "instagram", "synthetic", "c9", "hide");
    const [hide, remove, igHide] = calls(fetcher);
    expect(hide).toMatchObject({ url: { pathname: "/v25.0/c9" }, method: "POST" });
    expect(JSON.parse(String(hide.body))).toEqual({ is_hidden: true });
    expect(remove).toMatchObject({ url: { pathname: "/v25.0/c9" }, method: "DELETE" });
    expect(igHide.url.search).toBe("?hide=true");
    expect(igHide.method).toBe("POST");
  });

  it("lists Facebook published posts with their permalink, time and text", async () => {
    const fetcher = vi.fn(async () =>
      json({
        data: [
          {
            id: "p1",
            permalink_url: "https://www.facebook.com/p1",
            created_time: "2026-11-01T10:00:00+00:00",
            message: "Hello",
          },
        ],
      }),
    );
    const page = await createSocialAdapters(new SocialHttp(fetcher)).facebook.listPosts!(
      account("facebook"),
      "synthetic",
    );
    expect(page.posts).toEqual([
      {
        id: "p1",
        url: "https://www.facebook.com/p1",
        at: Date.parse("2026-11-01T10:00:00+00:00"),
        text: "Hello",
      },
    ]);
  });
});
