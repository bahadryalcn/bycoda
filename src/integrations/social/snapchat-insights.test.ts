import { describe, expect, it, vi } from "vitest";
import { getSnapchatEarnings, getSnapchatInsights } from "./snapchat-insights";

const profileId = "11111111-1111-1111-1111-111111111111";
const storyId = "22222222-2222-2222-2222-222222222222";
const snapId = "example_snap_id";
const accessToken = "test-private-token";
const now = () => Date.parse("2026-11-18T12:30:00Z");
const profilePath = `/v1/public_profiles/${profileId}`;

function fixture(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    ctx: { profileId, accessToken, now, fetch },
    fetch,
    url: (call = 0) => new URL(String(fetch.mock.calls[call]?.[0])),
  };
}

function successfulAsset(assetType: string, id: string, fields: unknown[] = []) {
  return {
    sub_request_status: "SUCCESS",
    asset_type: assetType,
    asset_id: id,
    timeseries: [{ fields, end_time: "2026-11-17T00:00:00Z" }],
  };
}

describe("Snapchat insights", () => {
  it("reads aggregate subscriber numbers and preserves breakdown percentages and pagination", async () => {
    const { ctx, url, fetch } = fixture(
      Response.json({
        request_status: "SUCCESS",
        granularity: "TOTAL",
        assets: [
          successfulAsset("PROFILE", profileId, [
            {
              field: { field_name: "SUBSCRIBERS", report_dimension: "COUNTRY" },
              stats: [
                { value: "850", percentage_value: "98.5", dimension_breakdown: "TR" },
                { value: "0", percentage_value: "0", dimension_breakdown: "UNKNOWN" },
              ],
            },
          ]),
        ],
        paging: { next_page_id: "next-page", next_page_link: "https://example.com/untrusted" },
      }),
    );
    const result = await getSnapchatInsights(ctx, {
      startDate: "2025-11-01",
      endDate: "2026-11-18",
      fields: ["SUBSCRIBERS"],
      breakdownDimensions: ["COUNTRY"],
    });
    expect(url().pathname).toBe(profilePath + "/stats");
    expect(Object.fromEntries(url().searchParams)).toEqual({
      assetType: "PROFILE",
      granularity: "TOTAL",
      startTime: "2026-08-20T00:00:00",
      endTime: "2026-11-18T00:00:00",
      fields: "SUBSCRIBERS",
      breakdownDimensions: "COUNTRY",
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
    });
    expect(result).toMatchObject({
      granularity: "TOTAL",
      startDate: "2026-08-20",
      endDate: "2026-11-18",
      partial: false,
      nextCursor: "next-page",
      rows: [
        {
          assetId: profileId,
          assetType: "PROFILE",
          metric: "SUBSCRIBERS",
          value: 850,
          percentageValue: 98.5,
          dimensionValue: "TR",
          dimension: "COUNTRY",
        },
        { value: 0, percentageValue: 0 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("https://example.com");
  });

  it.each([
    { granularity: "LIFETIME", startDate: "2026-11-17" },
    { granularity: "LIFETIME", fields: ["SUBSCRIBERS_GAINED"] },
    { granularity: "TOTAL", fields: ["LENS_DAU_OVER_WAU"] },
    { granularity: "DAY", startDate: "2026-02-30" },
    { granularity: "DAY", endDate: "2026-08-20" },
    { granularity: "DAY", endDate: "2026-11-19" },
    { granularity: "DAY", startDate: "2026-11-18", endDate: "2026-11-18" },
    { breakdownDimensions: ["PRODUCT"] },
    { fields: ["SUBSCRIBERS", "VIEWS"], breakdownDimensions: ["PLACEMENT"] },
  ] as const)("rejects invalid query %j before I/O", async (query) => {
    const { ctx, fetch } = fixture();
    await expect(
      getSnapchatInsights(ctx, {
        ...query,
        fields: query.fields ? [...query.fields] : undefined,
        breakdownDimensions:
          query.breakdownDimensions ? [...query.breakdownDimensions] : undefined,
      }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { assetType: "STORY", assetId: storyId, path: `stories/${storyId}/stats` },
    { assetType: "SAVED_STORY", assetId: storyId, path: `saved_stories/${storyId}/stats` },
    { assetType: "SPOTLIGHT", assetId: snapId, path: `spotlights/${snapId}/stats` },
    { assetType: "LENS", assetId: undefined, path: "stats" },
  ] as const)("uses the scoped stats path for $assetType", async ({ assetType, assetId, path }) => {
    const { ctx, url } = fixture(
      Response.json({
        request_status: "SUCCESS",
        granularity: "LIFETIME",
        assets: [successfulAsset(assetType, assetId ?? storyId)],
      }),
    );
    await getSnapchatInsights(ctx, { assetType, assetId, limit: 25, cursor: "bounded-page" });
    expect(url().pathname).toBe(`${profilePath}/${path}`);
    expect(Object.fromEntries(url().searchParams)).toEqual({
      assetType,
      granularity: "LIFETIME",
      limit: "25",
      cursor: "bounded-page",
    });
  });

  it("returns partial results when an asset is unavailable and reports permission errors when all are denied", async () => {
    const denied = { sub_request_status: "ERROR", error_code: "AUTHORIZATION_PERMISSION_DENIED" };
    const permitted = successfulAsset("STORY", storyId, [
      { field: { field_name: "VIEWS" }, stats: [{ value: 6 }] },
    ]);
    const { ctx } = fixture(
      Response.json({
        request_status: "PARTIAL",
        granularity: "LIFETIME",
        assets: [denied, permitted],
      }),
      Response.json({ request_status: "PARTIAL", granularity: "LIFETIME", assets: [denied] }),
      Response.json({
        request_status: "PARTIAL",
        granularity: "LIFETIME",
        assets: [denied, successfulAsset("STORY", storyId)],
      }),
    );
    await expect(getSnapchatInsights(ctx, { assetType: "STORY" })).resolves.toMatchObject({
      partial: true,
      rows: [{ metric: "VIEWS", value: 6 }],
    });
    await expect(getSnapchatInsights(ctx, { assetType: "STORY" })).rejects.toMatchObject({
      code: "denied",
    });
    await expect(getSnapchatInsights(ctx, { assetType: "STORY" })).resolves.toMatchObject({
      partial: true,
      rows: [],
    });
  });

  it("requires a paged, profile-scoped membership check before exposing exact Snap stats", async () => {
    const { ctx, url } = fixture(
      Response.json({ request_status: "SUCCESS", snaps: [], paging: { next_page_id: "p2" } }),
      Response.json({
        request_status: "SUCCESS",
        snaps: [{ sub_request_status: "SUCCESS", snap: { id: snapId, story_id: storyId } }],
      }),
      Response.json({
        request_status: "SUCCESS",
        granularity: "LIFETIME",
        assets: [
          successfulAsset("SNAP", snapId, [
            {
              field: { fieldName: "SPOTLIGHT_FAVORITES" },
              stats: [{ dimensionBreakdown: "DEFAULT", value: "3" }],
            },
          ]),
        ],
      }),
    );
    await expect(
      getSnapchatInsights(ctx, {
        assetType: "SNAP",
        assetId: snapId,
        snapParent: {
          type: "STORY",
          id: storyId,
          createdAt: "2026-11-01T00:00:00Z",
          endedAt: "2026-11-02T00:00:00Z",
        },
      }),
    ).resolves.toMatchObject({
      rows: [{ assetId: snapId, metric: "SPOTLIGHT_FAVORITES", value: 3 }],
    });
    expect(url().pathname).toBe(`${profilePath}/stories/${storyId}/snaps`);
    expect(url(1).searchParams.get("cursor")).toBe("p2");
    expect(url(1).searchParams.get("created_at")).toBe("2026-11-01T00:00:00Z");
    expect(url(2).pathname).toBe(`/v1/snaps/${snapId}/stats`);
  });

  it("refuses an unverified Snap and a mismatched profile response", async () => {
    const { ctx, fetch } = fixture(
      Response.json({
        request_status: "SUCCESS",
        snaps: [{ sub_request_status: "SUCCESS", snap: { id: snapId, story_id: profileId } }],
      }),
      Response.json({
        request_status: "SUCCESS",
        granularity: "LIFETIME",
        assets: [successfulAsset("PROFILE", storyId)],
      }),
    );
    await expect(
      getSnapchatInsights(ctx, {
        assetType: "SNAP",
        assetId: snapId,
        snapParent: { type: "SAVED_STORY", id: storyId },
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(getSnapchatInsights(ctx)).rejects.toMatchObject({ code: "denied" });
  });
});

describe("Snapchat earnings", () => {
  it("preserves exact USD thousandths, recording-day watermark, prior earned dates and future lifecycle labels", async () => {
    const { ctx, url } = fixture(
      Response.json({
        request_status: "SUCCESS",
        data_through: "2026-11-17",
        earnings: [
          {
            earned_date: "2026-10-10",
            amount_usd_millis: "125005",
            currency: "USD",
            source: "SPOTLIGHT",
            state: "AVAILABLE",
          },
          {
            earned_date: "2026-11-17",
            amount_usd_millis: "0",
            currency: "USD",
            source: "OTHER",
            state: "ADJUSTED",
          },
        ],
        paging: { next_page_id: "earnings-page-3&limit=1" },
      }),
    );
    const result = await getSnapchatEarnings(ctx, { limit: 10, cursor: "earnings-page-2" });
    expect(url().pathname).toBe(profilePath + "/earnings");
    expect(Object.fromEntries(url().searchParams)).toEqual({
      start_date: "2026-11-12",
      end_date: "2026-11-18",
      limit: "10",
      cursor: "earnings-page-2",
    });
    expect(result).toEqual({
      startDate: "2026-11-12",
      endDate: "2026-11-18",
      dataThrough: "2026-11-17",
      nextCursor: "earnings-page-3&limit=1",
      rows: [
        {
          date: "2026-10-10",
          amountUsdMillis: 125005,
          currency: "USD",
          source: "SPOTLIGHT",
          state: "AVAILABLE",
        },
        {
          date: "2026-11-17",
          amountUsdMillis: 0,
          currency: "USD",
          source: "OTHER",
          state: "ADJUSTED",
        },
      ],
    });
  });

  it("distinguishes a valid empty page from a permission error and redacts error details", async () => {
    const { ctx, fetch } = fixture(
      Response.json({ request_status: "SUCCESS", data_through: "2026-11-18", earnings: [] }),
      Response.json({ debug_message: accessToken }, { status: 403 }),
      Response.json({
        request_status: "ERROR",
        error_code: "INSUFFICIENT_PERMISSIONS",
        debug_message: accessToken,
      }),
      Response.json(
        {
          request_status: "ERROR",
          error_code: "AUTHORIZATION_PERMISSION_DENIED",
          debug_message: accessToken,
        },
        { status: 400 },
      ),
    );
    await expect(getSnapchatEarnings(ctx, { startDate: "2026-08-19" })).resolves.toMatchObject({
      rows: [],
    });
    await expect(getSnapchatEarnings(ctx, { startDate: "2026-08-18" })).rejects.toMatchObject({
      code: "rejected",
    });
    await expect(getSnapchatEarnings(ctx)).rejects.toMatchObject({ code: "denied" });
    await expect(getSnapchatEarnings(ctx)).rejects.toMatchObject({ code: "denied" });
    const error = await getSnapchatEarnings(ctx).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "denied" });
    expect(String(error)).not.toContain(accessToken);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not coerce overflowing USD amounts or a malformed watermark", async () => {
    const { ctx } = fixture(
      Response.json({
        request_status: "SUCCESS",
        data_through: "2026-11-18",
        earnings: [
          {
            earned_date: "2026-11-18",
            amount_usd_millis: "9007199254740992",
            currency: "USD",
            source: "GIFTS",
            state: "PENDING",
          },
        ],
      }),
      Response.json({ request_status: "SUCCESS", data_through: "2026-11-19", earnings: [] }),
    );
    await expect(getSnapchatEarnings(ctx)).rejects.toMatchObject({ code: "unknown" });
    await expect(getSnapchatEarnings(ctx)).rejects.toMatchObject({ code: "unknown" });
  });
});
