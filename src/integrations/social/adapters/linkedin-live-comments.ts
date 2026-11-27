import { SocialPlatformError, type SocialAccount, type SocialHttp } from "../adapter";
import {
  LINKEDIN_LIVE_EVENT_ID,
  LINKEDIN_LIVE_EVENT_READ_SCOPE,
  type LinkedInLiveCommentsPage,
} from "../live-linkedin";
import { linkedInActorId } from "./linkedin-formats";

const PAGE_SIZE = 50;
const postUrn = /^urn:li:(?:ugcPost|share):[1-9]\d{0,24}$/;
const commentUrn =
  /^urn:li:comment:\(urn:li:(?:activity|share|ugcPost):[1-9]\d{0,24},[1-9]\d{0,24}\)$/;
const parentUrn = /^urn:li:(?:activity|ugcPost|share):[1-9]\d{0,24}$/;
const actorUrn = /^urn:li:(?:person|organization|organizationBrand):[A-Za-z0-9_-]{1,150}$/;

export async function readLinkedInLiveComments(
  http: SocialHttp,
  version: string,
  account: SocialAccount,
  token: string,
  eventId: string,
  offset: number,
): Promise<LinkedInLiveCommentsPage> {
  if (
    account.platform !== "linkedin" ||
    account.accountType !== "organization" ||
    account.connection !== "oauth"
  )
    throw new SocialPlatformError("unsupported");
  if (
    !account.scopes.some(
      (scope) => scope === LINKEDIN_LIVE_EVENT_READ_SCOPE || scope === "rw_events",
    ) ||
    !account.scopes.includes("r_organization_social_feed")
  )
    throw new SocialPlatformError("denied", undefined, {
      reasonCode: "linkedin.live.comments.access",
    });
  if (
    !LINKEDIN_LIVE_EVENT_ID.test(eventId) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  )
    throw new SocialPlatformError("rejected");
  const headers = { "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" };
  const { value: event } = await http.request(
    `https://api.linkedin.com/rest/events/${eventId}`,
    token,
    { headers },
  );
  if (event.organizer !== linkedInActorId(account)) throw new SocialPlatformError("denied");
  const postId = event.ugcPost;
  const liveVideo = event.type?.online?.format?.liveVideo;
  if (
    !liveVideo ||
    typeof liveVideo !== "object" ||
    Array.isArray(liveVideo) ||
    typeof postId !== "string" ||
    !postUrn.test(postId)
  )
    throw new SocialPlatformError("unsupported");
  const { value: page } = await http.request(
    `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments?count=${PAGE_SIZE}&start=${offset}`,
    token,
    { headers },
  );
  if (!Array.isArray(page.elements) || page.elements.length > PAGE_SIZE)
    throw new SocialPlatformError("unknown");
  const seen = new Set<string>();
  const comments: LinkedInLiveCommentsPage["comments"] = [];
  for (const comment of page.elements) {
    if (
      !comment ||
      typeof comment.actor !== "string" ||
      !actorUrn.test(comment.actor) ||
      typeof comment.message?.text !== "string"
    )
      throw new SocialPlatformError("unknown");
    const id =
      comment.commentUrn ??
      (typeof comment.object === "string" &&
      parentUrn.test(comment.object) &&
      typeof comment.id === "string" &&
      LINKEDIN_LIVE_EVENT_ID.test(comment.id)
        ? `urn:li:comment:(${comment.object},${comment.id})`
        : undefined);
    if (typeof id !== "string" || !commentUrn.test(id)) throw new SocialPlatformError("unknown");
    if (seen.has(id)) continue;
    seen.add(id);
    comments.push({ id, actor: comment.actor, text: comment.message.text });
  }
  const more =
    page.elements.length === PAGE_SIZE &&
    (!Number.isFinite(page.paging?.total) || offset + PAGE_SIZE < page.paging.total);
  return {
    eventId,
    postId,
    comments,
    ...(more && offset + PAGE_SIZE <= 100_000 ? { nextOffset: offset + PAGE_SIZE } : {}),
  };
}
