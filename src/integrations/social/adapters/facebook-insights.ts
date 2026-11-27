import type { SocialHttp } from "../adapter";
import { graphNext, id } from "./common";

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function readFacebookPostInsights(
  request: (path: string) => ReturnType<SocialHttp["request"]>,
  postId: string,
) {
  const post = id(postId);
  const { value: engagement } = await request(
    `${post}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares`,
  );
  const { value: insights } = await request(`${post}/insights?metric=post_media_view`);
  const views = Array.isArray(insights.data)
    ? insights.data.find((row) => row?.name === "post_media_view")
    : undefined;
  return {
    views: count(views?.values?.[0]?.value ?? views?.total_value?.value),
    likes: count(engagement.likes?.summary?.total_count),
    comments: count(engagement.comments?.summary?.total_count),
    shares: count(engagement.shares?.count),
  };
}

const PAGE_METRICS = ["page_media_view", "page_total_media_view_unique"];
const EARNINGS_METRIC = "monetization_approximate_earnings";

export async function readFacebookPageInsights(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
  options: { earnings?: boolean; cursor?: string } = {},
) {
  const metrics = options.earnings ? [EARNINGS_METRIC] : PAGE_METRICS;
  const query = new URLSearchParams({ metric: metrics.join(","), period: "day" });
  if (options.earnings) query.set("breakdown", "monetization_tool");
  if (options.cursor) query.set("after", options.cursor);
  const { value } = await http.request(
    `https://graph.facebook.com/${graphVersion}/${id(pageId)}/insights?${query}`,
    token,
  );
  return {
    metrics: metrics.map((name) => {
      const row = Array.isArray(value.data)
        ? value.data.find((candidate) => candidate?.name === name)
        : undefined;
      const values = Array.isArray(row?.values)
        ? row.values.flatMap((entry: { value?: unknown; end_time?: unknown }) => {
            const number = count(entry?.value);
            const breakdown =
              options.earnings && entry?.value && typeof entry.value === "object"
                ? Object.fromEntries(
                    Object.entries(entry.value).filter(
                      ([key, amount]) =>
                        /^[A-Za-z0-9_]{1,80}$/.test(key) && count(amount) !== undefined,
                    ),
                  )
                : undefined;
            return number !== undefined || (breakdown && Object.keys(breakdown).length)
              ? [
                  {
                    value: number ?? breakdown,
                    endsAt: typeof entry.end_time === "string" ? entry.end_time : undefined,
                  },
                ]
              : [];
          })
        : [];
      return { name, values, available: values.length > 0 };
    }),
    next: graphNext(value),
  };
}
