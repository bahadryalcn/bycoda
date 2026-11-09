import type {
  SocialAccount,
  SocialJob,
  SocialPlatform,
  SocialMonitorChannel,
  Capability,
  SocialMedia,
  SocialOperation,
} from "../../features/social/model/social";
import type { CaptureSource, CollectedPerson } from "./audience-types";
import { META_RATE_LIMIT_CODES } from "./meta-codes";

export type { Capability, SocialAccount, SocialJob, SocialMedia, SocialOperation };

/** WhatsApp Cloud API throughput codes on graph.facebook.com. Unverified: from general knowledge, not re-checked live. */
const WHATSAPP_RATE_LIMIT_CODES: readonly number[] = [80007, 130429, 131056];
/** Outside the 24-hour customer window; only an approved template may start the conversation. Unverified code. */
const WHATSAPP_WINDOW_CLOSED_CODE = 131047;

/**
 * Standard error codes. Contract names: NOT_SUPPORTED=unsupported, AUTH_EXPIRED=expired,
 * RATE_LIMITED=rate_limit, NEEDS_HUMAN=needs_human, PLATFORM_ERROR=rejected or unknown.
 */
export type SocialErrorCode =
  | "expired"
  | "denied"
  | "rate_limit"
  | "processing"
  | "unsupported"
  | "comments_disabled"
  | "needs_human"
  | "unknown"
  | "rejected";

/** Non-secret context for a human step. Never put tokens, cookies or raw provider payloads here. */
export type SocialErrorDetail = { url?: string; screenshotId?: string; reasonCode?: string };

export class SocialPlatformError extends Error {
  constructor(
    public readonly code: SocialErrorCode,
    public readonly retryAt?: number,
    public readonly detail?: SocialErrorDetail,
  ) {
    super(
      {
        expired: "OAuth token expired or revoked. Reconnect the account.",
        denied: "Platform permissions or account role do not allow this operation.",
        rate_limit: "Platform rate limit reached.",
        processing:
          "Platform accepted the media and is processing it. Awaiting publication confirmation.",
        unsupported: "This content or operation is unsupported by the platform adapter.",
        comments_disabled: "Comments are disabled on the target YouTube video.",
        needs_human: "Human verification is required in the browser. The job is waiting for you.",
        unknown: "Platform outcome is uncertain. Review before another send.",
        rejected: "Platform rejected the request. Check content and account access.",
      }[code],
    );
  }
}

/**
 * Hybrid mode: the browser is tried only when the API could not start the job. An outcome
 * after `dispatchedAt` is never retried, because the platform may already hold the content.
 */
