import { expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { readInstagramInsights } from "./instagram-insights";

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

it("reads account totals, follow changes, and follower count points separately", async () => {
  const fetcher = vi.fn(async (request: string | URL | Request) => {
    const url = new URL(String(request));
    expect(url.searchParams.get("since")).toBe("1794816000");
    expect(url.searchParams.get("until")).toBe("1794988800");
    if (url.searchParams.get("breakdown") === "follow_type")
      return json({
        data: [
          {
            name: "follows_and_unfollows",
            total_value: {
              breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 3 }] }],
            },
          },
        ],
      });
    if (url.searchParams.get("metric_type") === "time_series")
      return json({
        data: [
          { name: "follower_count", values: [{ value: 2, end_time: "2026-11-17T07:00:00+0000" }] },
        ],
      });
    return json({
      data: [
        { name: "reach", total_value: { value: 0 } },
        { name: "views", total_value: { value: 24 } },
        { name: "shares", total_value: { value: null } },
        { name: "unexpected_metric", total_value: { value: 42 } },
      ],
    });
  });
  const result = await readInstagramInsights(
    new SocialHttp(fetcher),
    "v25.0",
    "fixture",
    "178123",
    {
      since: 1794816000,
      until: 1794988800,
    },
  );
  expect(result.metrics).toEqual({
    reach: { value: 0 },
    views: { value: 24 },
    follows_and_unfollows: { breakdown: [{ dimensions: ["FOLLOWER"], value: 3 }] },
    follower_count: { value: 2, points: [{ value: 2, endTime: "2026-11-17T07:00:00+0000" }] },
  });
  expect(result.unavailable).toContain("shares");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("retains accepted demographic metrics when Meta rejects one metric", async () => {
  const fetcher = vi.fn(async (request: string | URL | Request) => {
    const url = new URL(String(request));
    const metric = url.searchParams.get("metric");
    expect(url.pathname).toBe("/v25.0/178123/insights");
    expect(url.searchParams.get("period")).toBe("lifetime");
    expect(url.searchParams.get("metric_type")).toBe("total_value");
    expect(url.searchParams.get("breakdown")).toBe("country");
    expect(url.searchParams.get("timeframe")).toBe("this_month");
    if (metric === "follower_demographics")
      return json({
        data: [
          {
            name: metric,
            total_value: {
              breakdowns: [
                {
                  results: [
                    { dimension_values: ["TR"], value: 125 },
                    { dimension_values: [null], value: 5 },
                  ],
                },
              ],
            },
          },
        ],
      });
    return json({ error: { code: 100 } }, 400);
  });
  await expect(
    readInstagramInsights(new SocialHttp(fetcher), "v25.0", "fixture", "178123", {
      demographics: "country",
    }),
  ).resolves.toEqual({
    metrics: { follower_demographics: { breakdown: [{ dimensions: ["TR"], value: 125 }] } },
    unavailable: ["engaged_audience_demographics", "reached_audience_demographics"],
  });
});

it("uses Story metrics and stops on a rate limit instead of retrying individual metrics", async () => {
  const fetcher = vi.fn(async (request: string | URL | Request) => {
    const url = new URL(String(request));
    if (url.searchParams.has("fields")) return json({ media_product_type: "STORY" });
    expect(url.pathname).toBe("/v25.0/179456/insights");
    expect(url.searchParams.get("metric")?.split(",")).toContain("navigation");
    expect(url.searchParams.get("metric")?.split(",")).not.toContain("comments");
    return json({ error: { code: 80002 } }, 429);
  });
  await expect(
    readInstagramInsights(new SocialHttp(fetcher), "v25.0", "fixture", "178123", {
      mediaId: "179456",
    }),
  ).rejects.toMatchObject({ code: "rate_limit" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("distinguishes a Story metric below Meta's audience threshold from missing permission", async () => {
  const fetcher = vi.fn(async (request: string | URL | Request) => {
    const url = new URL(String(request));
    if (url.searchParams.has("fields")) return json({ media_product_type: "STORY" });
    const metrics = url.searchParams.get("metric")?.split(",");
    if (metrics?.includes("navigation"))
      return json(
        {
          error: { code: 10, message: "(#10) Not enough viewers for the media to show insights" },
        },
        400,
      );
    return json({ data: [{ name: "views", values: [{ value: 13 }] }] });
  });
  const result = await readInstagramInsights(
    new SocialHttp(fetcher),
    "v25.0",
    "fixture",
    "178123",
    {
      mediaId: "179456",
    },
  );
  expect(result.metrics.views?.value).toBe(13);
  expect(result.unavailable).toContain("navigation");
  fetcher.mockResolvedValue(json({ error: { code: 10, message: "Missing permissions" } }, 400));
  await expect(
    readInstagramInsights(new SocialHttp(fetcher), "v25.0", "fixture", "178123", {
      demographics: "country",
    }),
  ).rejects.toMatchObject({ code: "denied" });
});
