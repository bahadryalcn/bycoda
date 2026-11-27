import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { readLinkedInAnalytics } from "./linkedin-analytics";

const organization = {
  platform: "linkedin",
  accountType: "organization",
  platformId: "urn:li:organization:123",
  scopes: ["rw_organization_admin"],
} as const;
const member = {
  platform: "linkedin",
  accountType: "member",
  platformId: "urn:li:person:member1",
  scopes: ["r_member_postAnalytics", "r_member_profileAnalytics"],
} as const;
const linkedinVersion = "202609";
const postId = "urn:li:ugcPost:456";
const token = "fixture-token";

describe("LinkedIn analytics API", () => {
  it("reads only the selected organization's organic statistics for a specific post", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, request?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A123&ugcPosts%5B0%5D=urn%3Ali%3AugcPost%3A456",
      );
      const headers = new Headers(request?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("LinkedIn-Version")).toBe(linkedinVersion);
      expect(headers.get("X-Restli-Protocol-Version")).toBe("2.0.0");
      expect(request?.body).toBeUndefined();
      return Response.json({
        elements: [
          {
            organizationalEntity: organization.platformId,
            ugcPost: postId,
            totalShareStatistics: {
              impressionCount: 100,
              uniqueImpressionsCount: 63,
              likeCount: -1,
              shareCount: 2,
              clickCount: 0,
              commentCount: 1,
              engagement: 0.02,
            },
          },
        ],
      });
    });
    await expect(
      readLinkedInAnalytics(new SocialHttp(fetcher), linkedinVersion, organization, token, {
        kind: "posts",
        postId,
      }),
    ).resolves.toEqual({
      source: "api",
      metrics: {
        impressions: 100,
        membersReached: 63,
        likes: -1,
        reshares: 2,
        clicks: 0,
        comments: 1,
        engagementRate: 0.02,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the total member finder and omits metrics the API did not return", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url));
      expect(path.pathname).toBe("/rest/memberCreatorPostAnalytics");
      expect(path.searchParams.get("q")).toBe("me");
      expect(path.searchParams.get("aggregation")).toBe("TOTAL");
      const metricType = path.searchParams.get("queryType");
      return Response.json({
        elements: metricType === "IMPRESSION" ? [{ metricType, count: 500 }] : [],
      });
    });
    await expect(
      readLinkedInAnalytics(new SocialHttp(fetcher), linkedinVersion, member, token, {
        kind: "posts",
      }),
    ).resolves.toEqual({ source: "api", metrics: { impressions: 500 } });
  });

  it("validates the member post entity and metric before returning the data", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url));
      expect(path.searchParams.get("q")).toBe("entity");
      expect(path.searchParams.get("entity")).toBe(`(ugc:${postId})`);
      return Response.json({
        elements: [
          {
            metricType: path.searchParams.get("queryType"),
            targetEntity: { ugc: "urn:li:ugcPost:999" },
            count: 100,
          },
        ],
      });
    });
    await expect(
      readLinkedInAnalytics(new SocialHttp(fetcher), linkedinVersion, member, token, {
        kind: "posts",
        postId,
      }),
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("reads Page views and member follower totals without adding absent metrics", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url));
      if (path.pathname === "/rest/memberFollowersCount") {
        expect(path.searchParams.get("q")).toBe("me");
        return Response.json({ elements: [{ memberFollowersCount: 100 }] });
      }
      expect(path.pathname).toBe("/rest/organizationPageStatistics");
      expect(path.searchParams.get("organization")).toBe(organization.platformId);
      return Response.json({
        elements: [
          {
            organization: organization.platformId,
            totalPageStatistics: { views: { allPageViews: { pageViews: 250 } } },
          },
        ],
      });
    });
    const http = new SocialHttp(fetcher);
    await expect(
      readLinkedInAnalytics(http, linkedinVersion, member, token, { kind: "followers" }),
    ).resolves.toEqual({ source: "api", metrics: { followers: 100 } });
    await expect(
      readLinkedInAnalytics(http, linkedinVersion, organization, token, { kind: "page" }),
    ).resolves.toEqual({ source: "api", metrics: { pageViews: 250 } });
  });

  it("reads the Page follower total separately from truncated demographic facets", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url));
      if (path.pathname.startsWith("/v2/networkSizes/")) {
        expect(decodeURIComponent(path.pathname)).toBe(
          `/v2/networkSizes/${organization.platformId}`,
        );
        expect(path.searchParams.get("edgeType")).toBe("CompanyFollowedByMember");
        return Response.json({ firstDegreeSize: 500 });
      }
      expect(path.pathname).toBe("/rest/organizationalEntityFollowerStatistics");
      expect(path.searchParams.get("organizationalEntity")).toBe(organization.platformId);
      return Response.json({
        elements: [
          {
            organizationalEntity: organization.platformId,
            followerCountsByGeoCountry: [
              {
                geo: "urn:li:geo:1",
                followerCounts: { organicFollowerCount: 35, paidFollowerCount: 4 },
              },
            ],
          },
        ],
      });
    });
    await expect(
      readLinkedInAnalytics(new SocialHttp(fetcher), linkedinVersion, organization, token, {
        kind: "followers",
      }),
    ).resolves.toEqual({
      source: "api",
      metrics: { followers: 500 },
      followerBreakdowns: [{ kind: "geoCountry", values: [{ id: "urn:li:geo:1", followers: 35 }] }],
    });
  });

  it("requires analytics permissions and rejects invalid selectors before calling LinkedIn", async () => {
    const fetcher = vi.fn();
    const http = new SocialHttp(fetcher);
    await expect(
      readLinkedInAnalytics(
        http,
        linkedinVersion,
        { ...organization, scopes: ["r_organization_social"] },
        token,
        { kind: "page" },
      ),
    ).rejects.toMatchObject({
      code: "denied",
      detail: { reasonCode: "linkedin.analytics.access" },
    });
    await expect(
      readLinkedInAnalytics(http, linkedinVersion, member, token, {
        kind: "posts",
        postId: "urn:li:ugcPost:456&aggregation=DAILY",
      }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes provider permissions and rejects other Page data or malformed payloads", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(undefined, { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({
          elements: [
            {
              organizationalEntity: "urn:li:organization:999",
              totalShareStatistics: { impressionCount: 10 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          elements: [
            {
              organizationalEntity: organization.platformId,
              totalShareStatistics: { impressionCount: "never a count" },
            },
          ],
        }),
      );
    const read = () =>
      readLinkedInAnalytics(new SocialHttp(fetcher), linkedinVersion, organization, token, {
        kind: "posts",
      });
    await expect(read()).rejects.toMatchObject({
      code: "denied",
      detail: { reasonCode: "linkedin.analytics.access" },
    });
    await expect(read()).rejects.toMatchObject({ code: "unknown" });
    await expect(read()).rejects.toMatchObject({ code: "unknown" });
  });
});
