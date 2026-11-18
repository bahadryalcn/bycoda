import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import {
  createYouTubeLiveBroadcast,
  listYouTubeLiveChat,
  sendYouTubeLiveChatMessage,
  transitionYouTubeLiveBroadcast,
  type YouTubeLiveCreateInput,
} from "./youtube-live";
import { createYouTubeQuota } from "./youtube-quota";

const now = () => Date.parse("2026-11-18T12:00:00Z");
const broadcastId = "abcdefghijk";
const channelId = "UCabcdefghijklmnopqrstuv";
const chatId = "chat-fixture";
const streamId = "stream-fixture";
const streamKey = "mock-credential-stream-key";
const rtmpUrl = "rtmps://a.rtmps.youtube.com/live2";
const input: YouTubeLiveCreateInput = {
  title: "Scheduled live",
  scheduledStartTime: "2026-11-18T12:30:00Z",
  privacyStatus: "unlisted",
  madeForKids: false,
};
const broadcast = {
  id: broadcastId,
  snippet: { channelId, title: input.title, liveChatId: chatId },
  contentDetails: { boundStreamId: streamId },
  status: { lifeCycleStatus: "ready" },
};
const ingest = {
  id: streamId,
  cdn: { ingestionInfo: { rtmpsIngestionAddress: rtmpUrl, streamName: streamKey } },
};

describe("YouTube Live", () => {
  it("creates and binds a stream after storing the key, with only a reference in the response", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(broadcast))
      .mockResolvedValueOnce(Response.json(ingest))
      .mockResolvedValueOnce(Response.json(broadcast));
    const saveIngest = vi.fn(async () => "youtube-live:mock-reference");
    const beforeWrite = vi.fn(async () => undefined);
    const quota = createYouTubeQuota(now);
    const result = await createYouTubeLiveBroadcast(new SocialHttp(fetcher), "token", quota, input, {
      saveIngest,
      beforeWrite,
      now,
    });
    expect(saveIngest).toHaveBeenCalledWith({ streamId, rtmpUrl, streamKey });
    expect(saveIngest.mock.invocationCallOrder[0]).toBeLessThan(
      fetcher.mock.invocationCallOrder[2],
    );
    expect(beforeWrite).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([raw, options]) => [
      new URL(String(raw)).pathname,
      options?.method,
    ])).toEqual([
      ["/youtube/v3/liveBroadcasts", "POST"],
      ["/youtube/v3/liveStreams", "POST"],
      ["/youtube/v3/liveBroadcasts/bind", "POST"],
    ]);
    expect(result).toMatchObject({
      status: "created",
      broadcast: { id: broadcastId, chatId },
      ingest: { streamId, rtmpUrl, credentialRef: "youtube-live:mock-reference" },
    });
    expect(JSON.stringify(result)).not.toContain(streamKey);
    expect(quota.usedToday().units).toBe(3);
  });

  it("returns known recovery identities after an uncertain bind and avoids resubmission", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(broadcast))
      .mockResolvedValueOnce(Response.json(ingest))
      .mockRejectedValueOnce(new Error(streamKey));
    const saveIngest = vi.fn(async () => "youtube-live:mock-reference");
    const result = await createYouTubeLiveBroadcast(
      new SocialHttp(fetcher), "token", createYouTubeQuota(now), input, { saveIngest, now },
    );
    expect(result).toMatchObject({
      status: "partial", stage: "bind", code: "unknown", broadcastId, streamId,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain(streamKey);
  });

  it("requires a human to enable Live before creating any stream or credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ error: { errors: [{ reason: "liveStreamingNotEnabled" }] } }, { status: 403 }),
    );
    const saveIngest = vi.fn();
    await expect(createYouTubeLiveBroadcast(
      new SocialHttp(fetcher), "token", createYouTubeQuota(now), input, { saveIngest, now },
    )).rejects.toMatchObject({
      code: "needs_human",
      detail: { reasonCode: "youtube_live_not_enabled" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveIngest).not.toHaveBeenCalled();
  });

  it("blocks starting an owned broadcast until its bound stream is receiving encoder data", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [broadcast] }))
      .mockResolvedValueOnce(Response.json({
        items: [{ id: streamId, status: { streamStatus: "inactive" } }],
      }));
    await expect(transitionYouTubeLiveBroadcast(
      new SocialHttp(fetcher), "token", createYouTubeQuota(now), channelId, broadcastId, "live",
    )).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "youtube_live_stream_inactive" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves chat cursors and polling interval and normalizes Super Chat amounts exactly", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        nextPageToken: "provider-token+1=",
        pollingIntervalMillis: 5000,
        items: [{
          id: "LCC.event",
          snippet: {
            type: "superChatEvent",
            displayMessage: "Thanks",
            superChatDetails: {
              amountMicros: "18446744073709551615", currency: "TRY", amountDisplayString: "₺10",
            },
          },
        }],
      }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    const http = new SocialHttp(fetcher);
    const quota = createYouTubeQuota(now);
    const page = await listYouTubeLiveChat(http, "token", quota, chatId);
    expect(page).toMatchObject({
      next: "provider-token+1=",
      pollingIntervalMillis: 5000,
      events: [{
        id: "LCC.event",
        superChat: { amountMicros: "18446744073709551615", currency: "TRY", displayAmount: "₺10" },
      }],
    });
    await listYouTubeLiveChat(http, "token", quota, chatId, page.next);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("pageToken")).toBe(page.next);
    expect(quota.usedToday().units).toBe(10);
  });

  it("sends the provider text-message shape and charges 20 units", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "LCC.reply" }));
    const quota = createYouTubeQuota(now);
    await expect(sendYouTubeLiveChatMessage(
      new SocialHttp(fetcher), "token", quota, chatId, "Welcome!",
    )).resolves.toEqual({ id: "LCC.reply" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      snippet: {
        liveChatId: chatId,
        type: "textMessageEvent",
        textMessageDetails: { messageText: "Welcome!" },
      },
    });
    expect(quota.usedToday().units).toBe(20);
  });
});
