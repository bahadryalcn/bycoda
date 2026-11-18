import { isoTimestamp } from "../../shared/lib/time/timestamps";
import { SocialPlatformError } from "./adapter";
import {
  addToYouTubePlaylist,
  readOwnedYouTubeChannel,
  setYouTubeThumbnail,
  type YouTubeManagementContext,
  type YouTubePage,
  youtubePageToken,
  youtubeResourceIdPattern,
  youtubeVideoIdPattern,
} from "./youtube-manage";

const endpoint = "https://www.googleapis.com/youtube/v3/";
const parts = "snippet,status";
const videoSnippetFields = ["categoryId", "defaultLanguage", "description", "tags", "title"];
const videoStatusFields = [
  "embeddable",
  "license",
  "privacyStatus",
  "publicStatsViewable",
  "publishAt",
  "selfDeclaredMadeForKids",
  "containsSyntheticMedia",
];

export type YouTubePrivacy = "private" | "unlisted" | "public";
export type YouTubeVideoPatch = {
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  privacy?: YouTubePrivacy;
  publishAt?: number | null;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
};
export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  categoryId?: string;
  tags: string[];
  privacy?: YouTubePrivacy;
  publishAt?: string;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
};
export type YouTubePlaylist = {
  id: string;
  title: string;
  description: string;
  privacy?: YouTubePrivacy;
};
export type YouTubePlaylistItem = { id: string; videoId: string; title: string; position?: number };
export type YouTubePlaylistPatch = {
  title?: string;
  description?: string;
  privacy?: YouTubePrivacy;
};

const isPrivacy = (value: unknown): value is YouTubePrivacy =>
  value === "public" || value === "unlisted" || value === "private";

const copyPresent = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );

function videoFromResource(resource: Record<string, any>): YouTubeVideo {
  const { id, snippet, status } = resource;
  return {
    id,
    title: typeof snippet?.title === "string" ? snippet.title : "",
    description: typeof snippet?.description === "string" ? snippet.description : "",
    categoryId: typeof snippet?.categoryId === "string" ? snippet.categoryId : undefined,
    tags: Array.isArray(snippet?.tags)
      ? snippet.tags.filter((tag: unknown): tag is string => typeof tag === "string")
      : [],
    privacy: isPrivacy(status?.privacyStatus) ? status.privacyStatus : undefined,
    publishAt: typeof status?.publishAt === "string" ? status.publishAt : undefined,
    madeForKids:
      typeof status?.selfDeclaredMadeForKids === "boolean"
        ? status.selfDeclaredMadeForKids
        : undefined,
    containsSyntheticMedia:
      typeof status?.containsSyntheticMedia === "boolean"
        ? status.containsSyntheticMedia
        : undefined,
  };
}

async function readOwnedVideo(
  { http, channelId, token, quota }: YouTubeManagementContext,
  id: string,
  part = parts,
): Promise<Record<string, any>> {
  if (!youtubeVideoIdPattern.test(id)) throw new SocialPlatformError("rejected");
  quota.charge("videos.list");
  const { value } = await http.request(
    `${endpoint}videos?${new URLSearchParams({ part, id })}`,
    token,
  );
  const video = value.items?.[0];
  if (video?.id !== id || video.snippet?.channelId !== channelId)
    throw new SocialPlatformError("denied");
  return video;
}

/** A page of uploads from the authenticated channel. Each page costs two or three shared units. */
export async function listYouTubeVideos(
  context: YouTubeManagementContext,
  pageToken?: string,
): Promise<YouTubePage<YouTubeVideo>> {
  const page = youtubePageToken(pageToken);
  const channel = await readOwnedYouTubeChannel(context, "id,contentDetails");
  const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (typeof playlistId !== "string" || !youtubeResourceIdPattern.test(playlistId))
    throw new SocialPlatformError("unknown");
  const { http, quota, token, channelId } = context;
  quota.charge("playlistItems.list");
  const { value } = await http.request(
    `${endpoint}playlistItems?${new URLSearchParams({ part: "contentDetails", playlistId, maxResults: "50", ...page })}`,
    token,
  );
  const ids: string[] = (value.items ?? [])
    .map((item: Record<string, any>) => item?.contentDetails?.videoId)
    .filter(
      (id: unknown): id is string => typeof id === "string" && youtubeVideoIdPattern.test(id),
    );
  const nextPageToken = typeof value.nextPageToken === "string" ? value.nextPageToken : undefined;
  if (!ids.length) return { items: [], nextPageToken };
  quota.charge("videos.list");
  const { value: videos } = await http.request(
    `${endpoint}videos?${new URLSearchParams({ part: parts, id: ids.join(",") })}`,
    token,
  );
  const owned = new Map<string, YouTubeVideo>();
  for (const video of videos.items ?? []) {
    if (video?.snippet?.channelId === channelId) owned.set(video.id, videoFromResource(video));
  }
  return {
    items: ids.flatMap((id) => {
      const video = owned.get(id);
      return video ? [video] : [];
    }),
    nextPageToken,
  };
}

