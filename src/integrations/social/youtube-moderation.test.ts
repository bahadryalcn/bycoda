import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import {
  deleteYouTubeComment,
  getYouTubeCommentTarget,
  listYouTubeComments,
  moderateYouTubeComment,
} from "./youtube-moderation";
import { createYouTubeQuota } from "./youtube-quota";

const channel = "UCabcdefghijklmnopqrstuv";
const author = "UC1234567890123456789012";
const id = "UgxFixtureComment01";
const videoId = "fixture0001";
const comment = (writer = author) => ({
  id,
  snippet: {
    authorChannelId: { value: writer },
    authorDisplayName: "Author",
    channelId: channel,
    textDisplay: "Fixture comment",
    moderationStatus: "heldForReview",
  },
});

describe("YouTube comment management", () => {
  it("requires confirmed ownership before calling comments.delete", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const quota = createYouTubeQuota();
    const http = new SocialHttp(fetcher);
    await expect(
      deleteYouTubeComment(http, "token", quota, channel, id, false),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(Response.json({ items: [comment()] }));
    await expect(
      deleteYouTubeComment(http, "token", quota, channel, id, true),
    ).rejects.toMatchObject({ code: "denied" });
    fetcher
      .mockResolvedValueOnce(Response.json({ items: [comment(channel)] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const verify = vi.fn(async () => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    await deleteYouTubeComment(http, "token", quota, channel, id, true, verify);
    expect(verify).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[2][1]?.method).toBe("DELETE");
    expect(quota.usedToday().units).toBe(52);
  });

  it("uses the existing moderation write and requires rejected status to ban an author", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const quota = createYouTubeQuota();
    const http = new SocialHttp(fetcher);
    await expect(
      moderateYouTubeComment(http, "token", quota, id, "published", true),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
    await moderateYouTubeComment(http, "token", quota, id, "heldForReview");
    await moderateYouTubeComment(http, "token", quota, id, "rejected", true);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("moderationStatus")).toBe(
      "heldForReview",
    );
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("banAuthor")).toBe("true");
    expect(quota.usedToday().units).toBe(100);
  });

  it("returns bounded owner comments with author identity and matches a target to its owner and video", async () => {
    const thread = {
      snippet: { channelId: channel, videoId, topLevelComment: comment(), totalReplyCount: 2 },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [thread, { snippet: { ...thread.snippet, channelId: author } }],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(Response.json({ items: [comment()] }))
      .mockResolvedValueOnce(Response.json({ items: [thread] }));
    const quota = createYouTubeQuota();
    const http = new SocialHttp(fetcher);
    await expect(
      listYouTubeComments(http, "token", quota, channel, { status: "heldForReview" }),
    ).resolves.toMatchObject({
      comments: [
        {
          id,
          authorChannelId: author,
          text: "Fixture comment",
          videoId,
          replyCount: 2,
          moderationStatus: "heldForReview",
        },
      ],
      next: "next",
    });
    const query = new URL(String(fetcher.mock.calls[0][0])).searchParams;
    expect(query.get("allThreadsRelatedToChannelId")).toBe(channel);
    expect(query.get("moderationStatus")).toBe("heldForReview");
    await expect(getYouTubeCommentTarget(http, "token", quota, channel, id)).resolves.toMatchObject(
      { authorChannelId: author, channelId: channel, videoId },
    );
    expect(quota.usedToday().units).toBe(3);
  });
});
