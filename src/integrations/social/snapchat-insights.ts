import { z } from "zod";
import { utcDay } from "../../shared/lib/time/timestamps";
import { isSnapchatPermissionError, SocialHttp, SocialPlatformError } from "./adapter";
import { snapchatApiOrigin, snapchatSnapId, snapchatUuid } from "./snapchat-content";

const dayMs = 86_400_000;
const label = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const cursorSchema = z.string().min(1).max(4096);
const assets = z.enum(["PROFILE", "LENS", "STORY", "SAVED_STORY", "SPOTLIGHT", "SNAP"]);
const granularities = z.enum(["DAY", "TOTAL", "LIFETIME"]);
const collections = { STORY: "stories", SAVED_STORY: "saved_stories", SPOTLIGHT: "spotlights" };
const lifetimeUnsupported = new Set([
  "SUBSCRIBERS_GAINED",
  "STORY_SUBSCRIBERS_GAINED",
  "LENS_SUBSCRIBERS_GAINED",
  "SPOTLIGHT_SUBSCRIBERS_GAINED",
]);
const dayOnly = new Set(["LENS_DAU_OVER_WAU", "LENS_DAU_OVER_MAU"]);

type SnapchatInsightsContext = {
  profileId: string;
  accessToken: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export type SnapchatInsightAsset = z.infer<typeof assets>;
export type SnapchatInsightGranularity = z.infer<typeof granularities>;
export type SnapchatInsightsQuery = {
  assetType?: SnapchatInsightAsset;
  assetId?: string;
  snapParent?: { type: "STORY" | "SAVED_STORY"; id: string; createdAt?: string; endedAt?: string };
  granularity?: SnapchatInsightGranularity;
  /** UTC date, YYYY-MM-DD. */
  startDate?: string;
  /** Exclusive UTC date, YYYY-MM-DD. */
  endDate?: string;
  fields?: string[];
  breakdownDimensions?: string[];
  limit?: number;
  cursor?: string;
};

export type SnapchatInsightRow = {
  assetId: string;
  assetType: SnapchatInsightAsset;
  metric: string;
  value: number;
  startTime?: string;
  endTime?: string;
  dimension?: string;
  dimensionValue?: string;
  percentageValue?: number;
};

export type SnapchatInsightsResult = {
  granularity: SnapchatInsightGranularity;
  startDate?: string;
  endDate?: string;
  rows: SnapchatInsightRow[];
  partial: boolean;
  nextCursor?: string;
};

export type SnapchatEarningsQuery = {
  /** UTC recording days, inclusive. */
  startDate?: string;
  endDate?: string;
  limit?: number;
  cursor?: string;
};

export type SnapchatEarningsResult = {
  startDate: string;
  endDate: string;
  dataThrough: string;
  rows: Array<{
    date: string;
    amountUsdMillis: number;
    currency: "USD";
    source: string;
    state: string;
  }>;
  nextCursor?: string;
};

function dateMillis(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const value = Date.parse(date + "T00:00:00Z");
  return utcDay(value) === date ? value : NaN;
}

function utcToday(now = Date.now): number {
  return Math.floor(now() / dayMs) * dayMs;
}

const utcDate = z.string().refine((value) => Number.isFinite(dateMillis(value)));
const utcTime = z.string().datetime({ local: true });
const optionalCursor = z.object({ next_page_id: cursorSchema.optional() }).optional();
const numberValue = z
  .union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/)])
  .transform(Number)
  .refine((value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER);
const dimensionValue = z.string().regex(/^[A-Za-z0-9_ .-]{1,100}$/);

const stat = z.object({
  value: numberValue,
  percentage_value: numberValue.optional(),
  dimension_breakdown: dimensionValue.optional(),
  dimensionBreakdown: dimensionValue.optional(),
});
const metric = z.object({
  field: z.object({
    field_name: label.optional(),
    fieldName: label.optional(),
    report_dimension: label.optional(),
    reportDimension: label.optional(),
  }),
  stats: z.array(stat),
});
const timeseries = z.object({
  start_time: utcTime.optional(),
  end_time: utcTime.optional(),
  fields: z.array(metric),
});
const successfulAsset = z.object({
  asset_type: assets,
  asset_id: z.string().regex(snapchatSnapId),
  timeseries: z.array(timeseries),
});
const insightsEnvelope = z.object({
  granularity: granularities,
  assets: z.array(
    z
      .object({
        sub_request_status: z.enum(["SUCCESS", "ERROR"]),
        error_code: z.string().optional(),
      })
      .passthrough(),
  ),
  paging: optionalCursor,
  page: optionalCursor,
});
const earningsEnvelope = z.object({
  data_through: utcDate,
  earnings: z.array(
    z.object({
      earned_date: utcDate,
      amount_usd_millis: numberValue.refine(Number.isSafeInteger),
      currency: z.literal("USD"),
      state: label,
      source: label,
    }),
  ),
  paging: optionalCursor,
});
const snapPage = z.object({
  snaps: z.array(
    z.object({
      sub_request_status: z.string(),
      snap: z.object({ id: z.string(), story_id: z.string() }).optional(),
    }),
  ),
  paging: optionalCursor,
});

function readResponse<T>(schema: z.ZodType<T>, response: unknown): T {
  const result = schema.safeParse(response);
  if (!result.success) throw new SocialPlatformError("unknown");
  return result.data;
}

function success(response: Record<string, unknown>, allowPartial = false): void {
  if (
    response?.request_status === "SUCCESS" ||
    (allowPartial && response?.request_status === "PARTIAL")
  )
    return;
  throw new SocialPlatformError(response?.request_status === "ERROR" ? "rejected" : "unknown");
}

function reader(ctx: SnapchatInsightsContext) {
  if (!snapchatUuid.test(ctx.profileId) || !ctx.accessToken)
    throw new SocialPlatformError("denied");
  const path = `/v1/public_profiles/${ctx.profileId}`;
  const http = new SocialHttp(ctx.fetch, ctx.now);
  return {
    path,
    async get(resource: string, params: URLSearchParams, partial = false) {
      const url = new URL(resource, snapchatApiOrigin);
      url.search = params.toString();
      const { value } = await http.request(url.href, ctx.accessToken);
      success(value, partial);
      return value;
    },
  };
}

function setPage(params: URLSearchParams, min: number, limit?: number, cursor?: string): void {
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < min) throw new SocialPlatformError("rejected");
    params.set("limit", String(Math.min(limit, 1000)));
  }
  if (cursor !== undefined) {
    if (!cursorSchema.safeParse(cursor).success) throw new SocialPlatformError("rejected");
    if (!params.has("limit")) params.set("limit", "100");
    params.set("cursor", cursor);
  }
}

