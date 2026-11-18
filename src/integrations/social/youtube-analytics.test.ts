import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "./adapter";
import {
  queryYouTubeAnalytics,
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_MONETARY_SCOPE,
  YOUTUBE_READ_SCOPE,
} from "./youtube-analytics";

const channelId = "UCabcdefghijklmnopqrstuv";
const range = { startDate: "2026-11-01", endDate: "2026-11-17" };

describe("YouTube Analytics channel reports", () => {
  it("authenticates against Analytics and aligns rows by header name", async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(raw));
      expect(url.origin).toBe("https://youtubeanalytics.googleapis.com");
      expect(url.pathname).toBe("/v2/reports");
      expect(url.searchParams.get("ids")).toBe(`channel==${channelId}`);
      expect(url.searchParams.get("dimensions")).toBe("insightTrafficSourceType");
      expect(url.searchParams.get("sort")).toBe("-views");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer mock-token" });
      expect(init?.redirect).toBe("error");
      return Response.json({
        columnHeaders: ["estimatedMinutesWatched", "insightTrafficSourceType", "views"].map(
          (name) => ({ name }),
        ),
        rows: [[20, "YT_SEARCH", 55]],
      });
    });
    expect(
      await queryYouTubeAnalytics(
        new SocialHttp(fetcher),
        "mock-token",
        { channelId, scopes: [YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_SCOPE] },
        { ...range, kind: "traffic" },
      ),
    ).toMatchObject({
      status: "ok",
      columns: [
        { name: "insightTrafficSourceType", type: "dimension" },
        { name: "views", type: "metric" },
        { name: "estimatedMinutesWatched", type: "metric" },
      ],
      rows: [{ insightTrafficSourceType: "YT_SEARCH", views: 55, estimatedMinutesWatched: 20 }],
    });
  });

  it("reports a missing monetary grant without making an earnings request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const account = { channelId, scopes: [YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_SCOPE] };
    expect(
      await queryYouTubeAnalytics(new SocialHttp(fetcher), "mock-token", account, {
        ...range,
        kind: "earnings",
      }),
    ).toEqual({
      status: "needs_scope",
      reasonCode: "youtube_monetary_scope_required",
      requiredScopes: [YOUTUBE_MONETARY_SCOPE],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns an empty earnings report in the requested currency", async () => {
    const fetcher = vi.fn(async (raw: RequestInfo | URL) => {
      const url = new URL(String(raw));
      expect(url.searchParams.get("currency")).toBe("TRY");
      expect(url.searchParams.get("metrics")).toBe(
        "estimatedRevenue,estimatedAdRevenue,monetizedPlaybacks,cpm",
      );
      return Response.json({
        columnHeaders: ["estimatedRevenue", "estimatedAdRevenue", "monetizedPlaybacks", "cpm"].map(
          (name) => ({ name }),
        ),
      });
    });
    expect(
      await queryYouTubeAnalytics(
        new SocialHttp(fetcher),
        "mock-token",
        { channelId, scopes: [YOUTUBE_READ_SCOPE, YOUTUBE_MONETARY_SCOPE] },
        { ...range, kind: "earnings", currency: "TRY" },
      ),
    ).toMatchObject({ status: "ok", rows: [], currency: "TRY" });
  });

  it("rejects invalid calendar dates before spending quota", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      queryYouTubeAnalytics(
        new SocialHttp(fetcher),
        "mock-token",
        { channelId, scopes: [YOUTUBE_READ_SCOPE, YOUTUBE_ANALYTICS_SCOPE] },
        { startDate: "2026-02-30", endDate: "2026-03-02", kind: "daily" },
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
