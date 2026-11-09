import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../adapter";
import { createRedditAdapter, editRedditText } from "./reddit";
import { REDDIT_USER_AGENT, resetRedditPauses } from "./reddit-api";
import { getSubredditRules } from "./reddit-rules";

type Reply = { value?: unknown; headers?: Record<string, string> } | Error;

/** Scripted SocialHttp. The allowlist and fetch are bypassed: only the request seam is replaced. */
function fakeHttp(replies: Reply[]) {
  const calls: { url: string; token: string; options: RequestInit }[] = [];
  const request = vi.fn(async (url: string, token: string, options: RequestInit = {}) => {
    calls.push({ url, token, options });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return {
      value: (next?.value ?? {}) as Record<string, any>,
      headers: new Headers(next?.headers ?? {}),
    };
  });
  return { http: { request } as unknown as SocialHttp, calls };
}

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "22222222-2222-4222-8222-222222222222",
    platform: "reddit",
    platformId: "t2_abc",
    name: "u/owner",
    accountType: "member",
    connection: "oauth",
    scopes: ["identity", "submit", "read", "privatemessages", "history", "edit"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;

const job = (
  overrides: Partial<SocialJob> = {},
  payload: Record<string, unknown> = {},
): SocialJob =>
  ({
    id: "job-1",
    operationId: "op",
    dedupeKey: "d",
    accountId: "22222222-2222-4222-8222-222222222222",
    projectIds: [],
    provider: "reddit",
    kind: "publish",
    payload: { text: "Body text", media: [], ...payload },
    status: "running",
    scheduledAt: 0,
    attempts: 0,
    createdAt: 1,
    actorId: "owner",
    ...overrides,
  }) as SocialJob;

const sent = (data: Record<string, unknown>) => ({ value: { json: { errors: [], data } } });

let unique = 0;
/** Titles are unique per test: the one-subreddit content reservation lives in process memory. */
const title = (label: string) => `${label} ${++unique} ${Date.now()}`;

beforeEach(() => resetRedditPauses());
afterEach(() => vi.restoreAllMocks());

describe("Reddit publish", () => {
  it("submits a text post to one subreddit with the flair and the reddit user agent", async () => {
    const { http, calls } = fakeHttp([
      sent({ name: "t3_abc", url: "https://www.reddit.com/r/bycodatest/abc" }),
    ]);
    const adapter = createRedditAdapter(http);
    const result = await adapter.send(
      account(),
      job(
        {},
        { reddit: { subreddits: ["bycodatest"], title: title("Hello"), flairId: "flair-1" } },
      ),
      "token",
      async () => new Uint8Array(),
    );
    expect(result).toEqual({
      platformId: "t3_abc",
      url: "https://www.reddit.com/r/bycodatest/abc",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://oauth.reddit.com/api/submit?raw_json=1");
    const body = new URLSearchParams(String(calls[0].options.body));
    expect(body.get("sr")).toBe("bycodatest");
    expect(body.get("kind")).toBe("self");
    expect(body.get("flair_id")).toBe("flair-1");
    expect(body.get("api_type")).toBe("json");
    expect((calls[0].options.headers as Record<string, string>)["User-Agent"]).toBe(
      REDDIT_USER_AGENT,
    );
  });

  it("refuses a job that names two subreddits before any request", async () => {
    const { http, calls } = fakeHttp([]);
    await expect(
      createRedditAdapter(http).send(
        account(),
        job({}, { reddit: { subreddits: ["bycodatest", "otherone"], title: title("Two") } }),
        "token",
        async () => new Uint8Array(),
      ),
    ).rejects.toMatchObject({ code: "rejected", detail: { reasonCode: "reddit.one_subreddit" } });
    expect(calls).toHaveLength(0);
  });

  it("refuses the same content to a second subreddit while the first reservation is live", async () => {
    const same = title("Same");
    const { http, calls } = fakeHttp([sent({ name: "t3_one" })]);
    const adapter = createRedditAdapter(http);
    await adapter.send(
      account(),
      job({}, { reddit: { subreddits: ["bycodatest"], title: same, flairId: "f" } }),
      "token",
      async () => undefined,
    );
    await expect(
      adapter.send(
        account(),
        job({ id: "job-2" }, { reddit: { subreddits: ["otherone"], title: same, flairId: "f" } }),
        "token",
        async () => undefined,
      ),
    ).rejects.toMatchObject({ detail: { reasonCode: "reddit.one_subreddit" } });
    expect(calls).toHaveLength(1);
  });

  it("refuses a missing flair when the subreddit requires one, and stops after the requirement read", async () => {
    const { http, calls } = fakeHttp([{ value: { is_flair_required: true } }]);
    await expect(
      createRedditAdapter(http).send(
        account(),
        job({}, { reddit: { subreddits: ["bycodatest"], title: title("Flair") } }),
        "token",
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "rejected", detail: { reasonCode: "reddit.flair_required" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/v1/bycodatest/post_requirements");
  });

  it("refuses a title longer than 300 characters and media without sending", async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = createRedditAdapter(http);
    await expect(
      adapter.send(
        account(),
        job({}, { reddit: { subreddits: ["bycodatest"], title: "x".repeat(301), flairId: "f" } }),
        "token",
        async () => undefined,
      ),
    ).rejects.toMatchObject({ detail: { reasonCode: "reddit.title_length" } });
    await expect(
      adapter.send(
        account(),
        job(
          {},
          {
            media: [{ kind: "image" }],
            reddit: { subreddits: ["bycodatest"], title: title("Media"), flairId: "f" },
          },
        ),
        "token",
        async () => undefined,
      ),
    ).rejects.toMatchObject({
      code: "unsupported",
      detail: { reasonCode: "reddit.media_unsupported" },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps a RATELIMIT entry in json.errors to rate_limit with a retry time", async () => {
    const now = Date.now();
    const { http } = fakeHttp([
      {
        value: {
          json: {
            errors: [
              ["RATELIMIT", "you are doing that too much. try again in 3 minutes.", "ratelimit"],
            ],
          },
        },
      },
    ]);
    const error = await createRedditAdapter(http)
      .send(
        account(),
        job({}, { reddit: { subreddits: ["bycodatest"], title: title("Limit"), flairId: "f" } }),
        "token",
        async () => undefined,
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SocialPlatformError);
    expect((error as SocialPlatformError).code).toBe("rate_limit");
    expect((error as SocialPlatformError).retryAt).toBeGreaterThanOrEqual(now + 3 * 60_000);
  });

  it("pauses the account once the rate-limit headers report no remaining requests", async () => {
    const { http, calls } = fakeHttp([
      {
        value: { json: { errors: [], data: { name: "t3_r" } } },
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "30" },
      },
      { value: {} },
    ]);
    const adapter = createRedditAdapter(http);
    await adapter.send(
      account(),
      job({}, { reddit: { subreddits: ["bycodatest"], title: title("Pause"), flairId: "f" } }),
      "token",
      async () => undefined,
    );
    await expect(adapter.poll(account(), "token", [])).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("Reddit replies, messages and deletes", () => {
  it("replies to a comment through /api/comment with the comment fullname as parent", async () => {
    const { http, calls } = fakeHttp([
      { value: { json: { data: { things: [{ data: { name: "t1_new" } }] } } } },
    ]);
    const result = await createRedditAdapter(http).send(
      account(),
      job({ kind: "reply" }, { postId: "t1_parent" }),
      "token",
      async () => undefined,
    );
    expect(result).toEqual({ platformId: "t1_new" });
    expect(calls[0].url).toContain("/api/comment");
    expect(new URLSearchParams(String(calls[0].options.body)).get("parent")).toBe("t1_parent");
  });

  it("rejects a reply target that is neither a comment nor a post", async () => {
    const { http, calls } = fakeHttp([]);
    await expect(
      createRedditAdapter(http).send(
        account(),
        job({ kind: "reply" }, { postId: "abc" }),
        "token",
        async () => undefined,
      ),
    ).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "reddit.fullname_invalid" },
    });
    expect(calls).toHaveLength(0);
  });

  it("answers a message thread with the message fullname as parent", async () => {
    const { http, calls } = fakeHttp([
      { value: { json: { data: { things: [{ data: { name: "t4_reply" } }] } } } },
    ]);
    await createRedditAdapter(http).send(
      account(),
      job({ kind: "message" }, { threadId: "t4_root" }),
      "token",
      async () => undefined,
    );
    expect(new URLSearchParams(String(calls[0].options.body)).get("parent")).toBe("t4_root");
  });

  it("starts a private message to a username with a subject", async () => {
    const { http, calls } = fakeHttp([{ value: { json: { errors: [] } } }]);
    const result = await createRedditAdapter(http).send(
      account(),
      job(
        { kind: "message", id: "job-msg" },
        { recipientId: "reader_1", reddit: { subject: "Hi" } },
      ),
      "token",
      async () => undefined,
    );
    expect(result).toEqual({ platformId: "job-msg" });
    const body = new URLSearchParams(String(calls[0].options.body));
    expect(calls[0].url).toContain("/api/compose");
    expect(body.get("to")).toBe("reader_1");
    expect(body.get("subject")).toBe("Hi");
  });

  it("deletes an owned post or comment through /api/del", async () => {
    const { http, calls } = fakeHttp([{ value: {} }]);
    await createRedditAdapter(http).deletePost!(account(), "token", "t3_gone");
    expect(calls[0].url).toContain("/api/del");
    expect(new URLSearchParams(String(calls[0].options.body)).get("id")).toBe("t3_gone");
  });

  it("edits own text through /api/editusertext", async () => {
    const { http, calls } = fakeHttp([{ value: {} }]);
    await editRedditText(http, account(), "token", "t1_mine", "Corrected");
    expect(calls[0].url).toContain("/api/editusertext");
    expect(new URLSearchParams(String(calls[0].options.body)).get("text")).toBe("Corrected");
  });
});

describe("Reddit inbox poll", () => {
  it("maps comments and messages, moves the cursor to the newest item, and asks only for newer items next time", async () => {
    const { http, calls } = fakeHttp([
      {
        value: {
          data: {
            children: [
              {
                kind: "t1",
                data: {
                  name: "t1_c1",
                  author: "alice",
                  body: "nice",
                  link_id: "t3_p1",
                  created_utc: 1700000000,
                },
              },
              {
                kind: "t4",
                data: {
                  name: "t4_m1",
                  first_message_name: "t4_root",
                  author: "bob",
                  body: "hello",
                  created_utc: 1700000001,
                },
              },
            ],
          },
        },
      },
      { value: { data: { children: [] } } },
    ]);
    const adapter = createRedditAdapter(http);
    const first = await adapter.poll(account(), "token", []);
    expect(first.cursor).toBe("t4_m1");
    expect(first.events).toEqual([
      expect.objectContaining({
        eventId: "t1_c1",
        kind: "comment",
        contactId: "alice",
        threadId: "t3_p1",
        postId: "t1_c1",
      }),
      expect.objectContaining({
        eventId: "t4_m1",
        kind: "message",
        contactId: "bob",
        threadId: "t4_root",
      }),
    ]);
    expect(calls[0].url).not.toContain("before=");
    await adapter.poll(account(), "token", [], first.cursor);
    expect(calls[1].url).toContain("before=t4_m1");
  });

  it("skips deleted items and items without an author", async () => {
    const { http } = fakeHttp([
      {
        value: {
          data: {
            children: [
              { kind: "t1", data: { name: "t1_d", author: "[deleted]", body: "", created_utc: 1 } },
              { kind: "t4", data: { name: "t4_s", body: "system", created_utc: 2 } },
            ],
          },
        },
      },
    ]);
    const result = await createRedditAdapter(http).poll(account(), "token", []);
    expect(result.events).toEqual([]);
  });
});

describe("Reddit audience and profile", () => {
  it("collects keyword authors within one subreddit when the query names it", async () => {
    const { http, calls } = fakeHttp([
      {
        value: {
          data: {
            after: "t3_next",
            children: [
              {
                kind: "t3",
                data: {
                  name: "t3_hit",
                  author: "carol_1",
                  title: "Need a tool",
                  created_utc: 1700000000,
                },
              },
            ],
          },
        },
      },
    ]);
    const result = await createRedditAdapter(http).collectAudience!(account(), "token", {
      kind: "keyword",
      accountId: "a",
      query: "r/bycodatest tool",
    });
    expect(calls[0].url).toContain("/r/bycodatest/search");
    expect(calls[0].url).toContain("restrict_sr=1");
    expect(result.people).toEqual([
      expect.objectContaining({
        platformId: "carol_1",
        kind: "search",
        ref: "t3_hit",
        text: "Need a tool",
      }),
    ]);
    expect(result.next).toBe("t3_next");
  });

  it("refuses audience sources Reddit does not serve", async () => {
    const { http, calls } = fakeHttp([]);
    await expect(
      createRedditAdapter(http).collectAudience!(account(), "token", {
        kind: "mentions",
        accountId: "a",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(calls).toHaveLength(0);
  });

  it("reads commenters of one post from the comments listing", async () => {
    const { http, calls } = fakeHttp([
      {
        value: [
          { data: { children: [] } },
          {
            data: {
              children: [
                {
                  kind: "t1",
                  data: { name: "t1_x", author: "dave_2", body: "+1", created_utc: 1 },
                },
              ],
            },
          },
        ],
      },
    ]);
    const result = await createRedditAdapter(http).collectAudience!(account(), "token", {
      kind: "own_post_comments",
      accountId: "a",
      postRef: "t3_abc123",
    });
    expect(calls[0].url).toContain("/comments/abc123");
    expect(result.people).toEqual([
      expect.objectContaining({ platformId: "dave_2", kind: "comment", ref: "t1_x" }),
    ]);
  });

  it("reports healthy and expired accounts from /api/v1/me", async () => {
    const ok = fakeHttp([{ value: { name: "owner" } }]);
    await expect(createRedditAdapter(ok.http).healthCheck!(account(), "token")).resolves.toEqual({
      ok: true,
    });
    const expired = fakeHttp([new SocialPlatformError("expired")]);
    await expect(
      createRedditAdapter(expired.http).healthCheck!(account(), "token"),
    ).resolves.toEqual({
      ok: false,
      code: "expired",
    });
  });

  it("returns subreddit rules from /about/rules", async () => {
    const { http, calls } = fakeHttp([
      {
        value: {
          rules: [{ short_name: "Be kind", description: "No insults" }, { short_name: "No spam" }],
        },
      },
    ]);
    const rules = await getSubredditRules(http, account(), "token", "bycodatest");
    expect(calls[0].url).toContain("/r/bycodatest/about/rules");
    expect(rules).toEqual([
      { shortName: "Be kind", description: "No insults" },
      { shortName: "No spam", description: "" },
    ]);
  });
});