export function fallbackAllowed(job: SocialJob, error: unknown, browserSupports: boolean): boolean {
  if (!browserSupports || job.dispatchedAt !== undefined) return false;
  return (
    error instanceof SocialPlatformError &&
    (error.code === "rate_limit" || error.code === "unsupported")
  );
}
export type SocialSendResult = {
  platformId: string;
  url?: string;
  visibility?: "private" | "unlisted" | "public";
};
export type SocialInbound = {
  eventId: string;
  threadId: string;
  contactId: string;
  contactName: string;
  kind: "message" | "comment";
  text: string;
  at: number;
  replyUntil?: number;
  postId?: string;
  optedOut?: boolean;
  replyAllowed?: boolean;
};
export type SocialOwnedPostPage = (after?: string) => Promise<{
  posts: string[];
  next?: string;
}>;
export interface SocialAdapter {
  /** Fetch bounded owned-publication pages only when the pending scan drains. */
  ownedPostPages?: true;
  creatorInfo?(
    account: SocialAccount,
    token: string,
  ): Promise<import("../../features/social/model/social").TikTokCreatorInfo>;
  send(
    account: SocialAccount,
    job: SocialJob,
    token: string,
    media: (id: string) => Promise<Uint8Array>,
    checkpoint?: (state: NonNullable<SocialJob["preparation"]>) => void | Promise<void>,
    /** Long browser flows must revalidate Stop, policy and grants immediately before submitting. */
    beforeSubmit?: () => Promise<void>,
  ): Promise<SocialSendResult>;
  poll(
    account: SocialAccount,
    token: string,
    posts: string[],
    cursor?: string,
    ownedPosts?: SocialOwnedPostPage,
  ): Promise<{
    events: SocialInbound[];
    cursor?: string;
    coverage?: SocialMonitorChannel[];
  }>;
  reconcile?(
    account: SocialAccount,
    job: SocialJob,
    token: string,
  ): Promise<SocialSendResult | undefined>;
  /** Optional operations below are opened per platform by capabilities/<platform>.ts (4E). */
  deletePost?(account: SocialAccount, token: string, platformId: string): Promise<void>;
  listPosts?(
    account: SocialAccount,
    token: string,
    cursor?: string,
  ): Promise<{
    posts: { id: string; url?: string; at: number; text?: string }[];
    next?: string;
  }>;
  getComments?(
    account: SocialAccount,
    token: string,
    postId: string,
    cursor?: string,
  ): Promise<{ events: SocialInbound[]; next?: string }>;
  getAnalytics?(
    account: SocialAccount,
    token: string,
    postIds: string[],
  ): Promise<
    Record<string, { views?: number; likes?: number; comments?: number; shares?: number }>
  >;
  getProfile?(
    account: SocialAccount,
    token: string,
  ): Promise<{ name: string; username?: string; followers?: number }>;
  collectAudience?(
    account: SocialAccount,
    token: string,
    source: CaptureSource,
    cursor?: string,
  ): Promise<{ people: CollectedPerson[]; next?: string }>;
  healthCheck?(
    account: SocialAccount,
    token: string,
  ): Promise<{ ok: boolean; code?: SocialErrorCode }>;
}
export type SocialAdapters = Record<SocialPlatform, SocialAdapter>;
/**
 * Delay for a rate-limited response. Retry-After wins. Reddit's `X-Ratelimit-Reset` is seconds until the
 * window resets (relative). X's `x-rate-limit-reset` is an epoch time in seconds (absolute). The headers
 * are not interchangeable, so each is read with its own meaning.
 */
export function retryAfter(headers: Headers, now: number): number {
  const value = headers.get("retry-after");
  const seconds =
    value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now : NaN;
  const redditSeconds = Number(headers.get("x-ratelimit-reset"));
  const xEpoch = Number(headers.get("x-rate-limit-reset")) * 1000;
  return Math.max(
    now + 1000,
    Number.isFinite(seconds)
      ? now + seconds
      : Number.isFinite(redditSeconds) && redditSeconds > 0
        ? now + redditSeconds * 1000
        : xEpoch > now
          ? xEpoch
          : now + 60_000,
  );
}

/** Allow upload transfer time at 128 KiB/s, plus latency; every request stays bounded. */
function requestTimeout(
  body: BodyInit | ArrayBufferView | null | undefined,
  minimum = 30_000,
): number {
  const size = (value: FormDataEntryValue): number =>
    typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.size;
  let bytes = 0;
  if (typeof body === "string") bytes = new TextEncoder().encode(body).byteLength;
  else if (body instanceof Blob) bytes = body.size;
  else if (body instanceof ArrayBuffer) bytes = body.byteLength;
  else if (ArrayBuffer.isView(body)) bytes = body.byteLength;
  else if (body instanceof FormData) {
    for (const [key, value] of body) bytes += size(key) + size(value);
  } else if (body instanceof URLSearchParams)
    bytes = new TextEncoder().encode(body.toString()).byteLength;
  return Math.min(15 * 60_000, minimum + Math.ceil(bytes / (128 * 1024)) * 1000);
}

