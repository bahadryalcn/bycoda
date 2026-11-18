import { retryAfter, SocialHttp, SocialPlatformError } from "../adapter";

export const TIKTOK_PROFILE_SCOPE = "user.info.profile";
export const TIKTOK_STATS_SCOPE = "user.info.stats";

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const ACCOUNT_HANDLE = /^[a-z0-9_.]{2,24}$/i;
const ITEM_ID = /^\d{1,30}$/;

function handle(value: unknown) {
  return typeof value === "string" && ACCOUNT_HANDLE.test(value) ? value.toLowerCase() : undefined;
}

function unixTime(value: unknown) {
  const seconds = typeof value === "string" && /^\d{1,13}$/.test(value) ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0)
    return undefined;
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds <= 8.64e15 ? milliseconds : undefined;
}

export async function readTikTokDisplay(
  http: SocialHttp,
  token: string,
  openId: string,
  scopes: readonly string[],
) {
  const profile = scopes.includes(TIKTOK_PROFILE_SCOPE);
  const stats = scopes.includes(TIKTOK_STATS_SCOPE);
  const fields = [
    "open_id",
    "display_name",
    "avatar_url",
    ...(profile ? ["username", "bio_description", "profile_deep_link"] : []),
    ...(stats ? ["follower_count", "following_count", "likes_count", "video_count"] : []),
  ];
  const { value } = await http.request(
    `https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(",")}`,
    token,
  );
  const user = object(value.data?.user);
  if (!user || !openId || user.open_id !== openId || typeof user.display_name !== "string")
    throw new SocialPlatformError("denied");
  return {
    name: user.display_name.slice(0, 200),
    username: profile ? handle(user.username) : undefined,
    bio: profile ? optionalText(user.bio_description, 300) : undefined,
    profileUrl: profile ? httpsUrl(user.profile_deep_link) : undefined,
    avatarUrl: httpsUrl(user.avatar_url),
    followers: stats ? count(user.follower_count) : undefined,
    following: stats ? count(user.following_count) : undefined,
    likes: stats ? count(user.likes_count) : undefined,
    posts: stats ? count(user.video_count) : undefined,
  };
}