function insightsRange(
  query: SnapchatInsightsQuery,
  granularity: SnapchatInsightGranularity,
  today: number,
) {
  if (granularity === "LIFETIME") {
    if (query.startDate !== undefined || query.endDate !== undefined)
      throw new SocialPlatformError("rejected");
    return {};
  }
  const end = query.endDate === undefined ? today : dateMillis(query.endDate);
  const start = query.startDate === undefined ? end - 7 * dayMs : dateMillis(query.startDate);
  const lowerBound = today - 90 * dayMs;
  const clamped = Math.max(start, lowerBound);
  if (!(clamped < end && end <= today)) throw new SocialPlatformError("rejected");
  return { startDate: utcDay(clamped), endDate: utcDay(end) };
}

function insightParams(
  query: SnapchatInsightsQuery,
  assetType: SnapchatInsightAsset,
  granularity: SnapchatInsightGranularity,
  range: { startDate?: string; endDate?: string },
) {
  const params = new URLSearchParams({ assetType, granularity });
  if (range.startDate && range.endDate) {
    const midnight = assetType === "SAVED_STORY" && query.assetId ? "T00:00:00Z" : "T00:00:00";
    params.set("startTime", range.startDate + midnight);
    params.set("endTime", range.endDate + midnight);
  }
  if (query.fields !== undefined) {
    const fields = z.array(label).min(1).max(100).safeParse(query.fields);
    if (
      !fields.success ||
      fields.data.some(
        (field) =>
          (granularity !== "DAY" && dayOnly.has(field)) ||
          (granularity === "LIFETIME" && lifetimeUnsupported.has(field)),
      )
    )
      throw new SocialPlatformError("rejected");
    params.set("fields", fields.data.join(","));
  }
  if (query.breakdownDimensions !== undefined) {
    const dimensions = z.array(label).min(1).max(10).safeParse(query.breakdownDimensions);
    if (
      !dimensions.success ||
      assetType === "SNAP" ||
      (assetType !== "LENS" && dimensions.data.includes("PRODUCT")) ||
      (dimensions.data.includes("PLACEMENT") &&
        (query.fields?.length !== 1 || query.fields[0] !== "SUBSCRIBERS"))
    )
      throw new SocialPlatformError("rejected");
    params.set("breakdownDimensions", dimensions.data.join(","));
  }
  if (assetType !== "SNAP") setPage(params, 10, query.limit, query.cursor);
  return params;
}

