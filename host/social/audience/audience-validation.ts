import { SOCIAL_PLATFORMS, type SocialPlatform } from "../../../src/features/social/model/social";
import type {
  AudienceFilter,
  CaptureRule,
  ContactEmail,
  PersonStage,
  SocialPerson,
} from "../../../src/features/social/model/audience";
import type {
  CaptureSource,
  InteractionKind,
} from "../../../src/integrations/social/audience-types";
import { array, exact, finite, str } from "../core/social-helpers";

export const PERSON_STAGES: readonly PersonStage[] = [
  "new",
  "contacted",
  "replied",
  "interested",
  "customer",
  "closed",
  "opted_out",
];
export const INTERACTION_KINDS: readonly InteractionKind[] = [
  "comment",
  "like",
  "share",
  "quote",
  "mention",
  "dm",
  "follower",
  "search",
  "import",
  "email",
  "reply",
];
const CAPTURE_KINDS = [
  "own_post_comments",
  "own_post_likes",
  "own_post_shares",
  "mentions",
  "dm_senders",
  "followers",
  "keyword",
  "hashtag",
  "account_commenters",
] as const;
const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const EMAIL_SOURCES = ["public_profile", "import", "manual", "inbound"] as const;
const IYS_STATES = ["unknown", "approved", "rejected"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function oneOfList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  maximum: number,
): T[] {
  return array(value, field, maximum).map((item) => {
    if (!(allowed as readonly string[]).includes(item)) throw new Error(`Invalid ${field}.`);
    return item as T;
  });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    throw new Error(`Invalid ${field}.`);
  return value as T;
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${field}.`);
  return value as Record<string, unknown>;
}

/** Page size from the caller, within [1, maximum]; absent means the fallback. */
export function parseLimit(value: unknown, maximum: number, fallback: number): number {
  return value === undefined ? fallback : finite(value, "limit", 1, maximum);
}

export function parseCursor(value: unknown): string | undefined {
  return value === undefined ? undefined : str(value, "cursor", 500);
}

export function parseFilter(value: unknown): AudienceFilter {
  if (value === undefined || value === null) return {};
  const raw = plainObject(value, "audience filter");
  exact(raw, ["tags", "language", "platforms", "stages", "minScore", "query", "sources"]);
  const filter: AudienceFilter = {};
  if (raw.tags !== undefined) filter.tags = array(raw.tags, "tags", 20);
  if (raw.language !== undefined) filter.language = str(raw.language, "language", 30);
  if (raw.platforms !== undefined)
    filter.platforms = oneOfList<SocialPlatform>(raw.platforms, SOCIAL_PLATFORMS, "platforms", 10);
  if (raw.stages !== undefined) filter.stages = oneOfList(raw.stages, PERSON_STAGES, "stages", 10);
  if (raw.minScore !== undefined) filter.minScore = finite(raw.minScore, "minimum score", 0, 100);
  if (raw.query !== undefined) filter.query = str(raw.query, "search text", 200);
  if (raw.sources !== undefined)
    filter.sources = oneOfList(raw.sources, INTERACTION_KINDS, "sources", INTERACTION_KINDS.length);
  return filter;
}

export function isEmptyFilter(filter: AudienceFilter | undefined): boolean {
  return Object.values(filter ?? {}).every(
    (value) => value === undefined || (Array.isArray(value) && value.length === 0),
  );
}

export function parseStage(value: unknown): PersonStage {
  return oneOf(value, PERSON_STAGES, "stage");
}

export function parseEmails(value: unknown): ContactEmail[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error("Invalid emails.");
  return value.map((item) => {
    const raw = plainObject(item, "email");
    const address = str(raw.address, "email address", 320).toLowerCase();
    if (!EMAIL.test(address)) throw new Error("Invalid email address.");
    const source =
      raw.source === undefined ? "manual" : oneOf(raw.source, EMAIL_SOURCES, "email source");
    return { address, source, verified: raw.verified === true };
  });
}

export function parseCommercialConsent(
  value: unknown,
): NonNullable<SocialPerson["commercialConsent"]> {
  const raw = plainObject(value, "commercial consent");
  exact(raw, ["iys", "checkedAt"]);
  const iys = oneOf(raw.iys, IYS_STATES, "IYS status");
  return {
    iys,
    ...(raw.checkedAt !== undefined ? { checkedAt: finite(raw.checkedAt, "check date", 0) } : {}),
  };
}

export function parseCaptureSource(value: unknown): CaptureSource {
  const raw = plainObject(value, "capture source");
  exact(raw, ["kind", "accountId", "postRef", "query", "handle"]);
  const accountId = str(raw.accountId, "account", 300);
  const kind = oneOf(raw.kind, CAPTURE_KINDS, "capture source");
  if (kind === "keyword" || kind === "hashtag")
    return { kind, accountId, query: str(raw.query, "search query", 200) };
  if (kind === "account_commenters")
    return { kind, accountId, handle: str(raw.handle, "account handle", 200) };
  return {
    kind,
    accountId,
    ...(raw.postRef !== undefined ? { postRef: str(raw.postRef, "post", 300) } : {}),
  };
}

export function parseCaptureFilter(value: unknown): CaptureRule["filter"] {
  if (value === undefined || value === null) return {};
  const raw = plainObject(value, "capture filter");
  exact(raw, ["keywords", "language", "minFollowers", "sentiment"]);
  const filter: CaptureRule["filter"] = {};
  if (raw.keywords !== undefined) filter.keywords = array(raw.keywords, "keywords", 50);
  if (raw.language !== undefined) filter.language = str(raw.language, "language", 30);
  if (raw.minFollowers !== undefined)
    filter.minFollowers = finite(raw.minFollowers, "minimum followers", 0, 1_000_000_000);
  if (raw.sentiment !== undefined) filter.sentiment = oneOf(raw.sentiment, SENTIMENTS, "sentiment");
  return filter;
}

export function parseCaptureAction(value: unknown): CaptureRule["action"] {
  if (value === undefined || value === null) return undefined;
  const raw = plainObject(value, "capture action");
  exact(raw, ["kind", "tag", "sequenceId"]);
  if (raw.kind === "tag") return { kind: "tag", tag: str(raw.tag, "tag", 30) };
  if (raw.kind === "enroll")
    return { kind: "enroll", sequenceId: str(raw.sequenceId, "sequence", 300) };
  throw new Error("Invalid capture action.");
}
