import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import { getYouTubeChannel, updateYouTubeChannel } from "./youtube-channel";
import type { YouTubeManagementContext } from "./youtube-manage";
import { createYouTubeQuota } from "./youtube-quota";
import {
  changeYouTubeSubscription,
  listYouTubeSubscriptions,
  previewYouTubeSubscription,
} from "./youtube-subscriptions";
import {
  addOwnedYouTubePlaylistItem,
  createYouTubePlaylist,
  deleteYouTubePlaylist,
  deleteYouTubeVideo,
  listYouTubePlaylistItems,
  listYouTubePlaylists,
  listYouTubeVideos,
  moveYouTubePlaylistItem,
  removeYouTubePlaylistItem,
  setOwnedYouTubeThumbnail,
  updateYouTubePlaylist,
  updateYouTubeVideo,
} from "./youtube-videos";

const channelId = `UC${"a".repeat(22)}`;
const otherChannelId = `UC${"b".repeat(22)}`;
const videoId = "abcDEF12345";
const otherVideoId = "abcEAB54321";
const now = Date.parse("2026-11-18T07:59:59Z");
const future = now + 60_000;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ownedVideo = {
  id: videoId,
  snippet: {
    title: "Before",
    channelId,
    categoryId: "22",
    description: "Keep",
    tags: ["demo"],
    defaultLanguage: "en",
  },
  status: {
    privacyStatus: "private",
    uploadStatus: "processed",
    embeddable: true,
    publishAt: new Date(future).toISOString(),
  },
};

function fixture(handler: (url: URL, init?: RequestInit) => Response) {
  const fetcher = vi.fn(async (url: URL | string | Request, init?: RequestInit) =>
    handler(new URL(String(url)), init),
  );
  const beforeWrite = vi.fn(async () => undefined);
  const context: YouTubeManagementContext = {
    http: new SocialHttp(fetcher as unknown as typeof fetch, () => now),
    quota: createYouTubeQuota(() => now),
    token: "fixture",
    channelId,
    beforeWrite,
  };
  return { context, fetcher, beforeWrite };
}

function jsonBody(init?: RequestInit): Record<string, any> {
  return JSON.parse(String(init?.body));
}

