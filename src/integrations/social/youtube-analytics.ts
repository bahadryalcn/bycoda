import { SocialHttp, SocialPlatformError } from "./adapter";
import { utcDay } from "../../shared/lib/time/timestamps";

export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
export const YOUTUBE_MONETARY_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

const activityMetrics = [
  "views",
  "estimatedMinutesWatched",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
] as const;
const reportDefinitions = {
  overview: { metrics: activityMetrics, dimension: undefined, sort: undefined },
  daily: { metrics: activityMetrics, dimension: "day", sort: "day" },
  traffic: {
    metrics: ["views", "estimatedMinutesWatched"],
    dimension: "insightTrafficSourceType",
    sort: "-views",
  },
  earnings: {
    metrics: ["estimatedRevenue", "estimatedAdRevenue", "monetizedPlaybacks", "cpm"],
    dimension: undefined,
    sort: undefined,
  },
} as const;

export type YouTubeAnalyticsRequest = {
  startDate: string;
  endDate: string;
  kind: keyof typeof reportDefinitions;
  /** ISO 4217. Applies to earnings and defaults to USD. */
  currency?: string;
  startIndex?: number;
};

type ReportCell = string | number | null;
export type YouTubeAnalyticsReport =
  | {
      status: "ok";
      kind: YouTubeAnalyticsRequest["kind"];
      columns: { name: string; type: "dimension" | "metric" }[];
      rows: Record<string, ReportCell>[];
      currency?: string;
      nextStartIndex?: number;
    }
  | {
      status: "needs_scope";
      reasonCode: "youtube_analytics_scope_required" | "youtube_monetary_scope_required";
      requiredScopes: string[];
    };

const pageSize = 200;
const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && utcDay(value) === value;

/** Queries only the selected OAuth-bound channel and normalizes the allowlisted report columns. */
export async function queryYouTubeAnalytics(
  http: SocialHttp,
  token: string,
  account: { channelId: string; scopes: readonly string[] },
  input: YouTubeAnalyticsRequest,
): Promise<YouTubeAnalyticsReport> {
  const { kind, startDate, endDate, startIndex = 1 } = input;
  if (
    !Object.hasOwn(reportDefinitions, kind) ||
    !/^UC[\w-]{22}$/.test(account.channelId) ||
    !isDate(startDate) ||
    !isDate(endDate) ||
    endDate < startDate ||
    !Number.isSafeInteger(startIndex) ||
    startIndex < 1 ||
    startIndex > 1_000_000
  )
    throw new SocialPlatformError("rejected");

  const currency = kind === "earnings" ? (input.currency ?? "USD") : undefined;
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
    throw new SocialPlatformError("rejected");
  const reportScope = kind === "earnings" ? YOUTUBE_MONETARY_SCOPE : YOUTUBE_ANALYTICS_SCOPE;
  const missing = [YOUTUBE_READ_SCOPE, reportScope].filter(
    (scope) =>
      !account.scopes.includes(scope) &&
      !(scope === YOUTUBE_ANALYTICS_SCOPE && account.scopes.includes(YOUTUBE_MONETARY_SCOPE)),
  );
  if (missing.length > 0)
    return {
      status: "needs_scope",
      reasonCode:
        kind === "earnings"
          ? "youtube_monetary_scope_required"
          : "youtube_analytics_scope_required",
      requiredScopes: missing,
    };

  const { dimension, metrics, sort } = reportDefinitions[kind];
  const params = new URLSearchParams({
    ids: `channel==${account.channelId}`,
    startDate,
    endDate,
    metrics: metrics.join(","),
    ...(sort && { sort }),
    ...(dimension && { dimensions: dimension }),
    ...(currency && { currency }),
    maxResults: String(pageSize),
    startIndex: String(startIndex),
  });
  const { value } = await http.request(
    `https://youtubeanalytics.googleapis.com/v2/reports?${params}`,
    token,
  );
  const expected = [...(dimension ? [dimension] : []), ...metrics];
  const headers: unknown[] = Array.isArray(value.columnHeaders) ? value.columnHeaders : [];
  const columnNames = headers.map((header) =>
    header && typeof header === "object" && "name" in header ? header.name : undefined,
  );
  if (
    columnNames.length !== expected.length ||
    expected.some((name) => !columnNames.includes(name))
  )
    throw new SocialPlatformError("unknown");
  const columns = expected.map((name) => ({
    name,
    type: name === dimension ? ("dimension" as const) : ("metric" as const),
  }));
  const providerRows: unknown[] = Array.isArray(value.rows) ? value.rows : [];
  const rows = providerRows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length)
      throw new SocialPlatformError("unknown");
    return Object.fromEntries(
      columns.map(({ name, type }) => {
        const cell: unknown = row[columnNames.indexOf(name)];
        if (type === "dimension" && typeof cell === "string") return [name, cell];
        if (type === "metric" && typeof cell === "number" && Number.isFinite(cell))
          return [name, cell];
        if (cell === null) return [name, null];
        throw new SocialPlatformError("unknown");
      }),
    );
  });
  return {
    status: "ok",
    kind,
    columns,
    rows,
    ...(currency && { currency }),
    ...(rows.length === pageSize && { nextStartIndex: startIndex + pageSize }),
  };
}
