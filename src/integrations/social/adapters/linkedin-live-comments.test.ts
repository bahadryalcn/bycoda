import { describe, expect, it, vi } from "vitest";
import { SocialHttp, type SocialAccount } from "../adapter";
import { readLinkedInLiveComments } from "./linkedin-live-comments";

const eventId = "7246559654799892480";
const postId = "urn:li:ugcPost:7246780305028571136";
const account = {
  platform: "linkedin",
  accountType: "organization",
  connection: "oauth",
  platformId: "urn:li:organization:7185861",
  scopes: ["r_events", "r_organization_social_feed"],
} as SocialAccount;
const event = {
  organizer: account.platformId,
  ugcPost: postId,
  type: { online: { format: { liveVideo: {} } } },
};
const comment = {
  actor: "urn:li:person:fixture",
  object: "urn:li:activity:6631349431612559360",
  id: "6636062862760562688",
  message: { text: "Is there a demo?" },
};

describe("LinkedIn Live comments", () => {
  it("reads a bounded page from the exact Live event post without rounding provider identifiers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(event))
      .mockResolvedValueOnce(
        Response.json({ elements: Array(50).fill(comment), paging: { total: 200 } }),
      );
    const result = await readLinkedInLiveComments(
      new SocialHttp(fetcher),
      "202609",
      account,
      "fixture",
      eventId,
      50,
    );
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.linkedin.com/rest/events/${eventId}`,
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments?count=50&start=50`,
    ]);
    expect(result).toEqual({
      eventId,
      postId,
      nextOffset: 100,
      comments: [
        {
          id: "urn:li:comment:(urn:li:activity:6631349431612559360,6636062862760562688)",
          actor: comment.actor,
          text: comment.message.text,
        },
      ],
    });
  });

  it.each([
    [{ ...event, organizer: "urn:li:organization:456" }, "denied"],
    [{ ...event, type: { online: { format: { external: {} } } } }, "unsupported"],
    [{ ...event, ugcPost: undefined }, "unsupported"],
  ])("stops before reading comments on an invalid event", async (value, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(value));
    await expect(
      readLinkedInLiveComments(new SocialHttp(fetcher), "202609", account, "fixture", eventId, 0),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires both provider permissions and rejects invalid event IDs before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const http = new SocialHttp(fetcher);
    await expect(
      readLinkedInLiveComments(
        http,
        "202609",
        { ...account, scopes: ["r_events"] },
        "fixture",
        eventId,
        0,
      ),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(
      readLinkedInLiveComments(http, "202609", account, "fixture", "1/other", 0),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