/** Patches only requested parts and preserves the other writable fields within each part. */
export async function updateYouTubeVideo(
  context: YouTubeManagementContext,
  videoId: string,
  patch: YouTubeVideoPatch,
  now = Date.now(),
): Promise<YouTubeVideo> {
  const {
    title,
    description,
    categoryId,
    tags,
    privacy,
    publishAt,
    madeForKids,
    containsSyntheticMedia,
  } = patch;
  const updateSnippet = [title, description, categoryId, tags].some((value) => value !== undefined);
  const updateStatus = [privacy, publishAt, madeForKids, containsSyntheticMedia].some(
    (value) => value !== undefined,
  );
  if (
    (!updateSnippet && !updateStatus) ||
    (title !== undefined &&
      (typeof title !== "string" ||
        !title.trim() ||
        Array.from(title).length > 100 ||
        /[<>]/u.test(title))) ||
    (description !== undefined &&
      (typeof description !== "string" ||
        new TextEncoder().encode(description).length > 5000 ||
        /[<>]/u.test(description))) ||
    (categoryId !== undefined &&
      (typeof categoryId !== "string" || !/^\d{1,4}$/u.test(categoryId))) ||
    (tags !== undefined &&
      (!Array.isArray(tags) ||
        tags.some((tag) => typeof tag !== "string" || !tag.trim()) ||
        Array.from(tags.map((tag) => (tag.includes(" ") ? `"${tag}"` : tag)).join(",")).length >
          500)) ||
    (privacy !== undefined && !isPrivacy(privacy)) ||
    (publishAt !== undefined &&
      publishAt !== null &&
      (typeof publishAt !== "number" ||
        !Number.isFinite(publishAt) ||
        publishAt <= now ||
        (privacy !== undefined && privacy !== "private"))) ||
    (madeForKids !== undefined && typeof madeForKids !== "boolean") ||
    (containsSyntheticMedia !== undefined && typeof containsSyntheticMedia !== "boolean")
  )
    throw new SocialPlatformError("rejected");
  const previous = await readOwnedVideo(context, videoId);
  const data: Record<string, unknown> = { id: videoId };
  const selectedParts: string[] = [];
  if (updateSnippet) {
    const snippet = {
      ...copyPresent(previous.snippet, videoSnippetFields),
      ...copyPresent({ title, description, categoryId, tags }, videoSnippetFields),
    };
    if (!snippet.title || !snippet.categoryId) throw new SocialPlatformError("unknown");
    data.snippet = snippet;
    selectedParts.push("snippet");
  }
  if (updateStatus) {
    const status = {
      ...copyPresent(previous.status ?? {}, videoStatusFields),
      ...copyPresent(
        { privacyStatus: privacy, selfDeclaredMadeForKids: madeForKids, containsSyntheticMedia },
        videoStatusFields,
      ),
    };
    if (typeof publishAt === "number") {
      // YouTube only accepts publishAt for a private video that has never been published.
      const scheduled = isoTimestamp(publishAt);
      if (!scheduled || previous.status?.privacyStatus !== "private")
        throw new SocialPlatformError("rejected");
      status.privacyStatus = "private";
      status.publishAt = scheduled;
    } else if (publishAt === null || status.privacyStatus !== "private") {
      delete status.publishAt;
    } else if (typeof status.publishAt === "string" && !(Date.parse(status.publishAt) > now)) {
      // Resubmitting a past publishAt makes YouTube publish immediately.
      throw new SocialPlatformError("processing");
    }
    data.status = status;
    selectedParts.push("status");
  }
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("videos.update");
  const { value } = await http.request(
    `${endpoint}videos?${new URLSearchParams({ part: selectedParts.join(",") })}`,
    token,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  if (value.id !== videoId) throw new SocialPlatformError("unknown");
  return videoFromResource({ ...previous, ...value });
}

export async function deleteYouTubeVideo(
  context: YouTubeManagementContext,
  videoId: string,
  confirm: boolean,
): Promise<void> {
  if (confirm !== true) throw new SocialPlatformError("rejected");
  await readOwnedVideo(context, videoId, "snippet");
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("videos.delete");
  await http.request(`${endpoint}videos?${new URLSearchParams({ id: videoId })}`, token, {
    method: "DELETE",
  });
}

export async function setOwnedYouTubeThumbnail(
  context: YouTubeManagementContext,
  videoId: string,
  bytes: Uint8Array,
): Promise<void> {
  const video = await readOwnedVideo(context, videoId, "snippet,status,processingDetails");
  if (
    video.processingDetails?.processingStatus !== "succeeded" &&
    (video.processingDetails !== undefined || video.status?.uploadStatus !== "processed")
  )
    throw new SocialPlatformError("processing");
  await context.beforeWrite?.();
  await setYouTubeThumbnail(context.http, context.token, context.quota, videoId, bytes);
}

function playlistFromResource(resource: Record<string, any>): YouTubePlaylist {
  const { id, snippet, status } = resource;
  return {
    id,
    title: typeof snippet?.title === "string" ? snippet.title : "",
    description: typeof snippet?.description === "string" ? snippet.description : "",
    privacy: isPrivacy(status?.privacyStatus) ? status.privacyStatus : undefined,
  };
}

export async function listYouTubePlaylists(
  context: YouTubeManagementContext,
  pageToken?: string,
): Promise<YouTubePage<YouTubePlaylist>> {
  const page = youtubePageToken(pageToken);
  await readOwnedYouTubeChannel(context, "id");
  const { http, quota, token, channelId } = context;
  quota.charge("playlists.list");
  const { value } = await http.request(
    `${endpoint}playlists?${new URLSearchParams({ part: parts, mine: "true", maxResults: "50", ...page })}`,
    token,
  );
  return {
    items: (value.items ?? [])
      .filter(
        (item: Record<string, any>) =>
          item?.snippet?.channelId === channelId &&
          typeof item.id === "string" &&
          youtubeResourceIdPattern.test(item.id),
      )
      .map(playlistFromResource),
    nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
  };
}

export async function createYouTubePlaylist(
  context: YouTubeManagementContext,
  { title, description, privacy = "private" }: YouTubePlaylistPatch & { title: string },
): Promise<YouTubePlaylist> {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    (description !== undefined && typeof description !== "string") ||
    !isPrivacy(privacy)
  )
    throw new SocialPlatformError("rejected");
  await readOwnedYouTubeChannel(context, "id");
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("playlists.insert");
  const { value } = await http.json(
    `${endpoint}playlists?${new URLSearchParams({ part: parts })}`,
    token,
    {
      snippet: { title, description },
      status: { privacyStatus: privacy },
    },
  );
  if (typeof value.id !== "string" || !youtubeResourceIdPattern.test(value.id))
    throw new SocialPlatformError("unknown");
  return playlistFromResource(value);
}

