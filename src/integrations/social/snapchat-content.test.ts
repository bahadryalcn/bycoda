import { describe, expect, it, vi } from "vitest";
import { SocialHttp, SocialPlatformError } from "./adapter";
import {
  deleteSnapchatContent,
  listSnapchatContent,
  verifySnapchatSavedStorySources,
} from "./snapchat-content";

const actorId = "11111111-1111-1111-1111-111111111111";
const otherActor = "99999999-9999-9999-9999-999999999999";
const storyId = "22222222-2222-2222-2222-222222222222";
const snapId = "Snap_Id_123456789";
const account = {
  platform: "snapchat",
  platformId: actorId,
  accountType: "public_profile",
  connection: "oauth",
  scopes: ["snapchat-profile-api"],
};
const profile = `/v1/public_profiles/${actorId}`;
const ok = (payload: Record<string, unknown> = {}) =>
  Response.json({ request_status: "SUCCESS", ...payload });
function fixture(payload: Record<string, unknown>, identity = actorId) {
  const fetcher = vi.fn(async (input: unknown, options?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://businessapi.snapchat.com");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer credential" });
    if (url.pathname.endsWith("/my_profile")) return ok({ public_profile: { id: identity } });
    return ok(payload);
  });
  return { http: new SocialHttp(fetcher), fetcher };
}

describe("Snapchat content library", () => {
  it("lists an account's Spotlight and keeps status and opaque cursor", async () => {
    const { http, fetcher } = fixture({
      request_status: "PARTIAL",
      paging: { next_page_id: "next&limit=2", next_link: "https://evil.invalid/credentials" },
      spotlights: [
        {
          sub_request_status: "SUCCESS",
          spotlight: { id: snapId, profile_id: actorId, status: "LIVE", title: "Launch" },
        },
        {
          sub_request_status: "SUCCESS",
          spotlight: { id: "some_other_snap", profile_id: otherActor, status: "LIVE" },
        },
        { sub_request_status: "ERROR" },
      ],
    });
    const result = await listSnapchatContent(http, account, "credential", {
      target: "spotlight",
      cursor: "first&limit=5",
      limit: 4,
    });
    expect(result).toMatchObject({
      items: [{ id: snapId, target: "spotlight", title: "Launch", status: "live" }],
      partial: true,
      cursor: "next&limit=2",
    });
    const url = new URL(String(fetcher.mock.calls[1][0]));
    expect(url.pathname).toBe(`${profile}/spotlights`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "4", cursor: "first&limit=5" });
  });

  it.each(["story", "saved_story"] as const)(
    "lists children within the exact %s",
    async (target) => {
      const createdAt = "2026-11-18T09:00:00.000Z";
      const endedAt = "2026-11-19T09:00:00.000Z";
      const { http, fetcher } = fixture({
        snaps: [
          {
            sub_request_status: "SUCCESS",
            snap: { id: snapId, story_id: storyId, caption: "Caption" },
          },
        ],
      });
      const result = await listSnapchatContent(http, account, "credential", {
        target,
        id: storyId,
        createdAt,
        endedAt,
      });
      expect(result).toMatchObject({
        items: [{ id: snapId, target, parentId: storyId, caption: "Caption" }],
        partial: false,
      });
      const url = new URL(String(fetcher.mock.calls[1][0]));
      const collection = target === "story" ? "stories" : "saved_stories";
      expect(url.pathname).toBe(`${profile}/${collection}/${storyId}/snaps`);
      expect(url.searchParams.get("created_at")).toBe(target === "story" ? createdAt : null);
      expect(url.searchParams.get("ended_at")).toBe(target === "story" ? endedAt : null);
    },
  );

  it("rejects an exact Spotlight result with a different ID", async () => {
    const { http } = fixture({
      spotlights: [
        { sub_request_status: "SUCCESS", spotlight: { id: snapId, profile_id: actorId } },
      ],
    });
    await expect(
      listSnapchatContent(http, account, "credential", {
        target: "spotlight",
        id: "other_spotlight_id",
      }),
    ).resolves.toMatchObject({ items: [], partial: true });
  });
});

