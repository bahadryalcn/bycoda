import { SocialHttp, SocialPlatformError, type SocialAccount } from "../adapter";

export const REDDIT_API = "https://oauth.reddit.com";
/**
 * Reddit asks for `<platform>:<app id>:<version> (by /u/<username>)`. This generic value is a
 * shortcut: the owner should set the app identifier and a Reddit username, never a personal email.
 */
export const REDDIT_USER_AGENT = "bycoda-social/1.0";
/** OAuth clients get 60 requests per minute (Reddit OAuth2 wiki); the pause below follows the reset header. */
const pauses = new Map<string, number>();

export type RedditFullnamePrefix = "t1" | "t2" | "t3" | "t4" | "t5";
export type RedditForm = Record<string, string>;

export function reject(reasonCode: string): never {
  throw new SocialPlatformError("rejected", undefined, { reasonCode });
}

/** Fullname such as t1_abc (comment), t3_abc (post) or t4_abc (message). Anything else is rejected. */
export function redditFullname(value: unknown, allowed: readonly RedditFullnamePrefix[]): string {
  if (typeof value !== "string" || !/^t[1-5]_[a-z0-9]{1,30}$/.test(value))
    reject("reddit.fullname_invalid");
  const prefix = (value as string).slice(0, 2) as RedditFullnamePrefix;
  if (!allowed.includes(prefix)) reject("reddit.fullname_invalid");
  return value as string;
}

/** Bare base-36 identifier as used in /comments/{id}. A `t3_` prefix is accepted and removed. */
export function redditPostId(value: unknown): string {
  if (typeof value !== "string" || !/^(t3_)?[a-z0-9]{3,12}$/i.test(value))
    reject("reddit.post_id_invalid");
  return (value as string).replace(/^t3_/, "");
}

export function redditUsername(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{3,20}$/.test(value))
    reject("reddit.username_invalid");
  return value as string;
}

/** Subreddit names: letters, digits and underscore. Length follows Reddit's name rules (3 to 21 characters). */
export function subredditName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]{3,21}$/.test(value))
    reject("reddit.subreddit_invalid");
  return value as string;
}

/**
 * One Reddit request. The host-side allowlist must list oauth.reddit.com (request to owner: adapter.ts).
 * Rate-limit headers pause the account until the reset time, so later calls fail before any request.
 */
export async function redditCall(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  path: string,
  options: { query?: Record<string, string>; form?: RedditForm; now?: number } = {},
): Promise<{ value: Record<string, any>; headers: Headers }> {
  const now = options.now ?? Date.now();
  const until = pauses.get(account.id);
  if (until !== undefined && until > now) throw new SocialPlatformError("rate_limit", until);
  const url = new URL(path, REDDIT_API);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  url.searchParams.set("raw_json", "1");
  const headers = { "User-Agent": REDDIT_USER_AGENT };
  let result: { value: Record<string, any>; headers: Headers };
  try {
    result = options.form
      ? await http.request(url.toString(), token, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            api_type: "json",
            raw_json: "1",
            ...options.form,
          }).toString(),
        })
      : await http.request(url.toString(), token, { headers });
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "rate_limit" && error.retryAt)
      pauses.set(account.id, error.retryAt);
    throw error;
  }
  const remaining = result.headers.get("x-ratelimit-remaining");
  const reset = Number(result.headers.get("x-ratelimit-reset"));
  if (remaining !== null && Number(remaining) < 1 && Number.isFinite(reset) && reset > 0)
    pauses.set(account.id, now + reset * 1000);
  return result;
}

const DENIED = new Set(["SUBREDDIT_NOTALLOWED", "BANNED_FROM_SUBREDDIT", "NO_PERMISSION"]);

/** Maps one Reddit error entry ([code, message, field]) to the shared error vocabulary. */
export function redditErrorFor(code: string, message: string, now: number): SocialPlatformError {
  if (code === "RATELIMIT") {
    const wait = /(\d+)\s*(second|minute|hour)s?/i.exec(message);
    const seconds = wait
      ? Number(wait[1]) *
        { second: 1, minute: 60, hour: 3600 }[wait[2].toLowerCase() as "second" | "minute" | "hour"]
      : 600;
    return new SocialPlatformError("rate_limit", now + Math.max(1, seconds) * 1000);
  }
  if (code === "USER_REQUIRED") return new SocialPlatformError("expired");
  if (DENIED.has(code)) return new SocialPlatformError("denied");
  return new SocialPlatformError("rejected", undefined, {
    reasonCode: `reddit.${
      code
        .toLowerCase()
        .replace(/[^a-z_]/g, "")
        .slice(0, 60) || "unknown"
    }`,
  });
}

/** Reddit reports most write failures inside a 200 response at json.errors, which SocialHttp does not inspect. */
export function redditWriteErrors(value: Record<string, any>, now: number): void {
  const errors: unknown = value.json?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return;
  const first: unknown = errors[0];
  const code = Array.isArray(first) && typeof first[0] === "string" ? first[0] : "UNKNOWN";
  const message = Array.isArray(first) && typeof first[1] === "string" ? first[1] : "";
  throw redditErrorFor(code, message, now);
}

/** Reads the first thing a write endpoint returned. A missing id means the outcome is uncertain. */
export function redditCreatedName(
  value: Record<string, any>,
  prefixes: readonly RedditFullnamePrefix[],
): string {
  const things: unknown = value.json?.data?.things;
  const name = Array.isArray(things)
    ? (things[0] as { data?: { name?: unknown } })?.data?.name
    : undefined;
  if (typeof name !== "string" || !prefixes.some((prefix) => name.startsWith(`${prefix}_`)))
    throw new SocialPlatformError("unknown");
  return name;
}

/** Listing children: `{ data: { children: [{ kind, data }] } }`. Anything else yields no children. */
export function redditChildren(value: unknown): { kind: unknown; data: Record<string, unknown> }[] {
  const children = (value as { data?: { children?: unknown } } | undefined)?.data?.children;
  if (!Array.isArray(children)) return [];
  return children.filter(
    (child): child is { kind: unknown; data: Record<string, unknown> } =>
      !!child &&
      typeof child === "object" &&
      typeof (child as { data?: unknown }).data === "object",
  );
}

export const redditAt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value * 1000 : undefined;

/** Reddit listings return `after` as a fullname. Only a well-formed value is passed on. */
export function redditCursor(value: unknown): string | undefined {
  return typeof value === "string" && /^t[1-5]_[a-z0-9]{1,30}$/.test(value) ? value : undefined;
}

/** Test seam: clears learned pauses. Production code never calls it. */
export function resetRedditPauses(): void {
  pauses.clear();
}