/** Requests never follow redirects or return platform error bodies containing secrets. */
export class SocialHttp {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}
  /** Bot tokens occur in Telegram paths. Never expose fetch errors or response bodies. */
  async telegram(
    method:
      | "getMe"
      | "getChat"
      | "getChatMember"
      | "getWebhookInfo"
      | "getUpdates"
      | "sendMessage"
      | "sendPhoto"
      | "sendVideo"
      | "sendPoll"
      | "editMessageText"
      | "deleteMessage"
      | "pinChatMessage"
      | "unpinChatMessage"
      | "setWebhook"
      | "deleteWebhook",
    token: string,
    body: Record<string, unknown> | FormData = {},
  ): Promise<Record<string, any>> {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new SocialPlatformError("denied");
    let response: Response;
    try {
      const requestBody = body instanceof FormData ? body : JSON.stringify(body);
      response = await this.fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }),
        body: requestBody,
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeout(requestBody)),
      });
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const value = await response.json().catch(() => {
      throw new SocialPlatformError(response.ok ? "unknown" : "rejected");
    });
    if (response.status === 429 || value.error_code === 429)
      throw new SocialPlatformError(
        "rate_limit",
        this.now() + Math.max(1, Number(value.parameters?.retry_after) || 60) * 1000,
      );
    if (response.status === 401 || value.error_code === 401)
      throw new SocialPlatformError("expired");
    if (response.status === 403 || value.error_code === 403)
      throw new SocialPlatformError("denied");
    if (response.status >= 500) throw new SocialPlatformError("unknown");
    if (!response.ok || value.ok !== true) throw new SocialPlatformError("rejected");
    return value.result;
  }
  async request(
    url: string,
    token: string,
    options: RequestInit = {},
  ): Promise<{ value: Record<string, any>; headers: Headers }> {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      ![
        "api.x.com",
        "graph.instagram.com",
        "graph.facebook.com",
        "api.linkedin.com",
        "www.googleapis.com",
        "open.tiktokapis.com",
        "businessapi.snapchat.com",
        "oauth.reddit.com",
      ].includes(parsed.hostname)
    )
      throw new SocialPlatformError("denied");
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
        redirect: "error",
        signal: AbortSignal.timeout(
          requestTimeout(
            options.body,
            parsed.hostname === "www.googleapis.com" &&
              parsed.pathname.startsWith("/upload/youtube/")
              ? 120_000
              : 30_000,
          ),
        ),
      });
    } catch {
      throw new SocialPlatformError("unknown");
    }
    if (response.status === 401) throw new SocialPlatformError("expired");
    if (response.status === 403) {
      if (parsed.hostname === "www.googleapis.com") {
        const error = await response.json().catch(() => ({}));
        const reasons = (error?.error?.errors ?? []).map(
          (item: { reason?: string }) => item.reason,
        );
        if (
          reasons.some((reason: string) =>
            [
              "quotaExceeded",
              "dailyLimitExceeded",
              "rateLimitExceeded",
              "userRateLimitExceeded",
            ].includes(reason),
          )
        )
          throw new SocialPlatformError(
            "rate_limit",
            reasons.some((reason: string) =>
              ["quotaExceeded", "dailyLimitExceeded"].includes(reason),
            )
              ? this.now() + 6 * 60 * 60_000
              : retryAfter(response.headers, this.now()),
          );
        if (reasons.includes("commentsDisabled"))
          throw new SocialPlatformError("comments_disabled");
      }
      throw new SocialPlatformError("denied");
    }
    if (response.status === 429)
      throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    if (response.status >= 500) throw new SocialPlatformError("unknown");
    if (!response.ok) {
      if (["graph.instagram.com", "graph.facebook.com"].includes(parsed.hostname)) {
        // Meta frequently returns auth/permission errors as HTTP 400. Inspect
        // numeric codes only; never expose its error message or trace payload.
        const value = await response.json().catch(() => ({}));
        const code = Number(value?.error?.code);
        if ([102, 190].includes(code)) throw new SocialPlatformError("expired");
        if (code === 10 || (code >= 200 && code <= 299)) throw new SocialPlatformError("denied");
        if (META_RATE_LIMIT_CODES.includes(code) || WHATSAPP_RATE_LIMIT_CODES.includes(code))
          throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
        if (code === WHATSAPP_WINDOW_CLOSED_CODE)
          throw new SocialPlatformError("rejected", undefined, {
            reasonCode: "whatsapp.window_closed_template_required",
          });
        if ([1, 2].includes(code)) throw new SocialPlatformError("unknown");
      }
      throw new SocialPlatformError("rejected");
    }
    let value: Record<string, any>;
    try {
      value =
        response.status === 204 ||
        response.headers.get("content-length") === "0" ||
        (parsed.hostname === "www.googleapis.com" &&
          options.method === "POST" &&
          parsed.pathname === "/upload/youtube/v3/videos" &&
          response.headers.has("location"))
          ? {}
          : ((await response.json()) as Record<string, any>);
    } catch {
      if (response.status === 201) value = {};
      else throw new SocialPlatformError("unknown");
    }
    if (parsed.hostname === "open.tiktokapis.com") {
      // TikTok body error codes. Unverified against live docs: a bad token means reconnect, a quota
      // limit means wait. Everything else keeps the generic rejection below.
      if (value?.error?.code === "access_token_invalid") throw new SocialPlatformError("expired");
      if (value?.error?.code === "rate_limit_exceeded")
        throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    }
    if (
      (value.error && !(parsed.hostname === "open.tiktokapis.com" && value.error.code === "ok")) ||
      value.errors?.length ||
      value.request_status === "ERROR"
    )
      throw new SocialPlatformError("rejected");
    return { value, headers: response.headers };
  }
  json(url: string, token: string, value: unknown, headers: Record<string, string> = {}) {
    return this.request(url, token, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  }
  /** Upload URL is used only in this host-side call and never returned or checkpointed. */
  async uploadYouTubeVideo(token: string, metadata: unknown, bytes: Uint8Array) {
    if (!bytes.length || bytes.length > 64 * 1024 * 1024)
      throw new SocialPlatformError("unsupported");
    const mime =
      new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp"
        ? "video/mp4"
        : bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
          ? "video/webm"
          : undefined;
    if (!mime) throw new SocialPlatformError("unsupported");
    const start = await this.json(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      token,
      metadata,
      {
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(bytes.length),
      },
    );
    const location = start.headers.get("location");
    if (!location) throw new SocialPlatformError("unknown");
    let parsed: URL;
    try {
      parsed = new URL(location);
    } catch {
      throw new SocialPlatformError("denied");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "www.googleapis.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/upload/youtube/v3/videos" ||
      !parsed.searchParams.get("upload_id")
    )
      throw new SocialPlatformError("denied");
    return this.request(location, token, {
      method: "PUT",
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      },
      body: new Uint8Array(bytes),
    });
  }
  /** Reels transfer uses a fixed host/path, never a server-provided arbitrary upload URL. */
  async uploadFacebookReel(
    version: string,
    videoId: string,
    token: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (
      !/^v\d{1,3}\.\d{1,2}$/.test(version) ||
      !/^[1-9]\d{0,24}$/.test(videoId) ||
      bytes.length < 12 ||
      bytes.length > 64 * 1024 * 1024 ||
      new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
    )
      throw new SocialPlatformError("unsupported");
    let response: Response;
    try {
      response = await this.fetcher(
        `https://rupload.facebook.com/video-upload/${version}/${videoId}`,
        {
          method: "POST",
          headers: {
            Authorization: `OAuth ${token}`,
            offset: "0",
            file_size: String(bytes.length),
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(bytes),
          redirect: "error",
          signal: AbortSignal.timeout(requestTimeout(bytes, 120_000)),
        },
      );
    } catch {
      throw new SocialPlatformError("unknown");
    }
    if (response.status === 401) throw new SocialPlatformError("expired");
    if (response.status === 403) throw new SocialPlatformError("denied");
    if (response.status === 429)
      throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    if (!response.ok)
      throw new SocialPlatformError(response.status >= 500 ? "unknown" : "rejected");
    const result = await response.json().catch(() => {
      throw new SocialPlatformError("unknown");
    });
    if (result?.success !== true) throw new SocialPlatformError("unknown");
  }
  /** Returns the part ETag, which a multipart upload needs for its finalize call. */
  async uploadLinkedInImage(
    url: string,
    token: string,
    bytes: Uint8Array,
  ): Promise<{ etag?: string }> {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "www.linkedin.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith("/dms-uploads/")
    )
      throw new SocialPlatformError("denied");
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeout(bytes)),
      });
    } catch {
      throw new SocialPlatformError("unknown");
    }
    if (response.status === 429)
      throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    if (response.status === 401) throw new SocialPlatformError("expired");
    if (!response.ok)
      throw new SocialPlatformError(response.status >= 500 ? "unknown" : "rejected");
    return { etag: response.headers.get("etag") ?? undefined };
  }
}