describe("Snapchat Saved Story source scope", () => {
  it("proves exact Spotlight and paginated Public Story Snap IDs under one profile", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        ok({
          spotlights: [
            { sub_request_status: "SUCCESS", spotlight: { id: snapId, profile_id: actorId } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          stories: [{ sub_request_status: "SUCCESS", story: { id: storyId, profile_id: actorId } }],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          snaps: [],
          paging: { next_page_id: "next&limit=1", next_link: "https://other.invalid" },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          snaps: [{ sub_request_status: "SUCCESS", snap: { id: snapId, story_id: storyId } }],
        }),
      );

    await expect(
      verifySnapchatSavedStorySources(new SocialHttp(fetcher), actorId, "credential", [
        { kind: "spotlight", id: snapId },
        { kind: "snap", id: snapId },
      ]),
    ).resolves.toBeUndefined();
    const urls = fetcher.mock.calls.map(([raw]) => new URL(String(raw)));
    expect(urls.map((url) => url.pathname)).toEqual([
      `${profile}/spotlights/${snapId}`,
      `${profile}/stories`,
      `${profile}/stories/${storyId}/snaps`,
      `${profile}/stories/${storyId}/snaps`,
    ]);
    expect(urls[3].searchParams.get("cursor")).toBe("next&limit=1");
  });

  it("refuses a Spotlight returned for a different profile before doing any further reads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      ok({
        spotlights: [
          { sub_request_status: "SUCCESS", spotlight: { id: snapId, profile_id: otherActor } },
        ],
      }),
    );
    await expect(
      verifySnapchatSavedStorySources(new SocialHttp(fetcher), actorId, "credential", [
        { kind: "spotlight", id: snapId },
      ]),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refuses the exact Snap ID if the returned parent differs from the Public Story", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        ok({
          stories: [{ sub_request_status: "SUCCESS", story: { id: storyId, profile_id: actorId } }],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          snaps: [{ sub_request_status: "SUCCESS", snap: { id: snapId, story_id: otherActor } }],
        }),
      );
    await expect(
      verifySnapchatSavedStorySources(new SocialHttp(fetcher), actorId, "credential", [
        { kind: "snap", id: snapId },
      ]),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("Snapchat content deletion", () => {
  it.each([
    ["spotlight", snapId, "spotlights"],
    ["saved_story", storyId, "saved_stories"],
  ] as const)(
    "deletes only the confirmed %s of the OAuth profile",
    async (target, id, collection) => {
      const { http, fetcher } = fixture({});
      const before = vi.fn(async () => expect(fetcher).toHaveBeenCalledTimes(1));
      await expect(
        deleteSnapchatContent(
          http,
          account,
          "credential",
          {
            target,
            id,
            confirmId: id,
          },
          before,
        ),
      ).resolves.toEqual({ target, id });
      expect(before).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe(
        `${profile}/${collection}/${id}`,
      );
      expect(fetcher.mock.calls[1][1]?.method).toBe("DELETE");
    },
  );

  it("refuses malformed and unconfirmed IDs without network access", async () => {
    const { http, fetcher } = fixture({});
    await expect(
      deleteSnapchatContent(http, account, "credential", {
        target: "spotlight",
        id: snapId,
        confirmId: "another_id",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(
      deleteSnapchatContent(http, account, "credential", {
        target: "saved_story",
        id: "../spotlights",
        confirmId: "../spotlights",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a mismatched OAuth identity before delete", async () => {
    const { http, fetcher } = fixture({}, otherActor);
    await expect(
      deleteSnapchatContent(http, account, "credential", {
        target: "spotlight",
        id: snapId,
        confirmId: snapId,
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("propagates a last-moment guard and never issues DELETE", async () => {
    const { http, fetcher } = fixture({});
    await expect(
      deleteSnapchatContent(
        http,
        account,
        "credential",
        {
          target: "spotlight",
          id: snapId,
          confirmId: snapId,
        },
        async () => {
          throw new SocialPlatformError("denied");
        },
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("keeps uncertain delete responses unknown without another DELETE", async () => {
    const { http, fetcher } = fixture({
      request_status: "UNRECOGNIZED",
      debug_message: "sensitive",
    });
    await expect(
      deleteSnapchatContent(http, account, "credential", {
        target: "spotlight",
        id: snapId,
        confirmId: snapId,
      }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