function optionalText(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export type TikTokBusinessCredential = { businessId: string; accessToken: string };
export type TikTokOrganicComment = {
  id: string;
  postId: string;
  text: string;
  author?: string;
  username?: string;
  at?: number;
  hidden: boolean;
  owned: boolean;
};
export type TikTokOrganicCommentChange = {
  postId: string;
  commentId: string;
  action: "reply" | "like" | "hide" | "delete";
  text?: string;
};
type Mutation = {
  body: Record<string, string>;
  beforeSubmit: () => Promise<void>;
};

/** The Business Accounts API uses a distinct creator token and identity from Login Kit. */
export class TikTokOrganic {
  constructor(
    private readonly approved: boolean,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}

  private async request(
    path: string,
    credential: TikTokBusinessCredential,
    query: Record<string, string>,
    mutation?: Mutation,
  ) {
    if (!this.approved) throw new SocialPlatformError("unsupported");
    if (
      !/^[\w-]{1,300}$/.test(credential.businessId) ||
      !/^[!-~]{1,4096}$/.test(credential.accessToken)
    )
      throw new SocialPlatformError("denied");
    const url = new URL(path, "https://business-api.tiktok.com/open_api/v1.3/business/");
    const headers: Record<string, string> = { "Access-Token": credential.accessToken };
    let body: string | undefined;
    if (mutation) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ ...mutation.body, business_id: credential.businessId });
      await mutation.beforeSubmit();
    } else {
      url.search = new URLSearchParams({ ...query, business_id: credential.businessId }).toString();
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: mutation ? "POST" : "GET",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const envelope = object(await response.json().catch(() => undefined));
    if (response.status === 401 || envelope?.code === 40105)
      throw new SocialPlatformError("expired");
    if (response.status === 429 || envelope?.code === 40100)
      throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    if (response.status === 403 || envelope?.code === 40001)
      throw new SocialPlatformError("denied");
    if (response.status === 400 || envelope?.code === 40002 || envelope?.code === 40007)
      throw new SocialPlatformError("rejected");
    if (!response.ok || envelope?.code !== 0) throw new SocialPlatformError("unknown");
    return object(envelope.data);
  }

  /** Username is the binding proof against the previously verified bycoda account. */
  async profile(credential: TikTokBusinessCredential, { stats = false } = {}) {
    const fields = ["display_name", "username", ...(stats ? ["followers_count", "likes"] : [])];
    const data = await this.request("get/", credential, { fields: JSON.stringify(fields) });
    const username = handle(data?.username);
    if (!data || !username || typeof data.display_name !== "string")
      throw new SocialPlatformError("denied");
    return {
      name: data.display_name.slice(0, 200),
      username,
      followers: stats ? count(data.followers_count) : undefined,
      likes: stats ? count(data.likes) : undefined,
    };
  }

  async videos(credential: TikTokBusinessCredential, cursor?: number) {
    const data = await this.request("video/list/", credential, {
      fields: JSON.stringify([
        "item_id",
        "caption",
        "create_time",
        "likes",
        "comments",
        "shares",
        "video_views",
        "reach",
      ]),
      max_count: "20",
      ...(cursor === undefined ? {} : { cursor: cursorParam(cursor) }),
    });
    if (
      !Array.isArray(data?.videos) ||
      data.videos.length > 20 ||
      typeof data.has_more !== "boolean"
    )
      throw new SocialPlatformError("unknown");
    const next = nextCursor(data);
    if (next !== undefined && next === cursor) throw new SocialPlatformError("unknown");
    const rows = data.videos.map((item: unknown) => {
      const row = object(item);
      const id = row?.item_id;
      const at = unixTime(row?.create_time);
      if (!row || typeof id !== "string" || !ITEM_ID.test(id) || at === undefined)
        throw new SocialPlatformError("unknown");
      return {
        post: { id, at, text: optionalText(row.caption, 4000) },
        metrics: {
          views: count(row.video_views),
          likes: count(row.likes),
          comments: count(row.comments),
          shares: count(row.shares),
          reach: count(row.reach),
        },
      };
    });
    return {
      posts: rows.map(({ post }) => post),
      metrics: Object.fromEntries(rows.map(({ post, metrics }) => [post.id, metrics])),
      next,
    };
  }

  async comments(credential: TikTokBusinessCredential, postId: string, cursor = 0) {
    if (!ITEM_ID.test(postId)) throw new SocialPlatformError("rejected");
    const page = await this.request("comment/list/", credential, {
      video_id: postId,
      cursor: cursorParam(cursor),
      max_count: "20",
      sort_field: "create_time",
      sort_order: "desc",
    });
    return commentPage(page, postId);
  }

  async comment(credential: TikTokBusinessCredential, postId: string, commentId: string) {
    if (!ITEM_ID.test(postId) || !ITEM_ID.test(commentId))
      throw new SocialPlatformError("rejected");
    const page = await this.request("comment/list/", credential, {
      video_id: postId,
      comment_ids: JSON.stringify([commentId]),
      max_count: "1",
    });
    const { comments, next } = commentPage(page, postId);
    if (next !== undefined || comments.length !== 1 || comments[0].id !== commentId)
      throw new SocialPlatformError("denied");
    return comments[0];
  }

  async mentions(credential: TikTokBusinessCredential, cursor = 0) {
    return commentPage(
      await this.request("mention/comment/list/", credential, {
        cursor: cursorParam(cursor),
        fields: JSON.stringify([
          "item_id",
          "commenter_display_name",
          "comment_id",
          "comment_text",
          "comment_create_time",
        ]),
      }),
    );
  }

  /** Resolve the owned comment before the Host rechecks identity, policy and suppression. */
  async mutateComment(
    credential: TikTokBusinessCredential,
    change: TikTokOrganicCommentChange,
    beforeSubmit: (target: TikTokOrganicComment) => Promise<void>,
  ): Promise<{ platformId: string }> {
    const { postId, commentId, action } = change;
    const body: Record<string, string> = { comment_id: commentId };
    let route: string;
    switch (action) {
      case "reply":
        if (typeof change.text !== "string" || !change.text.trim() || change.text.length > 500)
          throw new SocialPlatformError("rejected");
        route = "comment/reply/create/";
        body.video_id = postId;
        body.text = change.text;
        break;
      case "like":
        route = "comment/like/";
        body.action = "LIKE";
        break;
      case "hide":
        route = "comment/hide/";
        body.video_id = postId;
        body.action = "HIDE";
        break;
      case "delete":
        route = "comment/delete/";
        break;
      default:
        throw new SocialPlatformError("unsupported");
    }
    const target = await this.comment(credential, postId, commentId);
    const data = await this.request(
      route,
      credential,
      {},
      {
        body,
        beforeSubmit: () => beforeSubmit(target),
      },
    );
    if (action !== "reply") return { platformId: commentId };
    const reply = data?.comment_id;
    if (typeof reply !== "string" || !ITEM_ID.test(reply) || reply === commentId)
      throw new SocialPlatformError("unknown");
    return { platformId: reply };
  }
}

function cursorParam(cursor: number) {
  if (count(cursor) === undefined) throw new SocialPlatformError("rejected");
  return String(cursor);
}

function nextCursor(data: Record<string, unknown>) {
  const next = data.has_more ? count(data.cursor) : undefined;
  if (data.has_more && next === undefined) throw new SocialPlatformError("unknown");
  return next;
}

function commentPage(data: Record<string, unknown> | undefined, postId?: string) {
  if (
    !Array.isArray(data?.comments) ||
    data.comments.length > 100 ||
    typeof data.has_more !== "boolean"
  )
    throw new SocialPlatformError("unknown");
  const next = nextCursor(data);
  const comments = data.comments.map((item: unknown): TikTokOrganicComment => {
    const row = object(item);
    const id = row?.comment_id;
    const video = postId ? row?.video_id : row?.item_id;
    if (
      !row ||
      typeof id !== "string" ||
      !ITEM_ID.test(id) ||
      typeof video !== "string" ||
      !ITEM_ID.test(video) ||
      (postId && video !== postId)
    )
      throw new SocialPlatformError("unknown");
    return {
      id,
      postId: video,
      text: optionalText(postId ? row.text : row.comment_text, 4000) ?? "",
      author: optionalText(postId ? row.display_name : row.commenter_display_name, 200),
      username: handle(postId ? row.username : row.commenter_display_name),
      at: unixTime(postId ? row.create_time : row.comment_create_time),
      hidden: row.status === "HIDDEN",
      owned: row.owner === true,
    };
  });
  return { comments, next };
}
