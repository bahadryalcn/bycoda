import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../features/social/model/social";
import { SocialHttp } from "./adapter";
import { createYouTubeAdapter } from "./youtube";

const now = Date.parse("2026-11-07T10:00:00Z");
const account: SocialAccount = {
  id: "account",
  platform: "youtube",
  platformId: "UCowner",
  name: "Channel",
  accountType: "channel",
  connection: "oauth",
  scopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: { project: ["read", "draft", "publish", "reply", "comment"] },
  createdAt: 1,
};
const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
type YouTubeOptions = NonNullable<SocialJob["payload"]["youtube"]>;
const publishJob = (
  youtube: Partial<YouTubeOptions> & Record<string, unknown> = {},
): SocialJob => ({
  id: "job",
  operationId: "operation",
  dedupeKey: "dedupe",
  accountId: "account",
  projectIds: ["project"],
  provider: "codex",
  actorId: "session",
  kind: "publish",
  payload: {
    text: "Verified description",
    media: [{ kind: "video", uploadId: "video-file" }],
    youtube: {
      title: "Campaign title",
      privacy: "public",
      madeForKids: false,
      containsSyntheticMedia: false,
      ...youtube,
    } as YouTubeOptions,
  },
  status: "queued",
  scheduledAt: 1,
  attempts: 0,
  createdAt: 1,
});
/** Fake Google endpoint. Each call gets one handler response. */
function client(handler: (url: URL, init?: RequestInit) => Response) {
  const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(raw)), init),
  );
  return { fetcher, http: new SocialHttp(fetcher as unknown as typeof fetch, () => now) };
}
const thread = (id: string, publishedAt: string, author = `UCfan${id}`) => ({
  snippet: {
    channelId: "UCowner",
    videoId: "abcDEF12345",
    canReply: true,
    totalReplyCount: 0,
    topLevelComment: {
      id,
      snippet: {
        authorChannelId: { value: author },
        authorDisplayName: "Fan",
        textOriginal: "hello",
        publishedAt,
      },
    },
  },
});
/** Resumable upload fake: records the start metadata and returns a processed private video. */
function uploadClient(captured: { metadata?: any }) {
  return client((url, init) => {
    if (url.pathname.endsWith("/channels")) return Response.json({ items: [{ id: "UCowner" }] });
    if (
      url.pathname === "/upload/youtube/v3/videos" &&
      url.searchParams.get("uploadType") === "resumable"
    ) {
      captured.metadata = JSON.parse(String(init?.body));
      return new Response(null, {
        status: 200,
        headers: {
          location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc123",
        },
      });
    }
    if (url.searchParams.get("upload_id") === "abc123" && init?.method === "PUT")
      return Response.json({ id: "video-result", status: { privacyStatus: "private" } });
    if (url.pathname.endsWith("/videos"))
      return Response.json({
        items: [
          {
            id: "video-result",
            snippet: { channelId: "UCowner" },
            status: { uploadStatus: "processed", privacyStatus: "private" },
            processingDetails: { processingStatus: "succeeded" },
          },
        ],
      });
    throw new Error(`unexpected request ${url}`);
  });
}

describe("YouTube comment polling", () => {
  it("skips one malformed comment and keeps the rest of the sync (B10)", async () => {
    const { http } = client(() =>
      Response.json({
        items: [thread("c-bad", "not a date"), thread("c-good", "2026-11-05T10:00:00Z")],
      }),
    );
    const result = await createYouTubeAdapter(http, () => now).poll(
      account,
      "token",
      [],
      undefined,
    );
    expect(result.events.map((event) => event.eventId)).toEqual(["c-good"]);
  });
});

