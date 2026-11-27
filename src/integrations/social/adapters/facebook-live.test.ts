import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { facebookEncoderUrl, facebookLiveApi } from "./facebook-live";

describe("Facebook Live Graph", () => {
  it("creates an unpublished broadcast and accepts only the secure ingest URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "444",
        secure_stream_url: "rtmps://live-api-s.facebook.com:443/rtmp/test-key",
        stream_url: "rtmp://live-api-s.facebook.com/rtmp/plain-key",
      }),
    );
    const api = facebookLiveApi(new SocialHttp(fetcher), "v25.0");
    await expect(api.create("111", "page-token", "Live title")).resolves.toEqual({
      id: "444",
      encoderUrl: "rtmps://live-api-s.facebook.com:443/rtmp/test-key",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v25.0/111/live_videos");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      status: "UNPUBLISHED",
      title: "Live title",
    });
    expect(facebookEncoderUrl("rtmps://facebook.com.evil.test/rtmp/key")).toBeUndefined();
    expect(facebookEncoderUrl("rtmp://live-api-s.facebook.com/rtmp/key")).toBeUndefined();
    expect(facebookEncoderUrl("rtmps://username@live-api-s.facebook.com/rtmp/key")).toBeUndefined();
  });

  it("maps live and ended status, checks Page identity, and submits documented update parameters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "444", from: { id: "111" }, status: "LIVE" }))
      .mockResolvedValueOnce(
        Response.json({ id: "444", from: { id: "111" }, status: "PROCESSING" }),
      )
      .mockResolvedValueOnce(Response.json({ id: "444", from: { id: "222" }, status: "LIVE" }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const api = facebookLiveApi(new SocialHttp(fetcher), "v25.0");
    await expect(api.status("444", "token", "111")).resolves.toBe("live");
    await expect(api.status("444", "token", "111")).resolves.toBe("ended");
    await expect(api.status("444", "token", "111")).rejects.toMatchObject({ code: "denied" });
    await api.update("444", "token", "start");
    await api.update("444", "token", "end");
    expect(
      fetcher.mock.calls.slice(-2).map(([, options]) => JSON.parse(String(options?.body))),
    ).toEqual([{ status: "LIVE_NOW" }, { end_live_video: true }]);
  });

  it("returns only the Graph cursor and refuses to mark an anonymous comment replyable", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            id: "444_555",
            message: "Hello",
            from: { id: "99", name: "Test" },
            created_time: "2026-11-18T08:00:00Z",
            can_comment: true,
          },
          { id: "444_556", message: "Anonymous", can_comment: true },
        ],
        paging: {
          next: "https://graph.facebook.com/?access_token=secret",
          cursors: { after: "cursor" },
        },
        secure_stream_url: "rtmps://live-api-s.facebook.com/rtmp/key",
      }),
    );
    const api = facebookLiveApi(new SocialHttp(fetcher), "v25.0");
    const result = await api.comments("444", "token", "foo&access_token=forged");
    expect(result).toEqual({
      comments: [
        {
          id: "444_555",
          text: "Hello",
          authorId: "99",
          authorName: "Test",
          at: Date.parse("2026-11-18T08:00:00Z"),
          canReply: true,
        },
        { id: "444_556", text: "Anonymous", canReply: false },
      ],
      next: "cursor",
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("access_token")).toBeNull();
  });
});