async function verifySnapParent(
  client: ReturnType<typeof reader>,
  id: string,
  parent: SnapchatInsightsQuery["snapParent"],
): Promise<void> {
  if (
    !parent ||
    (parent.type !== "STORY" && parent.type !== "SAVED_STORY") ||
    !snapchatUuid.test(parent.id)
  )
    throw new SocialPlatformError("denied");
  const route = `${client.path}/${collections[parent.type]}/${parent.id}/snaps`;
  const params = new URLSearchParams({ limit: "100" });
  if (parent.type === "STORY") {
    for (const [key, time] of [
      ["created_at", parent.createdAt],
      ["ended_at", parent.endedAt],
    ] as const) {
      if (time === undefined) continue;
      if (!utcTime.safeParse(time).success) throw new SocialPlatformError("rejected");
      params.set(key, time);
    }
  }
  // A Snap route has no owning profile in its path. Prove membership with a profile-scoped read
  // before using it, even if the OAuth token can read Snaps from multiple profiles.
  const visited = new Set<string>();
  for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
    const page = readResponse(snapPage, await client.get(route, params, true));
    if (
      page.snaps.some(
        (entry) =>
          entry.sub_request_status === "SUCCESS" &&
          entry.snap?.id === id &&
          entry.snap.story_id.toLowerCase() === parent.id.toLowerCase(),
      )
    )
      return;
    const next = page.paging?.next_page_id;
    if (!next || visited.has(next)) break;
    visited.add(next);
    params.set("cursor", next);
  }
  throw new SocialPlatformError("denied");
}

function rowsForAsset(asset: z.infer<typeof successfulAsset>): SnapchatInsightRow[] {
  const rows: SnapchatInsightRow[] = [];
  for (const bucket of asset.timeseries) {
    for (const { field, stats } of bucket.fields) {
      const metricName = field.field_name ?? field.fieldName;
      if (!metricName) throw new SocialPlatformError("unknown");
      const dimension = field.report_dimension ?? field.reportDimension;
      for (const point of stats) {
        const dimensionValue = point.dimension_breakdown ?? point.dimensionBreakdown;
        rows.push({
          assetId: asset.asset_id,
          assetType: asset.asset_type,
          metric: metricName,
          value: point.value,
          startTime: bucket.start_time,
          endTime: bucket.end_time,
          dimension: dimension === "DEFAULT" ? undefined : dimension,
          dimensionValue: dimensionValue === "DEFAULT" ? undefined : dimensionValue,
          percentageValue: point.percentage_value,
        });
      }
    }
  }
  return rows;
}