describe("YouTube upload options", () => {
  it("uses the requested category and defaults to People & Blogs (B43)", async () => {
    const captured: { metadata?: any } = {};
    await createYouTubeAdapter(uploadClient(captured).http, () => now).send(
      account,
      publishJob({ categoryId: "10" }),
      "token",
      async () => mp4,
      vi.fn(async () => {}),
    );
    expect(captured.metadata.snippet.categoryId).toBe("10");
    const defaults: { metadata?: any } = {};
    await createYouTubeAdapter(uploadClient(defaults).http, () => now).send(
      account,
      publishJob(),
      "token",
      async () => mp4,
      vi.fn(async () => {}),
    );
    expect(defaults.metadata.snippet.categoryId).toBe("22");
  });

  it("schedules a future publish time by uploading privately with publishAt", async () => {
    const captured: { metadata?: any } = {};
    const at = now + 3_600_000;
    await createYouTubeAdapter(uploadClient(captured).http, () => now).send(
      account,
      publishJob({ publishAt: at }),
      "token",
      async () => mp4,
      vi.fn(async () => {}),
    );
    expect(captured.metadata.status).toMatchObject({
      privacyStatus: "private",
      publishAt: new Date(at).toISOString(),
    });
  });

  it("rejects an invalid title, category or past publish time before any network call", async () => {
    const { fetcher, http } = client(() => Response.json({}));
    const adapter = createYouTubeAdapter(http, () => now);
    const send = (youtube: Partial<YouTubeOptions> & Record<string, unknown>) =>
      adapter.send(
        account,
        publishJob(youtube),
        "token",
        async () => mp4,
        vi.fn(async () => {}),
      );
    await expect(send({ title: "bad <title>" })).rejects.toMatchObject({ code: "rejected" });
    await expect(send({ title: "x".repeat(101) })).rejects.toMatchObject({ code: "rejected" });
    await expect(send({ title: "  " })).rejects.toMatchObject({ code: "rejected" });
    await expect(send({ publishAt: now - 1 })).rejects.toMatchObject({ code: "rejected" });
    await expect(send({ categoryId: "abc" })).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("YouTube owned-video operations", () => {
  it("uploads a JPEG thumbnail and refuses other bytes before calling the API", async () => {
    const seen: { url: string; type?: string }[] = [];
    const { http } = client((url, init) => {
      seen.push({
        url: url.toString(),
        type: (init?.headers as Record<string, string> | undefined)?.["Content-Type"],
      });
      return Response.json({ kind: "youtube#thumbnailSetResponse" });
    });
    const adapter = createYouTubeAdapter(http, () => now);
    await adapter.setThumbnail(
      "token",
      "abcDEF12345",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]),
    );
    expect(seen[0]).toEqual({
      url: "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=abcDEF12345&uploadType=media",
      type: "image/jpeg",
    });
    await expect(
      adapter.setThumbnail("token", "abcDEF12345", new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(seen).toHaveLength(1);
  });

  it("adds a video to a playlist and returns the playlist item ID", async () => {
    const { http, fetcher } = client(() => Response.json({ id: "playlist-item-1" }));
    const id = await createYouTubeAdapter(http, () => now).addToPlaylist(
      "token",
      "PLabcdefghijk",
      "abcDEF12345",
    );
    expect(id).toBe("playlist-item-1");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/youtube/v3/playlistItems");
    expect(JSON.parse(String(init.body))).toEqual({
      snippet: {
        playlistId: "PLabcdefghijk",
        resourceId: { kind: "youtube#video", videoId: "abcDEF12345" },
      },
    });
  });

  it("sets comment moderation to held, published or rejected only", async () => {
    const { http, fetcher } = client(() => new Response(null, { status: 204 }));
    const adapter = createYouTubeAdapter(http, () => now);
    await adapter.moderateComment("token", "UgxComment123", "heldForReview");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=UgxComment123&moderationStatus=heldForReview",
    );
    expect(init.method).toBe("POST");
    await expect(
      adapter.moderateComment("token", "UgxComment123", "likelySpam" as never),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reads view, like and comment counts from video statistics", async () => {
    const { http, fetcher } = client(() =>
      Response.json({
        items: [
          { id: "abcDEF12345", statistics: { viewCount: "10", likeCount: "2", commentCount: "1" } },
        ],
      }),
    );
    const adapter = createYouTubeAdapter(http, () => now);
    await expect(adapter.getAnalytics!(account, "token", ["abcDEF12345"])).resolves.toEqual({
      abcDEF12345: { views: 10, likes: 2, comments: 1 },
    });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("part")).toBe("statistics");
    await expect(adapter.getAnalytics!(account, "token", ["not valid"])).rejects.toMatchObject({
      code: "rejected",
    });
  });

  it("reads the channel profile and refuses another channel", async () => {
    const adapter = createYouTubeAdapter(
      client(() =>
        Response.json({
          items: [
            {
              id: "UCowner",
              snippet: { title: "Bycoda", customUrl: "@bycoda" },
              statistics: { subscriberCount: "12", hiddenSubscriberCount: false },
            },
          ],
        }),
      ).http,
      () => now,
    );
    await expect(adapter.getProfile!(account, "token")).resolves.toEqual({
      name: "Bycoda",
      username: "@bycoda",
      followers: 12,
    });
    const other = createYouTubeAdapter(
      client(() => Response.json({ items: [{ id: "UCother" }] })).http,
      () => now,
    );
    await expect(other.getProfile!(account, "token")).rejects.toMatchObject({ code: "denied" });
  });

  it("reports an expired session as a code instead of throwing", async () => {
    const adapter = createYouTubeAdapter(
      client(() => Response.json({ error: { code: 401 } }, { status: 401 })).http,
      () => now,
    );
    await expect(adapter.healthCheck!(account, "token")).resolves.toEqual({
      ok: false,
      code: "expired",
    });
  });
});

describe("YouTube audience collection", () => {
  it("collects keyword commenters, skips the owner and disabled comments, and counts quota", async () => {
    const { http } = client((url) => {
      if (url.pathname.endsWith("/search"))
        return Response.json({
          nextPageToken: "NEXT",
          items: [{ id: { videoId: "abcDEF12345" } }, { id: { videoId: "zyxWVU98765" } }],
        });
      if (url.searchParams.get("videoId") === "abcDEF12345")
        return Response.json({
          items: [
            thread("c-fan", "2026-11-05T10:00:00Z", "UCfanone"),
            thread("c-self", "2026-11-05T11:00:00Z", "UCowner"),
          ],
        });
      return Response.json(
        { error: { errors: [{ reason: "commentsDisabled" }] } },
        { status: 403 },
      );
    });
    const adapter = createYouTubeAdapter(http, () => now);
    const page = await adapter.collectAudience!(account, "token", {
      kind: "keyword",
      accountId: account.id,
      query: "#bycoda",
    });
    expect(page.next).toBe("NEXT");
    expect(page.people).toEqual([
      {
        platformId: "UCfanone",
        name: "Fan",
        profileUrl: "https://www.youtube.com/channel/UCfanone",
        text: "hello",
        kind: "comment",
        ref: "abcDEF12345",
        at: Date.parse("2026-11-05T10:00:00Z"),
      },
    ]);
    // One search (100 units) plus one comment-thread read per video (1 unit each).
    expect(adapter.quota.usedToday().units).toBe(102);
  });

  it("collects commenters of owned videos and refuses sources it cannot read", async () => {
    const { http, fetcher } = client(() =>
      Response.json({ items: [thread("c-fan", "2026-11-05T10:00:00Z", "UCfanone")] }),
    );
    const adapter = createYouTubeAdapter(http, () => now);
    const page = await adapter.collectAudience!(account, "token", {
      kind: "own_post_comments",
      accountId: account.id,
    });
    expect(page.people.map((person) => person.platformId)).toEqual(["UCfanone"]);
    expect(
      new URL(String(fetcher.mock.calls[0][0])).searchParams.get("allThreadsRelatedToChannelId"),
    ).toBe("UCowner");
    await expect(
      adapter.collectAudience!(account, "token", { kind: "mentions", accountId: account.id }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      adapter.collectAudience!(account, "token", {
        kind: "keyword",
        accountId: "other",
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "denied" });
  });
});

describe("YouTube top-level comments (B33)", () => {
  it("posts only when recipientId is the video's channel; a commenter contact is refused", async () => {
    const posts: string[] = [];
    const { http } = client((url, init) => {
      if (url.pathname.endsWith("/videos"))
        return Response.json({
          items: [{ id: "abcDEF12345", snippet: { channelId: "UCvideoowner" } }],
        });
      if (url.pathname.endsWith("/commentThreads") && init?.method === "POST") {
        posts.push("post");
        return Response.json({ id: "thread-1", snippet: { topLevelComment: { id: "UgxTop1" } } });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const adapter = createYouTubeAdapter(http, () => now);
    const comment = (recipientId?: string): SocialJob => ({
      ...publishJob(),
      kind: "comment",
      payload: { text: "Thanks", media: [], postId: "abcDEF12345", recipientId },
    });
    // A commenter's channel ID is not the video's channel: refused before any write.
    await expect(
      adapter.send(account, comment("UCfanone"), "token", async () => mp4),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(adapter.send(account, comment(), "token", async () => mp4)).rejects.toMatchObject({
      code: "denied",
    });
    expect(posts).toHaveLength(0);
    await expect(
      adapter.send(account, comment("UCvideoowner"), "token", async () => mp4),
    ).resolves.toMatchObject({ platformId: "UgxTop1" });
    expect(posts).toHaveLength(1);
  });
});
