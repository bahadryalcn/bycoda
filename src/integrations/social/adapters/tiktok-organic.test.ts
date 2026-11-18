import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { readTikTokDisplay, TikTokOrganic } from "./tiktok-organic";

const credential = { businessId: "-business", accessToken: "mock-business-token" };
const postId = "7000000000000000001";
const commentId = "7000000000000000002";
const replyId = "7000000000000000003";
const target = {
  video_id: postId,
  comment_id: commentId,
  username: "Creator.One",
  display_name: "Creator One",
  text: "Hello",
  create_time: "1627617835",
  status: "PUBLIC",
  owner: false,
};

function response(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), { status, headers });
}

const ok = (data?: unknown) => response({ code: 0, data });
const page = (comments = [target], next?: number) =>
  ok({ comments, has_more: next !== undefined, cursor: next ?? 0 });

function mockFetch() {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
}

describe("TikTok Organic Accounts API", () => {
  it("refuses use before app approval or with invalid credential fields", async () => {
    const fetcher = mockFetch();
    await expect(new TikTokOrganic(false, fetcher).profile(credential)).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      new TikTokOrganic(true, fetcher).profile({ ...credential, accessToken: "token\r\nbad" }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requests only the opted-in profile fields, verifies the handle and uses a credential header", async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(ok({ display_name: "Merchant", username: "Merchant.One" }))
      .mockResolvedValueOnce(ok({ display_name: "Merchant", username: "Merchant.One", followers_count: 1 }))
      .mockResolvedValueOnce(ok({ display_name: "Merchant" }));
    const organic = new TikTokOrganic(true, fetcher);
    await expect(organic.profile(credential)).resolves.toMatchObject({
      name: "Merchant", username: "merchant.one", followers: undefined,
    });
    await expect(organic.profile(credential, { stats: true })).resolves.toMatchObject({ followers: 1 });
    await expect(organic.profile(credential)).rejects.toMatchObject({ code: "denied" });
    const [url, init] = fetcher.mock.calls[0];
    const request = new URL(String(url));
    expect(request.pathname).toBe("/open_api/v1.3/business/get/");
    expect(request.searchParams.get("business_id")).toBe(credential.businessId);
    expect(request.searchParams.get("fields")).toBe('["display_name","username"]');
    expect(request.href).not.toContain(credential.accessToken);
    expect(init).toMatchObject({
      method: "GET", redirect: "error", headers: { "Access-Token": credential.accessToken },
    });
  });

  it("returns a bounded post-comment page and preserves its cursor", async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(page([target], 5));
    const organic = new TikTokOrganic(true, fetcher);
    await expect(organic.comments(credential, postId, 2)).resolves.toMatchObject({
      comments: [{
        postId, id: commentId, username: "creator.one", author: "Creator One",
        at: 1627617835000, hidden: false, owned: false,
      }],
      next: 5,
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("cursor")).toBe("2");
    expect(url.searchParams.get("video_id")).toBe(postId);
  });

  it("returns Business video reach, counts and a continuation without inventing metrics", async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(
      ok({
        videos: [{
          item_id: postId, caption: "Post", create_time: "1627617835",
          likes: 0, video_views: 1234, reach: 996, shares: -1,
        }],
        cursor: 1627617835000,
        has_more: true,
      }),
    );
    const organic = new TikTokOrganic(true, fetcher);
    await expect(organic.videos(credential, 1627617836000)).resolves.toEqual({
      posts: [{ id: postId, text: "Post", at: 1627617835000 }],
      metrics: {
        [postId]: { views: 1234, likes: 0, reach: 996, comments: undefined, shares: undefined },
      },
      next: 1627617835000,
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/open_api/v1.3/business/video/list/");
    expect(url.searchParams.get("cursor")).toBe("1627617836000");
    expect(JSON.parse(url.searchParams.get("fields")!)).toEqual(expect.arrayContaining(["item_id", "reach"]));
  });

  it("rejects an ambiguous post ID or a stalled video continuation", async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(ok({ videos: [{ item_id: 1, create_time: "1627617835" }], has_more: false }))
      .mockResolvedValueOnce(ok({ videos: [], has_more: true, cursor: 1000 }));
    const organic = new TikTokOrganic(true, fetcher);
    await expect(organic.videos(credential)).rejects.toMatchObject({ code: "unknown" });
    await expect(organic.videos(credential, 1000)).rejects.toMatchObject({ code: "unknown" });
  });

  it("requests the explicit mention fields needed to parse provider results", async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(
      ok({
        comments: [{
          item_id: postId, comment_id: commentId, commenter_display_name: "Mention.Author",
          comment_text: "@merchant", comment_create_time: "1698616575",
        }],
        has_more: false,
      }),
    );
    const organic = new TikTokOrganic(true, fetcher);
    await expect(organic.mentions(credential)).resolves.toMatchObject({
      comments: [{ id: commentId, postId, username: "mention.author", text: "@merchant", at: 1698616575000 }],
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/open_api/v1.3/business/mention/comment/list/");
    expect(JSON.parse(url.searchParams.get("fields")!)).toContain("item_id");
  });

  it.each([
    { action: "like", path: "like", expected: { action: "LIKE" } },
    { action: "hide", path: "hide", expected: { action: "HIDE", video_id: postId } },
    { action: "delete", path: "delete", expected: {} },
    { action: "reply", path: "reply/create", expected: { video_id: postId, text: "Thanks!" } },
  ] as const)("rechecks the exact comment and author before $action", async ({ action, path, expected }) => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(ok(action === "reply" ? { comment_id: replyId } : undefined));
    const beforeSubmit = vi.fn(async () => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    const organic = new TikTokOrganic(true, fetcher);
    await expect(
      organic.mutateComment(credential, { postId, commentId, action, text: "Thanks!" }, beforeSubmit),
    ).resolves.toEqual({ platformId: action === "reply" ? replyId : commentId });
    expect(beforeSubmit).toHaveBeenCalledWith(expect.objectContaining({ username: "creator.one" }));
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("comment_ids")).toBe(
      JSON.stringify([commentId]),
    );
    const [url, init] = fetcher.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(`/open_api/v1.3/business/comment/${path}/`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      ...expected, comment_id: commentId, business_id: credential.businessId,
    });
  });

  it("blocks a wrong target and a failed Host authorization before submission", async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(page([{ ...target, comment_id: replyId }]))
      .mockResolvedValueOnce(page());
    const organic = new TikTokOrganic(true, fetcher);
    const authorize = vi.fn().mockRejectedValue(new Error("Recipient suppressed"));
    const change = { postId, commentId, action: "like" } as const;
    await expect(organic.mutateComment(credential, change, authorize)).rejects.toMatchObject({ code: "denied" });
    expect(authorize).not.toHaveBeenCalled();
    await expect(organic.mutateComment(credential, change, authorize)).rejects.toThrow("Recipient suppressed");
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET"]);
  });

  it.each([
    { status: 200, provider: 40105, code: "expired" },
    { status: 401, provider: undefined, code: "expired" },
    { status: 200, provider: 40001, code: "denied" },
    { status: 200, provider: 40100, code: "rate_limit", retryAt: 8000 },
    { status: 429, provider: undefined, code: "rate_limit", retryAt: 8000 },
    { status: 200, provider: 40002, code: "rejected" },
    { status: 503, provider: undefined, code: "unknown" },
  ])("maps HTTP $status and provider $provider without exposing diagnostics", async ({ status, provider, code, retryAt }) => {
    const fetcher = mockFetch().mockResolvedValueOnce(
      response({ code: provider, message: credential.accessToken }, status, { "retry-after": "7" }),
    );
    const organic = new TikTokOrganic(true, fetcher, () => 1000);
    const error: unknown = await organic.profile(credential).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code, retryAt });
    expect(String(error)).not.toContain(credential.accessToken);
  });

  it("treats a torn reply acknowledgment as uncertain after one submission", async () => {
    const fetcher = mockFetch()
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error(credential.accessToken));
    const organic = new TikTokOrganic(true, fetcher);
    const error: unknown = await organic
      .mutateComment(credential, { postId, commentId, action: "reply", text: "Thanks" }, async () => {})
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "unknown" });
    expect(String(error)).not.toContain(credential.accessToken);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("TikTok Display profile", () => {
  it("requests only granted fields and leaves missing counts unavailable", async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(
      response({
        error: { code: "ok" },
        data: { user: { open_id: "saved", username: "ignored", display_name: "Member", follower_count: 0 } },
      }),
    );
    const http = new SocialHttp(fetcher);
    await expect(readTikTokDisplay(http, "mock-login-token", "saved", ["user.info.stats"])).resolves.toMatchObject({
      name: "Member", username: undefined, followers: 0, posts: undefined,
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("fields")?.split(",")).toContain("follower_count");
    expect(url.searchParams.get("fields")?.split(",")).not.toContain("username");
  });

  it("rejects a token bound to a different user", async () => {
    const fetcher = mockFetch().mockResolvedValueOnce(
      response({ error: { code: "ok" }, data: { user: { open_id: "other", display_name: "Member" } } }),
    );
    await expect(readTikTokDisplay(new SocialHttp(fetcher), "mock-login-token", "saved", [])).rejects.toMatchObject({
      code: "denied",
    });
  });
});
