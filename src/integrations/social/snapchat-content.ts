import { truncateGraphemes } from "../../shared/lib/text/truncate";
import { isoTimestamp } from "../../shared/lib/time/timestamps";
import { SocialPlatformError, type SocialHttp } from "./adapter";

export const snapchatApiOrigin = "https://businessapi.snapchat.com";
export const snapchatUuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const snapchatSnapId = /^[A-Za-z0-9_-]{8,200}$/;

const collections = {
  spotlight: { collection: "spotlights", entry: "spotlight", pattern: snapchatSnapId },
  story: { collection: "stories", entry: "story", pattern: snapchatUuid },
  saved_story: { collection: "saved_stories", entry: "saved_story", pattern: snapchatUuid },
} as const;

export type SnapchatContentTarget = keyof typeof collections;
export type SnapchatContentQuery = {
  target: SnapchatContentTarget;
  id?: string;
  cursor?: string;
  limit?: number;
  createdAt?: string;
  endedAt?: string;
};
export type SnapchatContentItem = {
  target: SnapchatContentTarget;
  id: string;
  parentId?: string;
  title?: string;
  caption?: string;
  createdAt?: string;
  endedAt?: string;
  status?: "live" | "submitted" | "rejected";
};
export type SnapchatContentPage = {
  items: SnapchatContentItem[];
  cursor?: string;
  partial: boolean;
};
export type SnapchatDeleteInput = {
  target: "spotlight" | "saved_story";
  id: string;
  confirmId: string;
};

type SnapchatAccountIdentity = {
  platform: string;
  platformId: string;
  connection?: string;
  accountType?: string;
  scopes: readonly string[];
};

export function snapchatProfileUrl(actorId: string): string {
  if (!snapchatUuid.test(actorId)) throw new SocialPlatformError("unsupported");
  return `${snapchatApiOrigin}/v1/public_profiles/${actorId}`;
}

export function snapchatApiProfile(account: SnapchatAccountIdentity): boolean {
  return (
    account.platform === "snapchat" &&
    account.connection !== "browser" &&
    account.accountType === "public_profile" &&
    snapchatUuid.test(account.platformId)
  );
}

function accountProfileId(account: SnapchatAccountIdentity): string {
  if (!snapchatApiProfile(account)) throw new SocialPlatformError("unsupported");
  if (!account.scopes.includes("snapchat-profile-api")) throw new SocialPlatformError("denied");
  return account.platformId.toLowerCase();
}

export async function verifySnapchatProfile(http: SocialHttp, actorId: string, token: string) {
  const { value } = await http.request(`${snapchatApiOrigin}/v1/public_profiles/my_profile`, token);
  if (value?.request_status !== "SUCCESS") throw new SocialPlatformError("unknown");
  if (
    typeof value.public_profile?.id !== "string" ||
    value.public_profile.id.toLowerCase() !== actorId
  )
    throw new SocialPlatformError("denied");
}

const textField = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? truncateGraphemes(value, 1000) : undefined;

function dateField(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value)) return;
  return isoTimestamp(Date.parse(value));
}

function getTarget(target: SnapchatContentTarget) {
  if (!Object.prototype.hasOwnProperty.call(collections, target))
    throw new SocialPlatformError("unsupported");
  return collections[target];
}

type SnapPage = {
  matchedUploadIds: Map<string, string>;
  page: SnapchatContentPage;
};

async function fetchSnapchatContent(
  http: SocialHttp,
  actorId: string,
  token: string,
  query: SnapchatContentQuery,
): Promise<SnapPage> {
  const target = getTarget(query.target);
  if (query.id !== undefined && (typeof query.id !== "string" || !target.pattern.test(query.id)))
    throw new SocialPlatformError("unsupported");
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" || query.cursor.length > 4096)
  )
    throw new SocialPlatformError("unsupported");
  const isSnapList = query.id !== undefined && query.target !== "spotlight";
  const key = isSnapList ? "snaps" : target.collection;
  const entryName = isSnapList ? "snap" : target.entry;
  const url = new URL(`${snapchatProfileUrl(actorId)}/${target.collection}`);
  if (query.id !== undefined) url.pathname += `/${encodeURIComponent(query.id)}`;
  if (isSnapList) url.pathname += "/snaps";
  if (query.id === undefined || isSnapList) {
    const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(100, query.limit!)) : 20;
    url.searchParams.set("limit", String(limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
  }
  if (isSnapList && query.target === "story") {
    const createdAt = dateField(query.createdAt);
    const endedAt = dateField(query.endedAt);
    if (createdAt && endedAt) {
      url.searchParams.set("created_at", createdAt);
      url.searchParams.set("ended_at", endedAt);
    }
  }

  const { value } = await http.request(url.href, token);
  if (
    (value?.request_status !== "SUCCESS" && value?.request_status !== "PARTIAL") ||
    !Array.isArray(value[key])
  )
    throw new SocialPlatformError("unknown");

  const matchedUploadIds = new Map<string, string>();
  const items: SnapchatContentItem[] = [];
  let partial = value.request_status === "PARTIAL";
  for (const entry of value[key]) {
    const item = entry?.[entryName];
    if (
      entry?.sub_request_status !== "SUCCESS" ||
      typeof item?.id !== "string" ||
      !(isSnapList ? snapchatSnapId : target.pattern).test(item.id) ||
      (isSnapList
        ? typeof item.story_id !== "string" ||
          item.story_id.toLowerCase() !== query.id?.toLowerCase()
        : typeof item.profile_id !== "string" || item.profile_id.toLowerCase() !== actorId) ||
      (!isSnapList && query.id !== undefined && item.id !== query.id)
    ) {
      partial = true;
      continue;
    }
    const status =
      item.status === "LIVE"
        ? "live"
        : item.status === "SUBMITTED"
          ? "submitted"
          : item.status === "REJECTED"
            ? "rejected"
            : undefined;
    items.push({
      target: query.target,
      id: item.id,
      parentId: isSnapList ? query.id : undefined,
      title: textField(item.title),
      caption: textField(item.caption),
      createdAt: dateField(item.created_at),
      endedAt: dateField(item.ended_at),
      status,
    });
    if (isSnapList && typeof item.media_id === "string" && snapchatUuid.test(item.media_id))
      matchedUploadIds.set(item.id, item.media_id.toLowerCase());
  }
  const nextPage = value.paging?.next_page_id;
  const cursor =
    typeof nextPage === "string" && nextPage.length > 0 && nextPage.length <= 4096
      ? nextPage
      : undefined;
  return { matchedUploadIds, page: { items, cursor, partial } };
}

