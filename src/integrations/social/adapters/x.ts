import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialInbound,
  type SocialSendResult,
  type SocialAccount,
} from "../adapter";
import type { CaptureSource, CollectedPerson, InteractionKind } from "../audience-types";
import { xPostWeight } from "../publishingFormats";
import { uploadXMedia } from "../xMedia";
import { at, id, requireId, text } from "./common";

/** X standard post weight limit (see docs: weighted URLs and emoji count as in publishingFormats). */
export const X_POST_WEIGHT_LIMIT = 280;

/**
 * X-only post extras: quote and native poll. The job payload has no `x` field yet, so the
 * send path reads it defensively. shortcut: remove the cast when SocialJob.payload gains `x`.
 */
export type XPostExtras = {
  quotePostId?: string;
  poll?: { options: string[]; durationMinutes: number };
};

export function xPostExtrasIssue(extras: XPostExtras): string | undefined {
  if (extras.quotePostId !== undefined && !/^\d{1,25}$/.test(extras.quotePostId))
    return "quotePostId must be a numeric post ID.";
  if (extras.poll) {
    const { options, durationMinutes } = extras.poll;
    if (options.length < 2 || options.length > 4) return "An X poll needs two to four options.";
    if (options.some((option) => option.trim().length < 1 || option.length > 25))
      return "Each X poll option must be 1 to 25 characters.";
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 10080)
      return "An X poll lasts 5 minutes to 7 days.";
  }
  return undefined;
}

/**
 * Pause learned from X rate-limit headers or 429 responses, keyed by account and endpoint
 * template. shortcut: in-memory only; a host restart forgets pauses and the next call re-learns them.
 */
const pauses = new Map<string, number>();
const pauseKey = (accountId: string, method: string, url: string) =>
  `${accountId}|${method}|${new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, "/:id")}`;

async function xCall(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  url: string,
  token: string,
  options: RequestInit = {},
) {
  const key = pauseKey(account.id, (options.method ?? "GET").toUpperCase(), url);
  const now = Date.now();
  const until = pauses.get(key);
  if (until !== undefined && until > now) throw new SocialPlatformError("rate_limit", until);
  try {
    const result = await http.request(url, token, options);
    const reset = Number(result.headers.get("x-rate-limit-reset")) * 1000;
    if (
      result.headers.get("x-rate-limit-remaining") === "0" &&
      Number.isFinite(reset) &&
      reset > now
    ) {
      if (pauses.size > 500)
        for (const [item, value] of pauses) if (value <= now) pauses.delete(item);
      pauses.set(key, reset);
    }
    return result;
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "rate_limit" && error.retryAt)
      pauses.set(key, error.retryAt);
    throw error;
  }
}

const xGet = (http: SocialHttp, account: Pick<SocialAccount, "id">, url: string, token: string) =>
  xCall(http, account, url, token);

const xJson = (
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  url: string,
  token: string,
  body: unknown,
) =>
  xCall(http, account, url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Numeric post identifiers only; anything else is rejected before a request is built. */
export function xPostId(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,25}$/.test(value))
    throw new SocialPlatformError("rejected");
  return value;
}

const number = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const USER_FIELDS = "name,username,public_metrics";

