import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../adapter";
import {
  createXAdapter,
  xAudienceRequest,
  xBookmarkPost,
  xLikePost,
  xPostExtrasIssue,
  xPostId,
} from "./x";

afterEach(() => vi.restoreAllMocks());

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    platform: "x",
    platformId: "42",
    name: "@owner",
    accountType: "member",
    connection: "token",
    scopes: ["tweet.read", "tweet.write", "users.read", "follows.read", "like.read"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;

const job = (payload: Record<string, unknown> = {}) =>
  ({
    id: "job",
    kind: "publish",
    payload: { text: "hello", media: [], ...payload },
    attempts: 0,
    scheduledAt: 0,
    status: "running",
  }) as unknown as SocialJob;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
/** Scripted X responses. Each call consumes one reply; the default is an empty success body. */
function network(...replies: Reply[]) {
  const queue = [...replies];
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = queue.shift() ?? { body: {} };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  });
  return { fetcher, http: new SocialHttp(fetcher as unknown as typeof fetch) };
}
const calledUrl = (fetcher: { mock: { calls: unknown[][] } }, index = 0) =>
  new URL(String(fetcher.mock.calls[index][0]));
const calledBody = (fetcher: { mock: { calls: unknown[][] } }, index = 0) =>
  JSON.parse(String((fetcher.mock.calls[index][1] as RequestInit).body));
const noop = async () => new Uint8Array();

