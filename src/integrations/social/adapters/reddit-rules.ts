import { SocialHttp, SocialPlatformError, type SocialAccount, type SocialJob } from "../adapter";
import { reject, redditCall, subredditName } from "./reddit-api";

/** Free-form Reddit fields the host copies into job.payload.reddit. The shape is checked, never trusted. */
export type RedditPayload = {
  subreddits?: string[];
  title?: string;
  kind?: "self" | "link";
  flairId?: string;
  subject?: string;
};

/** Reddit's published title limit is 300 characters (unverified against live docs). */
export const REDDIT_TITLE_LIMIT = 300;
/** Self-post and comment text limit (unverified against live docs). */
export const REDDIT_BODY_LIMIT = 10_000;
export const REDDIT_SELF_BODY_LIMIT = 40_000;
export const REDDIT_MESSAGE_SUBJECT_LIMIT = 100;

export function redditPayload(job: SocialJob): RedditPayload {
  const raw: unknown = (job.payload as { reddit?: unknown }).reddit;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) reject("reddit.payload_invalid");
  const value = raw as Record<string, unknown>;
  const { subreddits, title, kind, flairId, subject } = value;
  if (
    subreddits !== undefined &&
    (!Array.isArray(subreddits) || subreddits.some((item) => typeof item !== "string"))
  )
    reject("reddit.payload_invalid");
  if (title !== undefined && typeof title !== "string") reject("reddit.payload_invalid");
  if (kind !== undefined && kind !== "self" && kind !== "link") reject("reddit.payload_invalid");
  if (
    flairId !== undefined &&
    (typeof flairId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(flairId))
  )
    reject("reddit.payload_invalid");
  if (subject !== undefined && typeof subject !== "string") reject("reddit.payload_invalid");
  return {
    subreddits: subreddits as string[] | undefined,
    title: title as string | undefined,
    kind: kind as RedditPayload["kind"],
    flairId: flairId as string | undefined,
    subject: subject as string | undefined,
  };
}

export type RedditSubmission = {
  subreddit: string;
  kind: "self" | "link";
  title: string;
  text: string;
  link?: string;
  flairId?: string;
};

/** Synchronous platform-limit and one-subreddit checks. Nothing is sent when this throws. */
export function validateSubmission(job: SocialJob, payload: RedditPayload): RedditSubmission {
  if (job.payload.media.length > 0)
    throw new SocialPlatformError("unsupported", undefined, {
      reasonCode: "reddit.media_unsupported",
    });
  const targets = payload.subreddits ?? [];
  if (targets.length > 1) reject("reddit.one_subreddit");
  if (targets.length === 0) reject("reddit.subreddit_required");
  const subreddit = subredditName(targets[0]);
  const title = (payload.title ?? "").trim();
  if (title.length < 1 || title.length > REDDIT_TITLE_LIMIT) reject("reddit.title_length");
  const kind = payload.kind ?? (job.payload.link ? "link" : "self");
  if (kind === "link") {
    const link = job.payload.link ?? "";
    let parsed: URL | undefined;
    try {
      parsed = link ? new URL(link) : undefined;
    } catch {
      parsed = undefined;
    }
    if (
      !parsed ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      link.length > 2048
    )
      reject("reddit.link_invalid");
    return { subreddit, kind, title, text: "", link, flairId: payload.flairId };
  }
  const text = job.payload.text;
  if (text.length > REDDIT_SELF_BODY_LIMIT) reject("reddit.body_length");
  return { subreddit, kind, title, text, flairId: payload.flairId };
}

/**
 * Subreddit flair rule: when the subreddit requires flair and the job names none, the send is refused
 * before any write. The requirement comes from /api/v1/{sub}/post_requirements (unverified field name).
 */
export async function requireFlairIfNeeded(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  submission: Pick<RedditSubmission, "subreddit" | "flairId">,
): Promise<void> {
  if (submission.flairId) return;
  const { value } = await redditCall(
    http,
    account,
    token,
    `/api/v1/${submission.subreddit}/post_requirements`,
  );
  if (value.is_flair_required === true) reject("reddit.flair_required");
}

/**
 * Same content must not be posted to two subreddits at once. shortcut: in-memory, 24 h window, 500 entries;
 * a host restart forgets reservations. Queue-wide dedupe across accounts belongs to the host (request to owner).
 */
const DAY_MS = 86_400_000;
const CONTENT_LIMIT = 500;
const reservations = new Map<string, { subreddit: string; at: number }>();

export function reserveContent(submission: RedditSubmission, now: number): void {
  const key = JSON.stringify([
    submission.kind,
    submission.title,
    submission.text,
    submission.link ?? "",
  ]);
  for (const [item, entry] of reservations) if (now - entry.at > DAY_MS) reservations.delete(item);
  const existing = reservations.get(key);
  if (existing && existing.subreddit !== submission.subreddit) reject("reddit.one_subreddit");
  if (!existing && reservations.size >= CONTENT_LIMIT)
    reservations.delete(reservations.keys().next().value as string);
  reservations.set(key, { subreddit: submission.subreddit, at: now });
}

/** Subreddit rules for display (5A binds this). Needs the HTTP seam and a token, so it is not a pure function. */
export async function getSubredditRules(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  subreddit: string,
): Promise<{ shortName: string; description: string }[]> {
  const name = subredditName(subreddit);
  const { value } = await redditCall(http, account, token, `/r/${name}/about/rules`);
  const rules: unknown[] = Array.isArray(value.rules) ? value.rules : [];
  return rules.slice(0, 50).map((rule) => {
    const item = (rule ?? {}) as { short_name?: unknown; description?: unknown };
    return {
      shortName: typeof item.short_name === "string" ? item.short_name : "",
      description: typeof item.description === "string" ? item.description.slice(0, 2000) : "",
    };
  });
}

/** Link flair choices for a subreddit (/r/{sub}/api/link_flair_v2, unverified response shape). */
export async function getSubredditFlairs(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  subreddit: string,
): Promise<{ id: string; text: string }[]> {
  const name = subredditName(subreddit);
  const { value } = await redditCall(http, account, token, `/r/${name}/api/link_flair_v2`);
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items
    .map((item) => item as { id?: unknown; text?: unknown })
    .filter((item) => typeof item.id === "string")
    .slice(0, 200)
    .map((item) => ({
      id: item.id as string,
      text: typeof item.text === "string" ? item.text : "",
    }));
}