/** Maps a collection source to one X endpoint. Keyword and hashtag search depend on the X API product tier. */
export function xAudienceRequest(
  platformId: string,
  source: CaptureSource,
): { url: URL; kind: InteractionKind; users: boolean; cursorParam: string } {
  const me = xPostId(platformId);
  const build = (path: string, params: Record<string, string>) => {
    const url = new URL(`https://api.x.com/2/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };
  if (source.kind === "mentions")
    return {
      url: build(`users/${me}/mentions`, {
        expansions: "author_id",
        "tweet.fields": "created_at,author_id",
        "user.fields": USER_FIELDS,
        max_results: "100",
      }),
      kind: "mention",
      users: false,
      cursorParam: "pagination_token",
    };
  if (source.kind === "followers")
    return {
      url: build(`users/${me}/followers`, { "user.fields": USER_FIELDS, max_results: "100" }),
      kind: "follower",
      users: true,
      cursorParam: "pagination_token",
    };
  if (source.kind === "own_post_likes" || source.kind === "own_post_shares") {
    const post = xPostId(source.postRef);
    return {
      url: build(
        `tweets/${post}/${source.kind === "own_post_likes" ? "liking_users" : "retweeted_by"}`,
        { "user.fields": USER_FIELDS, max_results: "100" },
      ),
      kind: source.kind === "own_post_likes" ? "like" : "share",
      users: true,
      cursorParam: "pagination_token",
    };
  }
  const searchQuery =
    source.kind === "own_post_comments"
      ? `conversation_id:${xPostId(source.postRef)} -is:retweet`
      : source.kind === "account_commenters"
        ? (() => {
            if (!/^[A-Za-z0-9_]{1,15}$/.test(source.handle))
              throw new SocialPlatformError("rejected");
            return `to:${source.handle} -is:retweet`;
          })()
        : source.kind === "hashtag"
          ? `#${source.query.replace(/^#/, "")}`
          : source.kind === "keyword"
            ? source.query
            : "";
  // shortcut: local bound for search text; the X query length limit was not verified.
  if (!searchQuery.trim() || searchQuery.length > 500) throw new SocialPlatformError("rejected");
  const kind: InteractionKind =
    source.kind === "own_post_comments" || source.kind === "account_commenters"
      ? "comment"
      : "search";
  return {
    url: build("tweets/search/recent", {
      query: searchQuery,
      expansions: "author_id",
      "tweet.fields": "created_at,author_id",
      "user.fields": USER_FIELDS,
      max_results: "100",
    }),
    kind,
    users: false,
    cursorParam: "next_token",
  };
}

type XUser = {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  public_metrics?: { followers_count?: unknown };
};
const personFrom = (
  user: XUser,
  kind: InteractionKind,
  ref: string | undefined,
  snippet: string | undefined,
  when: number,
): CollectedPerson => ({
  platformId: requireId(user.id),
  name: String(user.name ?? user.username ?? user.id),
  username: typeof user.username === "string" ? user.username : undefined,
  followers: number(user.public_metrics?.followers_count),
  text: snippet,
  kind,
  ref,
  at: when,
});

export function createXAdapter(http: SocialHttp): SocialAdapter {
  return {
    async send(account, job, token, media, checkpoint, beforeSubmit) {
      if (xPostWeight(text(job)) > X_POST_WEIGHT_LIMIT) throw new SocialPlatformError("rejected");
      const extras = ((job.payload as unknown as { x?: XPostExtras }).x ?? {}) as XPostExtras;
      if (xPostExtrasIssue(extras)) throw new SocialPlatformError("rejected");
      const message =
        job.kind === "message" ||
        (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
      const mediaIds = await uploadXMedia(http, job, token, media, message, checkpoint);
      if (
        job.kind === "message" ||
        (job.kind === "reply" && job.payload.recipientId && !job.payload.postId)
      ) {
        const path = job.payload.threadId
          ? `dm_conversations/${id(job.payload.threadId)}/messages`
          : `dm_conversations/with/${id(job.payload.recipientId)}/messages`;
        await beforeSubmit?.();
        const { value } = await xJson(http, account, `https://api.x.com/2/${path}`, token, {
          text: text(job),
          ...(mediaIds.length ? { attachments: [{ media_id: mediaIds[0] }] } : {}),
        });
        return { platformId: requireId(value.data?.dm_event_id) };
      }
      if (extras.poll && mediaIds.length) throw new SocialPlatformError("rejected");
      await beforeSubmit?.();
      const { value } = await xJson(http, account, "https://api.x.com/2/tweets", token, {
        text: text(job),
        ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
        ...(job.payload.postId ? { reply: { in_reply_to_tweet_id: job.payload.postId } } : {}),
        ...(extras.quotePostId ? { quote_tweet_id: extras.quotePostId } : {}),
        ...(extras.poll
          ? {
              poll: { options: extras.poll.options, duration_minutes: extras.poll.durationMinutes },
            }
          : {}),
      });
      const platformId = requireId(value.data?.id);
      return {
        platformId,
        url: `https://x.com/i/status/${id(platformId)}`,
      } satisfies SocialSendResult;
    },
    async poll(account, token, _posts, cursor) {
      const events: SocialInbound[] = [];
      type Page = { since?: string; next?: string; newest?: string };
      let state: { mentions: Page; dm: Page } = { mentions: {}, dm: {} };
      if (cursor) {
        try {
          const saved = JSON.parse(cursor);
          if (saved.mentions && saved.dm) state = saved;
          else if (/^\d+$/.test(cursor)) state.mentions.since = cursor;
        } catch {
          state.mentions.since = cursor;
        }
      }
      if (account.scopes.includes("tweet.read")) {
        const page = state.mentions;
        const query = new URLSearchParams({
          "post.fields": "created_at,author_id,conversation_id",
          max_results: "100",
        });
        if (page.since) query.set("since_id", page.since);
        if (page.next) query.set("pagination_token", page.next);
        const { value } = await xGet(
          http,
          account,
          `https://api.x.com/2/users/${id(account.platformId)}/mentions?${query}`,
          token,
        );
        for (const post of value.data ?? [])
          events.push({
            eventId: requireId(post.id),
            threadId: requireId(post.id),
            postId: post.id,
            contactId: requireId(post.author_id),
            contactName: post.author_id,
            text: String(post.text ?? ""),
            at: at(post.created_at),
            kind: "comment",
          });
        page.newest ??= value.meta?.newest_id;
        page.next = value.meta?.next_token;
        // Commit the high-water mark only after all older pages are ingested.
        if (!page.next) {
          page.since = page.newest ?? page.since;
          delete page.newest;
        }
      }
      if (account.scopes.includes("dm.read")) {
        const page = state.dm;
        const query = new URLSearchParams({
          "dm_event.fields": "created_at,event_type,text,dm_conversation_id",
          expansions: "sender_id",
          event_types: "MessageCreate",
          max_results: "100",
        });
        if (page.next) query.set("pagination_token", page.next);
        const { value } = await xGet(
          http,
          account,
          `https://api.x.com/2/dm_events?${query}`,
          token,
        );
        page.newest ??= value.data?.[0]?.id;
        const reached = (value.data ?? []).some((dm: { id: string }) => dm.id === page.since);
        for (const dm of value.data ?? [])
          if (dm.sender_id !== account.platformId && dm.event_type === "MessageCreate")
            events.push({
              eventId: requireId(dm.id),
              threadId: requireId(dm.dm_conversation_id),
              contactId: requireId(dm.sender_id),
              contactName: dm.sender_id,
              text: String(dm.text ?? ""),
              at: at(dm.created_at),
              kind: "message",
            });
        page.next = reached ? undefined : value.meta?.next_token;
        if (!page.next) {
          page.since = page.newest ?? page.since;
          delete page.newest;
        }
      }
      return { events, cursor: JSON.stringify(state) };
    },
    async deletePost(account, token, platformId) {
      const { value } = await xCall(
        http,
        account,
        `https://api.x.com/2/tweets/${xPostId(platformId)}`,
        token,
        {
          method: "DELETE",
        },
      );
      if (value.data?.deleted !== true) throw new SocialPlatformError("unknown");
    },
    async getAnalytics(account, token, postIds) {
      const ids = postIds.map(xPostId);
      const result: Record<
        string,
        { views?: number; likes?: number; comments?: number; shares?: number }
      > = {};
      // The posts endpoint accepts up to 100 IDs per request.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const url = new URL("https://api.x.com/2/tweets");
        url.searchParams.set("ids", ids.slice(offset, offset + 100).join(","));
        url.searchParams.set("post.fields", "public_metrics");
        const { value } = await xGet(http, account, url.toString(), token);
        for (const post of value.data ?? []) {
          const metrics = post.public_metrics ?? {};
          const repost = number(metrics.repost_count);
          const quote = number(metrics.quote_count);
          result[requireId(post.id)] = {
            views: number(metrics.impression_count),
            likes: number(metrics.like_count),
            comments: number(metrics.reply_count),
            shares:
              repost === undefined && quote === undefined
                ? undefined
                : (repost ?? 0) + (quote ?? 0),
          };
        }
      }
      return result;
    },
    async getProfile(account, token) {
      const url = new URL("https://api.x.com/2/users/me");
      url.searchParams.set("user.fields", USER_FIELDS);
      const { value } = await xGet(http, account, url.toString(), token);
      const user = value.data as XUser | undefined;
      if (!user) throw new SocialPlatformError("unknown");
      return {
        name: String(user.name ?? user.username ?? ""),
        username: typeof user.username === "string" ? user.username : undefined,
        followers: number(user.public_metrics?.followers_count),
      };
    },
    async collectAudience(account, token, source, cursor) {
      const request = xAudienceRequest(account.platformId, source);
      if (cursor) request.url.searchParams.set(request.cursorParam, cursor);
      const { value } = await xGet(http, account, request.url.toString(), token);
      const people: CollectedPerson[] = [];
      const ref = "postRef" in source ? source.postRef : undefined;
      if (request.users) {
        for (const user of (value.data ?? []) as XUser[])
          if (String(user.id) !== account.platformId)
            people.push(personFrom(user, request.kind, ref, undefined, Date.now()));
      } else {
        const users = new Map<string, XUser>(
          ((value.includes?.users ?? []) as XUser[]).map((user) => [String(user.id), user]),
        );
        for (const post of value.data ?? []) {
          const author = users.get(String(post.author_id));
          if (!author || String(author.id) === account.platformId) continue;
          people.push(
            personFrom(
              author,
              request.kind,
              requireId(post.id),
              String(post.text ?? ""),
              at(post.created_at),
            ),
          );
        }
      }
      return { people, next: value.meta?.next_token };
    },
    async healthCheck(account, token) {
      try {
        const { value } = await xGet(http, account, "https://api.x.com/2/users/me", token);
        return value.data?.id === account.platformId ? { ok: true } : { ok: false, code: "denied" };
      } catch (error) {
        if (error instanceof SocialPlatformError) return { ok: false, code: error.code };
        throw error;
      }
    },
  };
}

/** Likes, reposts and bookmarks. Not in the adapter contract or capability table yet; no caller uses them. */
export async function xLikePost(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  postId: string,
) {
  const { value } = await xJson(
    http,
    account,
    `https://api.x.com/2/users/${xPostId(account.platformId)}/likes`,
    token,
    {
      tweet_id: xPostId(postId),
    },
  );
  if (value.data?.liked !== true) throw new SocialPlatformError("unknown");
}
export async function xRepostPost(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  postId: string,
) {
  const { value } = await xJson(
    http,
    account,
    `https://api.x.com/2/users/${xPostId(account.platformId)}/retweets`,
    token,
    {
      tweet_id: xPostId(postId),
    },
  );
  if (value.data?.retweeted !== true) throw new SocialPlatformError("unknown");
}
export async function xBookmarkPost(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  postId: string,
) {
  const { value } = await xJson(
    http,
    account,
    `https://api.x.com/2/users/${xPostId(account.platformId)}/bookmarks`,
    token,
    {
      tweet_id: xPostId(postId),
    },
  );
  if (value.data?.bookmarked !== true) throw new SocialPlatformError("unknown");
}