/** Read one bounded page of aggregate metrics. Never expose provider URLs or error messages. */
export async function getSnapchatInsights(
  ctx: SnapchatInsightsContext,
  query: SnapchatInsightsQuery = {},
): Promise<SnapchatInsightsResult> {
  const assetType = query.assetType ?? "PROFILE";
  const granularity =
    query.granularity ?? (query.startDate || query.endDate ? "TOTAL" : "LIFETIME");
  const id = query.assetId;
  if (
    !assets.safeParse(assetType).success ||
    !granularities.safeParse(granularity).success ||
    (id !== undefined && typeof id !== "string")
  )
    throw new SocialPlatformError("rejected");
  const range = insightsRange(query, granularity, utcToday(ctx.now));
  const params = insightParams(query, assetType, granularity, range);
  const client = reader(ctx);
  let path = `${client.path}/stats`;
  if (assetType === "SNAP") {
    if (!id || !snapchatSnapId.test(id) || query.cursor !== undefined || query.limit !== undefined)
      throw new SocialPlatformError("rejected");
    await verifySnapParent(client, id, query.snapParent);
    path = `/v1/snaps/${id}/stats`;
  } else if (id !== undefined) {
    if (assetType === "PROFILE") {
      if (id.toLowerCase() !== ctx.profileId.toLowerCase()) throw new SocialPlatformError("denied");
    } else {
      if (assetType === "LENS") throw new SocialPlatformError("unsupported");
      if (!(assetType === "SPOTLIGHT" ? snapchatSnapId : snapchatUuid).test(id))
        throw new SocialPlatformError("rejected");
      path = `${client.path}/${collections[assetType]}/${id}/stats`;
    }
  }

  const response = await client.get(path, params, true);
  const page = readResponse(insightsEnvelope, response);
  if (page.granularity !== granularity) throw new SocialPlatformError("unknown");
  const rows: SnapchatInsightRow[] = [];
  let allDenied = page.assets.length > 0;
  let partial = response.request_status === "PARTIAL";
  for (const entry of page.assets) {
    if (entry.sub_request_status === "ERROR") {
      partial = true;
      allDenied &&= isSnapchatPermissionError(entry.error_code);
      continue;
    }
    const asset = readResponse(successfulAsset, entry);
    allDenied = false;
    if (asset.asset_type !== assetType) throw new SocialPlatformError("unknown");
    const expectedId = assetType === "PROFILE" ? ctx.profileId : id;
    if (expectedId !== undefined) {
      const matches =
        assetType === "SNAP" || assetType === "SPOTLIGHT"
          ? asset.asset_id === expectedId
          : asset.asset_id.toLowerCase() === expectedId.toLowerCase();
      if (!matches) throw new SocialPlatformError("denied");
    }
    rows.push(...rowsForAsset(asset));
  }
  if (allDenied) throw new SocialPlatformError("denied");
  return {
    granularity,
    ...range,
    rows,
    partial,
    nextCursor: page.paging?.next_page_id ?? page.page?.next_page_id,
  };
}

/** Read creator earnings by UTC recording date. Retain exact USD thousandths and data watermark. */
export async function getSnapchatEarnings(
  ctx: SnapchatInsightsContext,
  query: SnapchatEarningsQuery = {},
): Promise<SnapchatEarningsResult> {
  const today = utcToday(ctx.now);
  const end = query.endDate === undefined ? today : dateMillis(query.endDate);
  const start = query.startDate === undefined ? end - 6 * dayMs : dateMillis(query.startDate);
  if (!(start <= end && end <= today && end - start < 92 * dayMs))
    throw new SocialPlatformError("rejected");
  const startDate = utcDay(start);
  const endDate = utcDay(end);
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  setPage(params, 1, query.limit, query.cursor);
  const client = reader(ctx);
  const page = readResponse(earningsEnvelope, await client.get(`${client.path}/earnings`, params));
  if (page.data_through < startDate || page.data_through > endDate)
    throw new SocialPlatformError("unknown");
  return {
    startDate,
    endDate,
    dataThrough: page.data_through,
    rows: page.earnings.map((row) => ({
      date: row.earned_date,
      amountUsdMillis: row.amount_usd_millis,
      currency: row.currency,
      source: row.source,
      state: row.state,
    })),
    nextCursor: page.paging?.next_page_id,
  };
}
