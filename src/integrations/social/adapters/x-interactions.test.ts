import { describe, expect, it, vi } from "vitest";
import { SocialHttp, type SocialAccount } from "../adapter";
import { runXEngagement } from "./x-engagement";
import { getXListMembers, getXOwnedLists, runXRelationship } from "./x-relationships";

function fixture(...responses: Record<string, unknown>[]) {
  const account = {
    id: crypto.randomUUID(),
    platformId: "42",
    platform: "x",
    xApiProduct: "enterprise",
  } as SocialAccount;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(responses.shift() ?? {}));
  return { account, fetcher, http: new SocialHttp(fetcher) };
}

describe("X post engagement", () => {
  it.each([
    ["like", "likes", "liked"],
    ["repost", "retweets", "retweeted"],
    ["bookmark", "bookmarks", "bookmarked"],
  ] as const)(
    "sets and clears %s for the authenticated account",
    async (kind, collection, result) => {
      const { account, fetcher, http } = fixture(
        { data: { [result]: true } },
        { data: { [result]: false } },
      );
      await expect(
        runXEngagement(http, account, "test", { kind, postId: "123", enabled: true }),
      ).resolves.toEqual({ postId: "123", enabled: true });
      await expect(
        runXEngagement(http, account, "test", { kind, postId: "123", enabled: false }),
      ).resolves.toEqual({ postId: "123", enabled: false });
      const endpoint = `https://api.x.com/2/users/42/${collection}`;
      expect(fetcher).toHaveBeenNthCalledWith(
        1,
        endpoint,
        expect.objectContaining({ method: "POST", body: '{"tweet_id":"123"}' }),
      );
      expect(fetcher).toHaveBeenNthCalledWith(
        2,
        `${endpoint}/123`,
        expect.objectContaining({ method: "DELETE" }),
      );
    },
  );

  it("uses an explicit reply visibility and refuses to confirm a mismatched response", async () => {
    const { account, fetcher, http } = fixture({ data: { hidden: false } });
    await expect(
      runXEngagement(http, account, "test", { kind: "hideReply", postId: "123", enabled: true }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://api.x.com/2/tweets/123/hidden",
      expect.objectContaining({ method: "PUT", body: '{"hidden":true}' }),
    );
  });

  it.each([true, false])("confirms X reply visibility when hidden is %s", async (enabled) => {
    const { account, http } = fixture({ data: { hidden: enabled } });
    await expect(
      runXEngagement(http, account, "test", { kind: "hideReply", postId: "123", enabled }),
    ).resolves.toEqual({ postId: "123", enabled });
  });

  it.each(["../123", "000123", "12345678901234567890"])(
    "rejects invalid post ID %s before I/O",
    async (postId) => {
      const { account, fetcher, http } = fixture();
      await expect(
        runXEngagement(http, account, "test", { kind: "bookmark", postId, enabled: true }),
      ).rejects.toMatchObject({ code: "rejected" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe("X relationships and lists", () => {
  it.each([
    ["follow", "following"],
    ["mute", "muting"],
    ["block", "blocking"],
  ] as const)("sets and clears %s against the specific target", async (kind, collection) => {
    const { account, fetcher, http } = fixture(
      { data: { [collection]: true } },
      { data: { [collection]: false } },
    );
    await expect(
      runXRelationship(http, account, "test", { kind, userId: "84", enabled: true }),
    ).resolves.toEqual({ userId: "84", enabled: true });
    await expect(
      runXRelationship(http, account, "test", { kind, userId: "84", enabled: false }),
    ).resolves.toEqual({ userId: "84", enabled: false });
    const endpoint = `https://api.x.com/2/users/42/${collection}`;
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      endpoint,
      expect.objectContaining({ method: "POST", body: '{"target_user_id":"84"}' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `${endpoint}/84`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("reports a protected user's pending follow without retrying", async () => {
    const { account, fetcher, http } = fixture({
      data: { following: false, pending_follow: true },
    });
    await expect(
      runXRelationship(http, account, "test", { kind: "follow", userId: "84", enabled: true }),
    ).resolves.toEqual({ userId: "84", enabled: false, pending: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not call Enterprise block endpoints with self-serve credentials", async () => {
    const { account, fetcher, http } = fixture();
    await expect(
      runXRelationship(http, { ...account, xApiProduct: "pay-per-use" }, "test", {
        kind: "block",
        userId: "84",
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates, updates and deletes a specific list", async () => {
    const { account, fetcher, http } = fixture(
      { data: { id: "17", name: "News" } },
      { data: { updated: true } },
      { data: { deleted: true } },
    );
    await expect(
      runXRelationship(http, account, "test", { kind: "createList", name: "News", private: true }),
    ).resolves.toEqual({ listId: "17", name: "News" });
    await expect(
      runXRelationship(http, account, "test", {
        kind: "updateList",
        listId: "17",
        description: "",
        private: false,
      }),
    ).resolves.toEqual({ listId: "17", updated: true });
    await expect(
      runXRelationship(http, account, "test", { kind: "deleteList", listId: "17" }),
    ).resolves.toEqual({ listId: "17", deleted: true });
    const endpoint = "https://api.x.com/2/lists";
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      endpoint,
      expect.objectContaining({ method: "POST", body: '{"name":"News","private":true}' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `${endpoint}/17`,
      expect.objectContaining({ method: "PUT", body: '{"description":"","private":false}' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `${endpoint}/17`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("adds and removes memberships only for the requested list and user", async () => {
    const { account, fetcher, http } = fixture(
      { data: { is_member: true } },
      { data: { is_member: false } },
    );
    await expect(
      runXRelationship(http, account, "test", {
        kind: "addListMember",
        listId: "17",
        userId: "84",
      }),
    ).resolves.toEqual({ listId: "17", userId: "84", member: true });
    await expect(
      runXRelationship(http, account, "test", {
        kind: "removeListMember",
        listId: "17",
        userId: "84",
      }),
    ).resolves.toEqual({ listId: "17", userId: "84", member: false });
    const endpoint = "https://api.x.com/2/lists/17/members";
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      endpoint,
      expect.objectContaining({ method: "POST", body: '{"user_id":"84"}' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `${endpoint}/84`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("rejects invalid list mutations and self-follow before I/O", async () => {
    const { account, fetcher, http } = fixture();
    await expect(
      runXRelationship(http, account, "test", { kind: "createList", name: " " }),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(
      runXRelationship(http, account, "test", { kind: "updateList", listId: "17" }),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(
      runXRelationship(http, account, "test", { kind: "follow", userId: "42", enabled: true }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads one paid list or member page and preserves the next cursor", async () => {
    const { account, fetcher, http } = fixture(
      {
        data: [{ id: "17", name: "News", description: "Daily", private: true, member_count: 1 }],
        meta: { next_token: "100" },
      },
      { data: [{ id: "84", name: "Alex", username: "alex", raw: "ignored" }] },
      { meta: { result_count: 0 } },
    );
    await expect(getXOwnedLists(http, account, "test", "90&max_results=100")).resolves.toEqual({
      items: [{ id: "17", name: "News", description: "Daily", private: true, memberCount: 1 }],
      next: "100",
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/2/users/42/owned_lists");
    expect(url.searchParams.get("max_results")).toBe("25");
    expect(url.searchParams.get("pagination_token")).toBe("90&max_results=100");
    await expect(getXListMembers(http, account, "test", "17")).resolves.toEqual({
      items: [{ id: "84", name: "Alex", username: "alex" }],
    });
    await expect(getXListMembers(http, account, "test", "17", "100")).resolves.toEqual({
      items: [],
    });
  });
});
