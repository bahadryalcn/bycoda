import { SocialPlatformError, type SocialHttp } from "../adapter";
import { id } from "./common";

export const INSTAGRAM_DEMOGRAPHICS = ["age", "gender", "country", "city"] as const;
export type InstagramInsightInput = {
  mediaId?: string;
  demographics?: (typeof INSTAGRAM_DEMOGRAPHICS)[number];
  /** Account interaction insights range, in Unix seconds. */
  since?: number;
  until?: number;
};
type InstagramInsightMetric = {
  value?: number;
  points?: { value: number; endTime?: string }[];
  breakdown?: { dimensions: string[]; value: number }[];
};
export type InstagramInsightResult = {
  metrics: Record<string, InstagramInsightMetric>;
  unavailable: string[];
};

type MetricGroup = {
  metrics: readonly string[];
  parameters?: Record<string, string>;
};

const ACCOUNT_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "profile_links_taps",
] as const;
const MEDIA_METRICS = [
  "reach",
  "views",
  "comments",
  "likes",
  "shares",
  "saved",
  "total_interactions",
] as const;
const MEDIA_PRODUCT_METRICS: Record<string, readonly string[]> = {
  FEED: ["follows", "profile_activity", "profile_visits"],
  REELS: ["ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"],
  STORY: ["follows", "link_clicks", "navigation", "profile_activity", "profile_visits", "replies"],
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    return row ? [row] : [];
  });
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseMetrics(
  data: unknown,
  requested: readonly string[],
  result: InstagramInsightResult,
): void {
  for (const row of objects(data)) {
    if (typeof row.name !== "string" || !requested.includes(row.name)) continue;
    const total = record(row.total_value);
    const points = objects(row.values).flatMap((point) => {
      const value = finite(point.value);
      return value === undefined
        ? []
        : [{ value, endTime: typeof point.end_time === "string" ? point.end_time : undefined }];
    });
    const breakdown = objects(total?.breakdowns).flatMap((group) =>
      objects(group.results).flatMap((entry) => {
        const value = finite(entry.value);
        const dimensions = entry.dimension_values;
        return value !== undefined &&
          Array.isArray(dimensions) &&
          dimensions.length > 0 &&
          dimensions.every((dimension) => typeof dimension === "string")
          ? [{ dimensions, value }]
          : [];
      }),
    );
    const value = finite(total?.value) ?? (points.length === 1 ? points[0]?.value : undefined);
    if (value !== undefined || points.length || breakdown.length) {
      result.metrics[row.name] = {
        ...(value !== undefined ? { value } : {}),
        ...(points.length ? { points } : {}),
        ...(breakdown.length ? { breakdown } : {}),
      };
    }
  }
}

async function readMetricGroup(
  http: SocialHttp,
  endpoint: string,
  token: string,
  group: MetricGroup,
  result: InstagramInsightResult,
): Promise<void> {
  const { metrics, parameters } = group;
  const query = new URLSearchParams({ ...parameters, metric: metrics.join(",") });
  try {
    const { value } = await http.request(`${endpoint}?${query}`, token);
    parseMetrics(value.data, metrics, result);
  } catch (error) {
    if (!(error instanceof SocialPlatformError) || error.code !== "rejected") throw error;
    // An unsupported metric can reject a combined read. Isolate definitive rejections.
    if (metrics.length > 1) {
      for (const metric of metrics)
        await readMetricGroup(http, endpoint, token, { metrics: [metric], parameters }, result);
    }
  }
  for (const metric of metrics) {
    if (result.metrics[metric] === undefined && !result.unavailable.includes(metric))
      result.unavailable.push(metric);
  }
}

/** Account and owned-media insights for an Instagram Login connection. */
export async function readInstagramInsights(
  http: SocialHttp,
  graphVersion: string,
  token: string,
  accountPlatformId: string,
  input: InstagramInsightInput = {},
): Promise<InstagramInsightResult> {
  const { mediaId, demographics, since, until } = input;
  if (demographics !== undefined && (mediaId !== undefined || !INSTAGRAM_DEMOGRAPHICS.includes(demographics)))
    throw new SocialPlatformError("rejected");
  const hasRange = since !== undefined || until !== undefined;
  if (
    hasRange &&
    (mediaId !== undefined ||
      demographics !== undefined ||
      since === undefined ||
      until === undefined ||
      !Number.isSafeInteger(since) ||
      !Number.isSafeInteger(until) ||
      since <= 0 ||
      until <= since ||
      until - since > 90 * 24 * 60 * 60)
  )
    throw new SocialPlatformError("rejected");
  const resource = `https://graph.instagram.com/${graphVersion}/${id(mediaId ?? accountPlatformId)}`;
  const result: InstagramInsightResult = { metrics: {}, unavailable: [] };
  let groups: MetricGroup[];
  if (mediaId !== undefined) {
    const { value } = await http.request(`${resource}?fields=media_product_type`, token);
    const product = typeof value.media_product_type === "string" ? value.media_product_type : "";
    const common = product === "STORY"
      ? MEDIA_METRICS.filter((metric) => metric !== "comments" && metric !== "likes" && metric !== "saved")
      : MEDIA_METRICS;
    const productMetrics = Object.prototype.hasOwnProperty.call(MEDIA_PRODUCT_METRICS, product)
      ? (MEDIA_PRODUCT_METRICS[product] ?? [])
      : [];
    groups = [{ metrics: [...common, ...productMetrics] }];
  } else if (demographics !== undefined) {
    groups = [{
      metrics: ["follower_demographics", "engaged_audience_demographics", "reached_audience_demographics"],
      parameters: { period: "lifetime", metric_type: "total_value", timeframe: "this_month", breakdown: demographics },
    }];
  } else {
    const range: Record<string, string> = hasRange
      ? { since: String(since), until: String(until) }
      : {};
    groups = [
      { metrics: ACCOUNT_METRICS, parameters: { ...range, period: "day", metric_type: "total_value" } },
      {
        metrics: ["follows_and_unfollows"],
        parameters: { ...range, period: "day", metric_type: "total_value", breakdown: "follow_type" },
      },
      { metrics: ["follower_count"], parameters: { ...range, period: "day", metric_type: "time_series" } },
    ];
  }
  for (const group of groups)
    await readMetricGroup(http, `${resource}/insights`, token, group, result);
  return result;
}

/** Existing summary consumers only need four values and use the same partial-read behavior. */
export async function readInstagramMediaSummary(
  http: SocialHttp,
  graphVersion: string,
  token: string,
  mediaId: string,
): Promise<{ views?: number; likes?: number; comments?: number; shares?: number }> {
  const result: InstagramInsightResult = { metrics: {}, unavailable: [] };
  await readMetricGroup(
    http,
    `https://graph.instagram.com/${graphVersion}/${id(mediaId)}/insights`,
    token,
    { metrics: ["views", "likes", "comments", "shares"] },
    result,
  );
  const { metrics } = result;
  return {
    views: metrics.views?.value,
    likes: metrics.likes?.value,
    comments: metrics.comments?.value,
    shares: metrics.shares?.value,
  };
}
