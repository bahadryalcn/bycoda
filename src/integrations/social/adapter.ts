import type {
  SocialAccount,
  SocialJob,
  SocialPlatform,
  SocialMonitorChannel,
} from "../../features/social/model/social";

export class SocialPlatformError extends Error {
  constructor(
    public readonly code:
      | "expired"
      | "denied"
      | "rate_limit"
      | "processing"
      | "unsupported"
      | "comments_disabled"
      | "unknown"
      | "rejected",
    public readonly retryAt?: number,
  ) {
    super(
      {
        expired: "OAuth token expired or revoked. Reconnect the account.",
        denied: "Platform permissions or account role do not allow this operation.",
        rate_limit: "Platform rate limit reached.",
        processing:
          "Platform accepted the video and is processing it. Awaiting publication confirmation.",
        unsupported: "This content or operation is unsupported by the platform adapter.",
        comments_disabled: "Comments are disabled on the target YouTube video.",
        unknown: "Platform outcome is uncertain. Review before another send.",
        rejected: "Platform rejected the request. Check content and account access.",
      }[code],
    );
  }
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
export interface SocialAdapter {
  creatorInfo?(
    account: SocialAccount,
    token: string,
  ): Promise<import("../../features/social/model/social").TikTokCreatorInfo>;
  send(
    account: SocialAccount,
    job: SocialJob,
    token: string,
    media: (id: string) => Promise<Uint8Array>,
    checkpoint?: (state: NonNullable<SocialJob["preparation"]>) => void,
  ): Promise<SocialSendResult>;
  poll(
    account: SocialAccount,
    token: string,
    posts: string[],
    cursor?: string,
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
}
export type SocialAdapters = Record<SocialPlatform, SocialAdapter>;
export function retryAfter(headers: Headers, now: number): number {
  const value = headers.get("retry-after");
  const seconds =
    value && /^\d+$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - now : NaN;
  const reset = Number(headers.get("x-rate-limit-reset")) * 1000;
  return Math.max(
    now + 1000,
    Number.isFinite(seconds) ? now + seconds : reset > now ? reset : now + 60_000,
  );
}

/** Requests never follow redirects or return platform error bodies containing secrets. */
export class SocialHttp {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {}
  /** Bot tokens occur in Telegram paths. Never expose fetch errors or response bodies. */
  async telegram(
    method: "getMe" | "getWebhookInfo" | "getUpdates" | "sendMessage",
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new SocialPlatformError("denied");
    let response: Response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
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
          parsed.hostname === "www.googleapis.com" && parsed.pathname.startsWith("/upload/youtube/")
            ? 120_000
            : 30_000,
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
        if ([4, 17, 341].includes(code))
          throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
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
  async uploadLinkedInImage(url: string, token: string, bytes: Uint8Array): Promise<void> {
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
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new SocialPlatformError("unknown");
    }
    if (response.status === 429)
      throw new SocialPlatformError("rate_limit", retryAfter(response.headers, this.now()));
    if (response.status === 401) throw new SocialPlatformError("expired");
    if (!response.ok)
      throw new SocialPlatformError(response.status >= 500 ? "unknown" : "rejected");
  }
}
