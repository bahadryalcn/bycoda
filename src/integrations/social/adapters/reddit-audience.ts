import { SocialHttp, SocialPlatformError, type SocialAccount } from "../adapter";
import type { CaptureSource, CollectedPerson, InteractionKind } from "../audience-types";
import {
  redditAt,
  redditCall,
  redditChildren,
  redditCursor,
  redditPostId,
  redditUsername,
  reject,
} from "./reddit-api";

type Child = { kind: unknown; data: Record<string, unknown> };

/** A person is the author of a post or comment. Deleted items and invalid usernames are dropped. */
function person(child: Child, kind: InteractionKind): CollectedPerson | undefined {
  const data = child.data;
  const author = typeof data.author === "string" ? data.author : undefined;
  const ref = typeof data.name === "string" ? data.name : undefined;
  const at = redditAt(data.created_utc);
  if (!author || author === "[deleted]" || !ref || at === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(author)) return undefined;
  const body =
    typeof data.title === "string" ? data.title : typeof data.body === "string" ? data.body : "";
  return {
    platformId: author,
    name: author,
    username: author,
    profileUrl: `https://www.reddit.com/user/${encodeURIComponent(author)}`,
    kind,
    ref,
    text: body.slice(0, 500),
    at,
  };
}

/** Commenters of one post: the first listing in /comments/{id} is the post, the second the comments. */
async function commentersOf(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  postId: string,
): Promise<CollectedPerson[]> {
  const { value } = await redditCall(http, account, token, `/comments/${postId}`, {
    query: { limit: "100", sort: "new" },
  });
  const comments = Array.isArray(value) ? redditChildren(value[1]) : [];
  return comments
    .filter((child) => child.kind === "t1")
    .map((child) => person(child as Child, "comment"))
    .filter((item): item is CollectedPerson => !!item);
}

/** Keyword search. A query starting with `r/<name> ` is restricted to that subreddit (unverified syntax). */
async function keywordPeople(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  query: string,
  cursor: string | undefined,
): Promise<{ people: CollectedPerson[]; next?: string }> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 200) reject("reddit.query_invalid");
  const scoped = /^r\/([A-Za-z0-9_]{3,21})\s+(.+)$/.exec(trimmed);
  const after = redditCursor(cursor);
  const { value } = await redditCall(
    http,
    account,
    token,
    scoped ? `/r/${scoped[1]}/search` : "/search",
    {
      query: {
        q: scoped ? scoped[2] : trimmed,
        sort: "new",
        limit: "50",
        ...(scoped ? { restrict_sr: "1" } : {}),
        ...(after ? { after } : {}),
      },
    },
  );
  const people = redditChildren(value)
    .map((child) => person(child as Child, "search"))
    .filter((item): item is CollectedPerson => !!item);
  return { people, next: redditCursor(value.data?.after) };
}

/**
 * Commenters on the account's own posts. With postRef only that post is read. Otherwise one page of
 * five recent submissions is read per call and each one's first 100 comments; the cursor is the
 * submissions listing `after`. shortcut: bounded per call, so a large history takes several calls.
 */
async function ownPostCommenters(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  postRef: string | undefined,
  cursor: string | undefined,
): Promise<{ people: CollectedPerson[]; next?: string }> {
  if (postRef) return { people: await commentersOf(http, account, token, redditPostId(postRef)) };
  const me = await redditCall(http, account, token, "/api/v1/me");
  const username = redditUsername(me.value.name);
  const after = redditCursor(cursor);
  const listing = await redditCall(http, account, token, `/user/${username}/submitted`, {
    query: { limit: "5", ...(after ? { after } : {}) },
  });
  const people: CollectedPerson[] = [];
  for (const child of redditChildren(listing.value)) {
    if (child.kind !== "t3" || typeof child.data.id !== "string") continue;
    people.push(...(await commentersOf(http, account, token, redditPostId(child.data.id))));
  }
  return { people, next: redditCursor(listing.value.data?.after) };
}

/** Audience sources Reddit can serve. Other kinds are refused as unsupported, never answered empty. */
export async function redditAudience(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  source: CaptureSource,
  cursor?: string,
): Promise<{ people: CollectedPerson[]; next?: string }> {
  if (source.kind === "keyword") return keywordPeople(http, account, token, source.query, cursor);
  if (source.kind === "own_post_comments")
    return ownPostCommenters(http, account, token, source.postRef, cursor);
  throw new SocialPlatformError("unsupported", undefined, {
    reasonCode: "reddit.audience_unsupported",
  });
}