/** Existing sources must be exact Spotlights or public Story Snaps of the posting profile. */
export async function verifySnapchatSavedStorySources(
  http: SocialHttp,
  actorId: string,
  token: string,
  sources: readonly { kind: "spotlight" | "snap"; id: string }[],
): Promise<void> {
  const spotlightIds = new Set(
    sources.filter(({ kind }) => kind === "spotlight").map(({ id }) => id),
  );
  for (const id of spotlightIds) {
    const { page } = await fetchSnapchatContent(http, actorId, token, { target: "spotlight", id });
    if (!page.items.some((item) => item.id === id)) throw new SocialPlatformError("denied");
  }

  const snapIds = new Set(sources.filter(({ kind }) => kind === "snap").map(({ id }) => id));
  if (!snapIds.size) return;

  // Bound preflight reads even if the requested IDs are absent from a large profile.
  let remainingReads = 16;
  let storyCursor: string | undefined;
  do {
    const { page: stories } = await fetchSnapchatContent(http, actorId, token, {
      target: "story",
      cursor: storyCursor,
      limit: 10,
    });
    remainingReads--;
    for (const story of stories.items) {
      let snapCursor: string | undefined;
      while (remainingReads > 0) {
        const { page: snaps } = await fetchSnapchatContent(http, actorId, token, {
          target: "story",
          id: story.id,
          createdAt: story.createdAt,
          endedAt: story.endedAt,
          cursor: snapCursor,
          limit: 100,
        });
        remainingReads--;
        for (const snap of snaps.items) snapIds.delete(snap.id);
        if (!snapIds.size) return;
        if (!snaps.cursor || snaps.cursor === snapCursor) break;
        snapCursor = snaps.cursor;
      }
    }
    if (stories.cursor === storyCursor) break;
    storyCursor = stories.cursor;
  } while (storyCursor && remainingReads > 0);
  throw new SocialPlatformError("denied");
}

export async function listSnapchatContent(
  http: SocialHttp,
  account: SnapchatAccountIdentity,
  token: string,
  query: SnapchatContentQuery,
): Promise<SnapchatContentPage> {
  const actorId = accountProfileId(account);
  await verifySnapchatProfile(http, actorId, token);
  return (await fetchSnapchatContent(http, actorId, token, query)).page;
}

export async function deleteSnapchatContent(
  http: SocialHttp,
  account: SnapchatAccountIdentity,
  token: string,
  input: SnapchatDeleteInput,
  beforeSubmit?: () => Promise<void>,
): Promise<Pick<SnapchatDeleteInput, "id" | "target">> {
  const { target, id, confirmId } = input;
  if (target !== "spotlight" && target !== "saved_story")
    throw new SocialPlatformError("unsupported");
  const collection = getTarget(target);
  if (typeof id !== "string" || id !== confirmId || !collection.pattern.test(id))
    throw new SocialPlatformError("denied");
  const actorId = accountProfileId(account);
  await verifySnapchatProfile(http, actorId, token);
  await beforeSubmit?.();
  const { value } = await http.request(
    `${snapchatProfileUrl(actorId)}/${collection.collection}/${encodeURIComponent(id)}`,
    token,
    { method: "DELETE" },
  );
  if (value?.request_status !== "SUCCESS") throw new SocialPlatformError("unknown");
  return { id, target };
}

export async function findSnapchatStoryReceipt(
  http: SocialHttp,
  actorId: string,
  token: string,
  mediaId: string,
  exact?: { storyId?: string; snapId: string },
): Promise<{ storyId: string; storySnapId: string } | undefined> {
  const { page: stories } = await fetchSnapchatContent(http, actorId, token, {
    target: "story",
    limit: 3,
  });
  if (!exact && (stories.partial || stories.cursor)) return;
  const proven: { storyId: string; storySnapId: string }[] = [];
  for (const story of stories.items) {
    if (exact?.storyId && exact.storyId !== story.id) continue;
    const { page: snaps, matchedUploadIds } = await fetchSnapchatContent(http, actorId, token, {
      target: "story",
      id: story.id,
      createdAt: story.createdAt,
      endedAt: story.endedAt,
      limit: 20,
    });
    if (!exact && (snaps.partial || snaps.cursor)) return;
    // The documented POST returns only a request ID. An exact provider Snap ID or an
    // explicit upload correlation proves the publication. Timestamps and captions don't.
    const matched = snaps.items.filter((snap) =>
      exact ? snap.id === exact.snapId : matchedUploadIds.get(snap.id) === mediaId,
    );
    for (const snap of matched) proven.push({ storyId: story.id, storySnapId: snap.id });
  }
  if (proven.length === 1) return proven[0];
}