describe("X API deletion and metrics", () => {
  it("deletes a post with a DELETE request and requires data.deleted", async () => {
    const { fetcher, http } = network({ body: { data: { deleted: true } } });
    await createXAdapter(http).deletePost!(account(), "token", "555");
    expect(calledUrl(fetcher).pathname).toBe("/2/tweets/555");
    expect((fetcher.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(
      ((fetcher.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization,
    ).toBe("Bearer token");
  });

  it("treats an unconfirmed delete as an unknown outcome", async () => {
    const { http } = network({ body: { data: { deleted: false } } });
    await expect(createXAdapter(http).deletePost!(account(), "token", "555")).rejects.toMatchObject(
      {
        code: "unknown",
      },
    );
  });

  it("rejects a non-numeric post ID before any request", async () => {
    const { fetcher, http } = network();
    await expect(
      createXAdapter(http).deletePost!(account(), "token", "../5"),
    ).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps public metrics to the shared analytics shape, batching up to 100 posts", async () => {
    const { fetcher, http } = network({
      body: {
        data: [
          {
            id: "1",
            public_metrics: {
              impression_count: 100,
              like_count: 5,
              reply_count: 2,
              repost_count: 3,
              quote_count: 1,
            },
          },
        ],
      },
    });
    const result = await createXAdapter(http).getAnalytics!(account(), "token", ["1"]);
    expect(result).toEqual({ "1": { views: 100, likes: 5, comments: 2, shares: 4 } });
    expect(calledUrl(fetcher).searchParams.get("post.fields")).toBe("public_metrics");
    expect(calledUrl(fetcher).searchParams.get("ids")).toBe("1");
  });

  it("reads the owner profile and follower count", async () => {
    const { http } = network({
      body: {
        data: {
          id: "42",
          name: "Owner",
          username: "owner",
          public_metrics: { followers_count: 77 },
        },
      },
    });
    await expect(createXAdapter(http).getProfile!(account(), "token")).resolves.toEqual({
      name: "Owner",
      username: "owner",
      followers: 77,
    });
  });
});

describe("X API audience collection", () => {
  it("collects likers with the cursor and skips the owner", async () => {
    const { fetcher, http } = network({
      body: {
        data: [
          { id: "900", name: "Ann", username: "ann", public_metrics: { followers_count: 12 } },
          { id: "42", name: "Me", username: "me" },
        ],
        meta: { next_token: "n1" },
      },
    });
    const result = await createXAdapter(http).collectAudience!(
      account(),
      "token",
      { kind: "own_post_likes", accountId: "a", postRef: "555" },
      "c0",
    );
    expect(calledUrl(fetcher).pathname).toBe("/2/tweets/555/liking_users");
    expect(calledUrl(fetcher).searchParams.get("pagination_token")).toBe("c0");
    expect(result.people).toEqual([
      expect.objectContaining({
        platformId: "900",
        name: "Ann",
        kind: "like",
        ref: "555",
        followers: 12,
      }),
    ]);
    expect(result.next).toBe("n1");
  });

  it("maps mention authors from included users", async () => {
    const { http } = network({
      body: {
        data: [
          {
            id: "8001",
            author_id: "901",
            text: "hi @owner",
            created_at: "2026-11-01T10:00:00.000Z",
          },
        ],
        includes: { users: [{ id: "901", name: "Bo", username: "bo" }] },
      },
    });
    const result = await createXAdapter(http).collectAudience!(account(), "token", {
      kind: "mentions",
      accountId: "a",
    });
    expect(result.people).toEqual([
      expect.objectContaining({
        platformId: "901",
        kind: "mention",
        ref: "8001",
        text: "hi @owner",
        at: Date.parse("2026-11-01T10:00:00.000Z"),
      }),
    ]);
  });

  it("searches replies to a post with a conversation query", () => {
    const request = xAudienceRequest("42", {
      kind: "own_post_comments",
      accountId: "a",
      postRef: "555",
    });
    expect(request.url.pathname).toBe("/2/tweets/search/recent");
    expect(request.url.searchParams.get("query")).toBe("conversation_id:555 -is:retweet");
    expect(request.kind).toBe("comment");
  });

  it("refuses a commenter handle that is not an X username", () => {
    expect(() =>
      xAudienceRequest("42", { kind: "account_commenters", accountId: "a", handle: "bad handle" }),
    ).toThrow(SocialPlatformError);
  });
});

describe("X API posting extras and actions", () => {
  it("accepts a valid poll and a quote, and refuses invalid poll shapes", () => {
    expect(
      xPostExtrasIssue({ poll: { options: ["a", "b"], durationMinutes: 60 } }),
    ).toBeUndefined();
    expect(xPostExtrasIssue({ quotePostId: "999" })).toBeUndefined();
    expect(xPostExtrasIssue({ quotePostId: "abc" })).toBeDefined();
    expect(xPostExtrasIssue({ poll: { options: ["only"], durationMinutes: 60 } })).toBeDefined();
    expect(
      xPostExtrasIssue({ poll: { options: ["a".repeat(26), "b"], durationMinutes: 60 } }),
    ).toBeDefined();
    expect(xPostExtrasIssue({ poll: { options: ["a", "b"], durationMinutes: 4 } })).toBeDefined();
  });

  it("sends a poll post and refuses an invalid poll before any request", async () => {
    const ok = network({ body: { data: { id: "778" } } });
    await expect(
      createXAdapter(ok.http).send(
        account(),
        job({ x: { poll: { options: ["Yes", "No"], durationMinutes: 60 } } }),
        "token",
        noop,
      ),
    ).resolves.toMatchObject({ platformId: "778" });
    expect(calledBody(ok.fetcher).poll).toEqual({ options: ["Yes", "No"], duration_minutes: 60 });

    const refused = network();
    await expect(
      createXAdapter(refused.http).send(
        account(),
        job({ x: { poll: { options: ["only"], durationMinutes: 60 } } }),
        "token",
        noop,
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(refused.fetcher).not.toHaveBeenCalled();
  });

  it("posts a quote with quote_tweet_id", async () => {
    const { fetcher, http } = network({ body: { data: { id: "779" } } });
    await createXAdapter(http).send(account(), job({ x: { quotePostId: "999" } }), "token", noop);
    expect(calledBody(fetcher).quote_tweet_id).toBe("999");
  });

  it("refuses over-length text before any request", async () => {
    const { fetcher, http } = network();
    await expect(
      createXAdapter(http).send(account(), job({ text: "a".repeat(281) }), "token", noop),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("counts a URL as 23 characters when judging the post length", async () => {
    const { fetcher, http } = network({ body: { data: { id: "780" } } });
    const text = `https://example.com/${"x".repeat(200)} ${"b".repeat(250)}`;
    await createXAdapter(http).send(account(), job({ text }), "token", noop);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("likes, reposts and bookmarks as the account's own user ID", async () => {
    const liked = network({ body: { data: { liked: true } } });
    await xLikePost(liked.http, account(), "token", "555");
    expect(calledUrl(liked.fetcher).pathname).toBe("/2/users/42/likes");
    expect(calledBody(liked.fetcher)).toEqual({ tweet_id: "555" });

    const bookmarked = network({ body: { data: { bookmarked: true } } });
    await xBookmarkPost(bookmarked.http, account(), "token", "555");
    expect(calledUrl(bookmarked.fetcher).pathname).toBe("/2/users/42/bookmarks");
  });

  it("validates numeric post IDs", () => {
    expect(xPostId("12345")).toBe("12345");
    expect(() => xPostId("12a")).toThrow(SocialPlatformError);
  });
});

describe("X API health and rate-limit tracking", () => {
  it("reports expiry and identity mismatch as results instead of throwing", async () => {
    const { http } = network(
      { status: 401, body: { title: "Unauthorized" } },
      { body: { data: { id: "99" } } },
      { body: { data: { id: "42" } } },
    );
    const adapter = createXAdapter(http);
    await expect(adapter.healthCheck!(account(), "token")).resolves.toEqual({
      ok: false,
      code: "expired",
    });
    await expect(adapter.healthCheck!(account(), "token")).resolves.toEqual({
      ok: false,
      code: "denied",
    });
    await expect(adapter.healthCheck!(account(), "token")).resolves.toEqual({ ok: true });
  });

  it("pauses an endpoint once the response reports zero remaining requests", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 300);
    const paused = account({ id: "22222222-2222-4222-8222-222222222222" });
    const { fetcher, http } = network(
      {
        body: { data: { id: "42", name: "Owner" } },
        headers: { "x-rate-limit-remaining": "0", "x-rate-limit-reset": reset },
      },
      { body: { data: { id: "42", name: "Owner" } } },
    );
    const adapter = createXAdapter(http);
    await adapter.getProfile!(paused, "token");
    await expect(adapter.getProfile!(paused, "token")).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