describe("YouTube video management", () => {
  it("list pages through the uploads playlist, preserving order and excluding foreign videos", async () => {
    const { context } = fixture((url) => {
      if (url.pathname.endsWith("/channels")) {
        expect(url.searchParams.get("mine")).toBe("true");
        return Response.json({
          items: [
            { id: channelId, contentDetails: { relatedPlaylists: { uploads: "UUuploads" } } },
          ],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        expect(url.searchParams.get("playlistId")).toBe("UUuploads");
        expect(url.searchParams.get("pageToken")).toBe("page=2");
        return Response.json({
          items: [videoId, otherVideoId].map((id) => ({ contentDetails: { videoId: id } })),
          nextPageToken: "page3",
        });
      }
      return Response.json({
        items: [
          { ...ownedVideo, id: otherVideoId, snippet: { channelId: otherChannelId } },
          ownedVideo,
        ],
      });
    });
    const page = await listYouTubeVideos(context, "page=2");
    expect(page.items.map((item) => item.id)).toEqual([videoId]);
    expect(page.nextPageToken).toBe("page3");
    expect(context.quota.usedToday().units).toBe(3);
  });

  it("updates one part while retaining existing writable fields and stripping read-only fields", async () => {
    const { context, beforeWrite } = fixture((url, init) => {
      if (init?.method !== "PUT") return Response.json({ items: [ownedVideo] });
      const data = jsonBody(init);
      expect(beforeWrite).toHaveBeenCalledOnce();
      expect(url.searchParams.get("part")).toBe("snippet");
      expect(data).toEqual({
        id: videoId,
        snippet: {
          title: "After",
          description: "Keep",
          categoryId: "22",
          tags: ["demo"],
          defaultLanguage: "en",
        },
      });
      return Response.json(data);
    });
    await expect(
      updateYouTubeVideo(context, videoId, { title: "After" }, now),
    ).resolves.toMatchObject({ title: "After", privacy: "private" });
    expect(context.quota.usedToday().units).toBe(51);
  });

  it("clears a scheduled publication only on explicit removal or visibility change", async () => {
    const { context } = fixture((url, init) => {
      if (init?.method !== "PUT") return Response.json({ items: [ownedVideo] });
      expect(url.searchParams.get("part")).toBe("status");
      const data = jsonBody(init);
      expect(data.status).toEqual({ privacyStatus: "private", embeddable: true });
      return Response.json(data);
    });
    await expect(
      updateYouTubeVideo(context, videoId, { publishAt: null }, now),
    ).resolves.toMatchObject({ privacy: "private", publishAt: undefined });
  });

  it("requires explicit confirmation and verifies video ownership before deleting", async () => {
    const { context, fetcher, beforeWrite } = fixture(() =>
      Response.json({ items: [{ ...ownedVideo, snippet: { channelId: otherChannelId } }] }),
    );
    await expect(deleteYouTubeVideo(context, videoId, false)).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(deleteYouTubeVideo(context, videoId, true)).rejects.toMatchObject({
      code: "denied",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it("reports a Google quota error and never retries a failed write", async () => {
    const { context, fetcher } = fixture((_url, init) => {
      if (init?.method === "DELETE")
        return Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 });
      return Response.json({ items: [ownedVideo] });
    });
    await expect(deleteYouTubeVideo(context, videoId, true)).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(context.quota.usedToday().units).toBe(51);
  });

  it("keeps a thumbnail pending until video processing succeeds", async () => {
    let finished = false;
    const { context, beforeWrite } = fixture((url, init) => {
      if (url.pathname.endsWith("/videos")) {
        return Response.json({
          items: [
            {
              ...ownedVideo,
              processingDetails: { processingStatus: finished ? "succeeded" : "processing" },
            },
          ],
        });
      }
      expect(url.pathname).toBe("/upload/youtube/v3/thumbnails/set");
      expect(init?.headers).toMatchObject({ "Content-Type": "image/jpeg" });
      expect(init?.body).toEqual(jpeg);
      return Response.json({ kind: "youtube#thumbnailSetResponse" });
    });
    await expect(setOwnedYouTubeThumbnail(context, videoId, jpeg)).rejects.toMatchObject({
      code: "processing",
    });
    expect(beforeWrite).not.toHaveBeenCalled();
    finished = true;
    await setOwnedYouTubeThumbnail(context, videoId, jpeg);
    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(context.quota.usedToday().units).toBe(52);
  });

  it("separates daily upload, search, and shared usage at Pacific midnight", () => {
    let at = now;
    const quota = createYouTubeQuota(() => at);
    quota.charge("videos.insert");
    quota.charge("search.list");
    quota.charge("videos.update");
    expect(quota.usedToday()).toEqual({
      day: "2026-11-17",
      uploadCalls: 1,
      searchCalls: 1,
      units: 50,
    });
    at += 1000;
    expect(quota.usedToday()).toEqual({
      day: "2026-11-18",
      uploadCalls: 0,
      searchCalls: 0,
      units: 0,
    });
  });
});

describe("YouTube playlist management", () => {
  const playlist = {
    id: "PLdemo",
    snippet: { channelId, title: "Playlist", description: "Keep", defaultLanguage: "en" },
    status: { privacyStatus: "private", podcastStatus: "enabled" },
  };
  const item = {
    id: "ItemDemo",
    snippet: {
      playlistId: playlist.id,
      resourceId: { kind: "youtube#video", videoId },
      title: "One",
      position: 0,
    },
  };

  it("lists, creates and updates owned playlists with correct list filters", async () => {
    const { context } = fixture((url, init) => {
      if (url.pathname.endsWith("/channels")) return Response.json({ items: [{ id: channelId }] });
      if (init?.method === "POST") return Response.json({ ...jsonBody(init), id: "PLnew" });
      if (init?.method === "PUT") {
        const body = jsonBody(init);
        expect(body).toEqual({
          id: playlist.id,
          snippet: { title: "Playlist", description: "Keep", defaultLanguage: "en" },
          status: { privacyStatus: "unlisted", podcastStatus: "enabled" },
        });
        return Response.json(body);
      }
      if (url.searchParams.has("id")) expect(url.searchParams.has("mine")).toBe(false);
      return Response.json({ items: [playlist], nextPageToken: "next" });
    });
    await expect(listYouTubePlaylists(context)).resolves.toMatchObject({
      items: [{ id: playlist.id }],
      nextPageToken: "next",
    });
    await expect(createYouTubePlaylist(context, { title: "New" })).resolves.toMatchObject({
      id: "PLnew",
      privacy: "private",
    });
    await expect(
      updateYouTubePlaylist(context, playlist.id, { privacy: "unlisted" }),
    ).resolves.toMatchObject({ id: playlist.id, privacy: "unlisted" });
  });

  it("adds, reorders and removes exact items, requiring confirmation for deletion", async () => {
    const { context, fetcher } = fixture((url, init) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/playlists")) return Response.json({ items: [playlist] });
      if (init?.method === "POST") return Response.json({ id: item.id });
      if (init?.method === "PUT") return Response.json(jsonBody(init));
      return Response.json({ items: [item] });
    });
    await expect(listYouTubePlaylistItems(context, playlist.id)).resolves.toMatchObject({
      items: [{ id: item.id, videoId }],
    });
    await expect(addOwnedYouTubePlaylistItem(context, playlist.id, videoId)).resolves.toBe(item.id);
    await expect(moveYouTubePlaylistItem(context, playlist.id, item.id, 2)).resolves.toMatchObject({
      id: item.id,
      position: 2,
    });
    const requests = fetcher.mock.calls.length;
    await expect(
      removeYouTubePlaylistItem(context, playlist.id, item.id, false),
    ).rejects.toMatchObject({ code: "rejected" });
    await expect(deleteYouTubePlaylist(context, playlist.id, false)).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).toHaveBeenCalledTimes(requests);
    await removeYouTubePlaylistItem(context, playlist.id, item.id, true);
    await deleteYouTubePlaylist(context, playlist.id, true);
    const deleted = fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleted.map(([url]) => new URL(String(url)).searchParams.get("id"))).toEqual([
      item.id,
      playlist.id,
    ]);
  });
});

describe("YouTube channel branding", () => {
  const previous = {
    id: channelId,
    snippet: { title: "Channel", customUrl: "@channel" },
    brandingSettings: {
      channel: { title: "Channel", description: "Before", defaultLanguage: "en", keywords: "demo" },
      image: { bannerExternalUrl: "https://yt3.googleusercontent.com/old" },
    },
  };

  it("retains channel settings through a two-step banner upload and fences both writes", async () => {
    const { context, beforeWrite } = fixture((url, init) => {
      if (init?.method === "POST") {
        expect(beforeWrite).toHaveBeenCalledTimes(1);
        expect(url.pathname).toBe("/upload/youtube/v3/channelBanners/insert");
        return Response.json({ url: "https://yt3.googleusercontent.com/banner" });
      }
      if (init?.method === "PUT") {
        expect(beforeWrite).toHaveBeenCalledTimes(2);
        const body = jsonBody(init);
        expect(body).toEqual({
          id: channelId,
          brandingSettings: {
            channel: { description: "After", defaultLanguage: "en", keywords: "demo" },
            image: { bannerExternalUrl: "https://yt3.googleusercontent.com/banner" },
          },
        });
        return Response.json(body);
      }
      return Response.json({ items: [previous] });
    });
    await expect(getYouTubeChannel(context)).resolves.toMatchObject({
      name: "Channel",
      handle: "@channel",
      bannerUrl: "https://yt3.googleusercontent.com/old",
    });
    await expect(
      updateYouTubeChannel(context, { banner: jpeg, description: "After" }),
    ).resolves.toMatchObject({
      name: "Channel",
      description: "After",
      bannerUrl: "https://yt3.googleusercontent.com/banner",
    });
    expect(context.quota.usedToday().units).toBe(102);
  });

  it("rejects invalid patches and mismatched channel identities before a write", async () => {
    const { context, fetcher, beforeWrite } = fixture(() =>
      Response.json({ items: [{ ...previous, id: otherChannelId }] }),
    );
    await expect(updateYouTubeChannel(context, { country: "invalid" })).rejects.toMatchObject({
      code: "rejected",
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(updateYouTubeChannel(context, { banner: jpeg })).rejects.toMatchObject({
      code: "denied",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(beforeWrite).not.toHaveBeenCalled();
  });
});

describe("YouTube subscriptions", () => {
  const subscription = {
    id: "Subscription",
    snippet: { channelId, title: "Target", resourceId: { channelId: otherChannelId } },
  };

  it("previews exact target read-only, then inserts only after the dispatch fence", async () => {
    const { context, beforeWrite } = fixture((url, init) => {
      if (url.pathname.endsWith("/channels")) {
        const id = url.searchParams.get("id") ?? channelId;
        return Response.json({ items: [{ id, snippet: { title: "Target" } }] });
      }
      if (init?.method === "POST") {
        expect(beforeWrite).toHaveBeenCalledOnce();
        expect(jsonBody(init)).toEqual({
          snippet: { resourceId: { kind: "youtube#channel", channelId: otherChannelId } },
        });
        return Response.json(subscription);
      }
      expect(url.searchParams.get("forChannelId")).toBe(otherChannelId);
      return Response.json({ items: [] });
    });
    await expect(previewYouTubeSubscription(context, otherChannelId, "subscribe")).resolves.toEqual(
      {
        channelId: otherChannelId,
        title: "Target",
        action: "subscribe",
        subscribed: false,
        wouldChange: true,
        writeQuotaUnits: 50,
      },
    );
    expect(beforeWrite).not.toHaveBeenCalled();
    await expect(
      changeYouTubeSubscription(context, otherChannelId, "subscribe"),
    ).resolves.toMatchObject({ changed: true, subscribed: true });
    expect(context.quota.usedToday().units).toBe(55);
  });

  it("does not submit when the Host fence denies and never performs a duplicate subscription", async () => {
    let subscribed = true;
    const { context, fetcher, beforeWrite } = fixture((url) =>
      url.pathname.endsWith("/channels")
        ? Response.json({ items: [{ id: channelId }] })
        : Response.json({ items: subscribed ? [subscription] : [] }),
    );
    await expect(
      changeYouTubeSubscription(context, otherChannelId, "subscribe"),
    ).resolves.toMatchObject({ changed: false });
    expect(beforeWrite).not.toHaveBeenCalled();
    subscribed = false;
    beforeWrite.mockRejectedValueOnce(new Error("Host denied"));
    await expect(changeYouTubeSubscription(context, otherChannelId, "subscribe")).rejects.toThrow(
      "Host denied",
    );
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("uses a subscription resource ID for removal and normalizes subscribers with page tokens", async () => {
    const { context } = fixture((url, init) => {
      if (url.pathname.endsWith("/channels")) return Response.json({ items: [{ id: channelId }] });
      if (init?.method === "DELETE") {
        expect(url.searchParams.get("id")).toBe(subscription.id);
        return new Response(null, { status: 204 });
      }
      if (url.searchParams.get("mySubscribers") === "true") {
        expect(url.searchParams.get("pageToken")).toBe("page2");
        return Response.json({
          items: [
            {
              id: "Incoming",
              snippet: { resourceId: { channelId } },
              subscriberSnippet: { channelId: otherChannelId, title: "Subscriber" },
            },
          ],
          nextPageToken: "page3",
        });
      }
      return Response.json({ items: [subscription] });
    });
    await expect(listYouTubeSubscriptions(context, "incoming", "page2")).resolves.toEqual({
      items: [{ id: "Incoming", channelId: otherChannelId, title: "Subscriber" }],
      nextPageToken: "page3",
    });
    await expect(
      changeYouTubeSubscription(context, otherChannelId, "unsubscribe"),
    ).resolves.toMatchObject({ changed: true, subscribed: false });
  });
});
