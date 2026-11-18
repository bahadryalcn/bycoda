import { SocialPlatformError, type SocialAccount, type SocialHttp } from "../adapter";
import { xGet, xPostId } from "./x";

const metricFields = [
  "impressions",
  "engagements",
  "likes",
  "replies",
  "retweets",
  "quote_tweets",
  "bookmarks",
  "url_clicks",
  "user_profile_clicks",
] as const;

type Metrics = Partial<Record<(typeof metricFields)[number], number>>;
type InsightBucket = { timestamp: string; metrics: Metrics };
type InsightPost = { id: string; buckets: InsightBucket[] };

type XInsights = {
  profile: {
    followers?: number;
    following?: number;
    posts?: number;
    subscribers?: number;
  };
  posts: InsightPost[];
  daily: InsightBucket[];
  coverage: { requestedPosts: number; morePostsAvailable: boolean; partial: boolean };
};

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Reads the account snapshot and daily engagement across a bounded page of its newer posts. */
export async function xReadInsights(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  range: { startTime: string; endTime: string },
): Promise<XInsights> {
  const start = Date.parse(range.startTime);
  const end = Date.parse(range.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new SocialPlatformError("rejected");
  const startTime = new Date(start).toISOString();
  const endTime = new Date(end).toISOString();
  const userId = xPostId(account.platformId);
  const { value: user } = await xGet(
    http,
    account,
    "https://api.x.com/2/users/me?user.fields=public_metrics,subscriber_count",
    token,
  );
  if (user.data?.id !== userId) throw new SocialPlatformError("denied");
  const publicMetrics = user.data.public_metrics;
  const profile = {
    followers: count(publicMetrics?.followers_count),
    following: count(publicMetrics?.following_count),
    posts: count(publicMetrics?.post_count ?? publicMetrics?.tweet_count),
    subscribers: count(user.data.subscriber_count),
  };

  // The source itself identifies owned posts. The author check guards against cross-account data.
  const timeline = new URL(`https://api.x.com/2/users/${userId}/tweets`);
  timeline.search = new URLSearchParams({
    "post.fields": "id",
    max_results: "100",
    exclude: "retweets",
    end_time: endTime,
  }).toString();
  const { value: page } = await xGet(http, account, timeline.toString(), token);
  const postIds = new Set<string>();
  const timelinePosts = page.data ?? [];
  for (const post of timelinePosts) {
    if (post.author_id !== undefined && post.author_id !== userId) continue;
    if (typeof post.id === "string" && /^\d{1,19}$/.test(post.id)) postIds.add(post.id);
  }
  const coverage = {
    requestedPosts: postIds.size,
    morePostsAvailable: typeof page.meta?.next_token === "string",
    partial: Boolean(page.errors?.length) || postIds.size !== timelinePosts.length,
  };
  if (!postIds.size) return { profile, posts: [], daily: [], coverage };

  const analytics = new URL("https://api.x.com/2/tweets/analytics");
  analytics.search = new URLSearchParams({
    ids: [...postIds].join(","),
    start_time: startTime,
    end_time: endTime,
    granularity: "daily",
    "analytics.fields": ["timestamped_metrics", ...metricFields].join(","),
  }).toString();
  const { value: insights } = await xGet(http, account, analytics.toString(), token);
  const accountBuckets = new Map<string, Metrics>();
  const posts: InsightPost[] = [];
  for (const post of insights.data ?? []) {
    if (!postIds.delete(post.id)) continue;
    const buckets: InsightBucket[] = [];
    for (const entry of post.timestamped_metrics ?? []) {
      const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(at)) continue;
      const timestamp = new Date(at).toISOString();
      const metrics: Metrics = {};
      const aggregate = accountBuckets.get(timestamp) ?? {};
      for (const field of metricFields) {
        const value = count(entry.metrics?.[field]);
        if (value === undefined) continue;
        metrics[field] = value;
        aggregate[field] = (aggregate[field] ?? 0) + value;
      }
      accountBuckets.set(timestamp, aggregate);
      buckets.push({ timestamp, metrics });
    }
    posts.push({ id: post.id, buckets });
  }
  coverage.partial ||= postIds.size > 0 || Boolean(insights.errors?.length);
  const daily = [...accountBuckets]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timestamp, metrics]) => ({ timestamp, metrics }));
  return { profile, posts, daily, coverage };
}