export async function addOwnedYouTubePlaylistItem(
  context: YouTubeManagementContext,
  playlistId: string,
  videoId: string,
): Promise<string> {
  if (!youtubeVideoIdPattern.test(videoId)) throw new SocialPlatformError("rejected");
  await readOwnedPlaylist(context, playlistId);
  await context.beforeWrite?.();
  return addToYouTubePlaylist(context.http, context.token, context.quota, playlistId, videoId);
}

async function readOwnedPlaylist(
  { http, quota, token, channelId }: YouTubeManagementContext,
  playlistId: string,
): Promise<Record<string, any>> {
  if (!youtubeResourceIdPattern.test(playlistId)) throw new SocialPlatformError("rejected");
  quota.charge("playlists.list");
  const { value } = await http.request(
    `${endpoint}playlists?${new URLSearchParams({ part: parts, id: playlistId })}`,
    token,
  );
  const playlist = value.items?.[0];
  if (playlist?.id !== playlistId || playlist.snippet?.channelId !== channelId)
    throw new SocialPlatformError("denied");
  return playlist;
}

export async function updateYouTubePlaylist(
  context: YouTubeManagementContext,
  playlistId: string,
  { title, description, privacy }: YouTubePlaylistPatch,
): Promise<YouTubePlaylist> {
  if (
    (title === undefined && description === undefined && privacy === undefined) ||
    (title !== undefined && (typeof title !== "string" || !title.trim())) ||
    (description !== undefined && typeof description !== "string") ||
    (privacy !== undefined && !isPrivacy(privacy))
  )
    throw new SocialPlatformError("rejected");
  const playlist = await readOwnedPlaylist(context, playlistId);
  const snippet = copyPresent(playlist.snippet, ["title", "description", "defaultLanguage"]);
  if (title !== undefined) snippet.title = title;
  if (description !== undefined) snippet.description = description;
  if (typeof snippet.title !== "string" || !snippet.title) throw new SocialPlatformError("unknown");
  const data: Record<string, unknown> = { id: playlistId, snippet };
  const selectedParts = ["snippet"];
  if (privacy !== undefined) {
    data.status = {
      ...copyPresent(playlist.status ?? {}, ["podcastStatus"]),
      privacyStatus: privacy,
    };
    selectedParts.push("status");
  }
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("playlists.update");
  const { value } = await http.request(
    `${endpoint}playlists?${new URLSearchParams({ part: selectedParts.join(",") })}`,
    token,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  if (value.id !== playlistId) throw new SocialPlatformError("unknown");
  return playlistFromResource({ ...playlist, ...value });
}

export async function deleteYouTubePlaylist(
  context: YouTubeManagementContext,
  playlistId: string,
  confirm: boolean,
): Promise<void> {
  if (confirm !== true) throw new SocialPlatformError("rejected");
  await readOwnedPlaylist(context, playlistId);
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("playlists.delete");
  await http.request(`${endpoint}playlists?${new URLSearchParams({ id: playlistId })}`, token, {
    method: "DELETE",
  });
}

function playlistItemFromResource(item: Record<string, any>): YouTubePlaylistItem | undefined {
  const videoId = item.snippet?.resourceId?.videoId;
  if (typeof item.id !== "string" || !youtubeResourceIdPattern.test(item.id)) return undefined;
  if (typeof videoId !== "string" || !youtubeVideoIdPattern.test(videoId)) return undefined;
  return {
    id: item.id,
    videoId,
    title: typeof item.snippet?.title === "string" ? item.snippet.title : videoId,
    position: Number.isInteger(item.snippet?.position) ? item.snippet.position : undefined,
  };
}

export async function listYouTubePlaylistItems(
  context: YouTubeManagementContext,
  playlistId: string,
  pageToken?: string,
): Promise<YouTubePage<YouTubePlaylistItem>> {
  const page = youtubePageToken(pageToken);
  await readOwnedPlaylist(context, playlistId);
  const { http, quota, token } = context;
  quota.charge("playlistItems.list");
  const { value } = await http.request(
    `${endpoint}playlistItems?${new URLSearchParams({ part: "snippet", playlistId, maxResults: "50", ...page })}`,
    token,
  );
  const items: YouTubePlaylistItem[] = [];
  for (const item of value.items ?? []) {
    if (item?.snippet?.playlistId !== playlistId) continue;
    const parsed = playlistItemFromResource(item);
    if (parsed) items.push(parsed);
  }
  return {
    items,
    nextPageToken: typeof value.nextPageToken === "string" ? value.nextPageToken : undefined,
  };
}

async function readOwnedPlaylistItem(
  context: YouTubeManagementContext,
  playlistId: string,
  id: string,
): Promise<Record<string, any>> {
  if (!youtubeResourceIdPattern.test(id)) throw new SocialPlatformError("rejected");
  await readOwnedPlaylist(context, playlistId);
  const { http, quota, token } = context;
  quota.charge("playlistItems.list");
  const { value } = await http.request(
    `${endpoint}playlistItems?${new URLSearchParams({ part: "snippet", id })}`,
    token,
  );
  const item = value.items?.[0];
  if (item?.id !== id || item.snippet?.playlistId !== playlistId)
    throw new SocialPlatformError("denied");
  return item;
}

export async function removeYouTubePlaylistItem(
  context: YouTubeManagementContext,
  playlistId: string,
  playlistItemId: string,
  confirm: boolean,
): Promise<void> {
  if (confirm !== true) throw new SocialPlatformError("rejected");
  await readOwnedPlaylistItem(context, playlistId, playlistItemId);
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("playlistItems.delete");
  await http.request(
    `${endpoint}playlistItems?${new URLSearchParams({ id: playlistItemId })}`,
    token,
    { method: "DELETE" },
  );
}

export async function moveYouTubePlaylistItem(
  context: YouTubeManagementContext,
  playlistId: string,
  playlistItemId: string,
  position: number,
): Promise<YouTubePlaylistItem> {
  if (!Number.isSafeInteger(position) || position < 0) throw new SocialPlatformError("rejected");
  const item = await readOwnedPlaylistItem(context, playlistId, playlistItemId);
  const parsed = playlistItemFromResource(item);
  if (!parsed) throw new SocialPlatformError("unknown");
  if (parsed.position === position) return parsed;
  const { http, quota, token } = context;
  await context.beforeWrite?.();
  quota.charge("playlistItems.update");
  const { value } = await http.request(`${endpoint}playlistItems?part=snippet`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: playlistItemId,
      snippet: {
        playlistId,
        position,
        resourceId: { kind: "youtube#video", videoId: parsed.videoId },
      },
    }),
  });
  const updated = playlistItemFromResource(value);
  if (updated?.id !== playlistItemId) throw new SocialPlatformError("unknown");
  return updated;
}
