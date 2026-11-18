import { describe, expect, it, vi } from "vitest";
import { SocialHttp, type SocialAccount, type SocialJob } from "../adapter";
import { createXAdapter } from "./x";
import { xReadInsights } from "./x-insights";
import { xListOwnSpaces } from "./x-spaces";

const account: SocialAccount = {
  id: "x-readouts",
  platform: "x",
  platformId: "123",
  name: "Account",
  accountType: "member",
  scopes: ["tweet.read", "users.read", "space.read", "dm.write"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};

const range = { startTime: "2026-11-01T00:00:00Z", endTime: "2026-11-03T00:00:00Z" };

function message(payload: SocialJob["payload"]): SocialJob {
  return {
    id: "job",
    operationId: "op",
    dedupeKey: "dm-test",
    accountId: account.id,
    projectIds: ["project"],
    provider: "owner",
    actorId: "device",
    kind: "message",
    payload,
    status: "running",
    scheduledAt: 1,
    attempts: 1,
    createdAt: 1,
  };
}

describe("X direct messages", () => {
  it("validates the recipient before upload and rechecks the guard immediately before sending", async () => {
    const events: string[] = [];
    const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(raw));
      if (url.pathname.includes("media/upload")) {
        events.push("upload");
        const body = init?.body;
        if (!(body instanceof FormData)) throw new Error("Expected DM image upload.");
        expect(body.get("media_category")).toBe("dm_image");
        return Response.json({ data: { id: "500" } });
      }
      events.push("send");
      expect(url.pathname).toBe("/2/dm_conversations/with/876/messages");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ attachments: [{ media_id: "500" }] });
      return Response.json({ data: { dm_event_id: "600", dm_conversation_id: "123-876" } });
    });
    const x = createXAdapter(new SocialHttp(fetcher));
    const media = vi.fn(async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const request = message({
      text: "",
      media: [{ kind: "image", uploadId: "local" }],
      recipientId: "@not-an-id",
    });
    await expect(x.send(account, request, "fixture", media)).rejects.toMatchObject({
      code: "rejected",
    });
    expect(media).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    request.payload.recipientId = "876";
    await expect(
      x.send(account, request, "fixture", media, undefined, async () => {
        events.push("guard");
      }),
    ).resolves.toEqual({ platformId: "600" });
    expect(events).toEqual(["upload", "guard", "send"]);
  });

  it("sends text over the public post weight limit to the exact legacy conversation", async () => {
    const text = "x".repeat(500);
    const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
      expect(new URL(String(raw)).pathname).toBe("/2/dm_conversations/123-876/messages");
      expect(JSON.parse(String(init?.body))).toEqual({ text });
      return Response.json({ data: { dm_conversation_id: "123-876" } });
    });
    const x = createXAdapter(new SocialHttp(fetcher));
    await expect(
      x.send(
        account,
        message({ text, media: [], threadId: "123-876" }),
        "fixture",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("X insights and Spaces", () => {
  it("aggregates owned daily post metrics and reports coverage for incomplete responses", async () => {
    const timestamp = "2026-11-02T00:00:00Z";
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      if (url.pathname === "/2/users/me")
        return Response.json({
          data: {
            id: "123",
            public_metrics: { followers_count: 8, post_count: 16 },
            subscriber_count: 1,
          },
        });
      if (url.pathname === "/2/users/123/tweets")
        return Response.json({
          data: [
            { id: "5" },
            { id: "6", author_id: "123" },
            { id: "7" },
            { id: "8", author_id: "999" },
          ],
          meta: { next_token: "older" },
        });
      expect(url.pathname).toBe("/2/tweets/analytics");
      expect(url.searchParams.get("ids")).toBe("5,6,7");
      expect(url.searchParams.get("granularity")).toBe("daily");
      return Response.json({
        data: [
          {
            id: "5",
            timestamped_metrics: [{ timestamp, metrics: { impressions: 7, replies: 0 } }],
          },
          {
            id: "6",
            timestamped_metrics: [{ timestamp, metrics: { impressions: 4, url_clicks: 2 } }],
          },
          { id: "8", timestamped_metrics: [{ timestamp, metrics: { impressions: 999 } }] },
        ],
      });
    });
    const result = await xReadInsights(new SocialHttp(fetcher), account, "fixture", range);
    expect(result.profile).toMatchObject({ followers: 8, posts: 16, subscribers: 1 });
    expect(result.posts.map(({ id }) => id)).toEqual(["5", "6"]);
    expect(result.daily).toEqual([
      {
        timestamp: "2026-11-02T00:00:00.000Z",
        metrics: { impressions: 11, replies: 0, url_clicks: 2 },
      },
    ]);
    expect(result.coverage).toEqual({ requestedPosts: 3, morePostsAvailable: true, partial: true });
  });

  it("rejects a reversed insights range before any paid request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      xReadInsights(new SocialHttp(fetcher), account, "fixture", {
        startTime: range.endTime,
        endTime: range.startTime,
      }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("looks up Spaces for one creator and returns validated links", async () => {
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(String(raw));
      expect(url.pathname).toBe("/2/spaces/by/creator_ids");
      expect(url.searchParams.get("user_ids")).toBe("123");
      return Response.json({
        data: [
          {
            id: "1nAKErdLGmWxL",
            creator_id: "123",
            title: "Q&A",
            state: "live",
            participant_count: 0,
          },
          { id: "wrongCreator", creator_id: "456" },
          { id: "?unsafe=path", creator_id: "123" },
        ],
      });
    });
    await expect(
      xListOwnSpaces(new SocialHttp(fetcher), account, "fixture"),
    ).resolves.toMatchObject({
      spaces: [
        {
          url: "https://x.com/i/spaces/1nAKErdLGmWxL",
          title: "Q&A",
          state: "live",
          participantCount: 0,
        },
      ],
      partial: true,
    });
  });
});
