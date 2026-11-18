export const INSTAGRAM_CAROUSEL_MAX = 20;

type InstagramUserTag = {
  username: string;
  x?: number;
  y?: number;
  mediaIndex?: number;
};

export type InstagramPublishOptions = {
  format?: "story";
  userTags?: InstagramUserTag[];
  collaborators?: string[];
  locationId?: string;
  isAiGenerated?: boolean;
};

type PublishMedia = { kind: string; alt?: string };

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid Instagram publishing options.");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown Instagram publishing option.");
  return value;
}

function username(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-z0-9._]{1,30}$/i.test(raw))
    throw new Error("Enter a valid Instagram username without @.");
  return raw.toLowerCase();
}

function coordinates(raw: unknown): number | undefined {
  if (raw === undefined) return;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1)
    throw new Error("Instagram tag coordinates must be between 0 and 1.");
  return raw;
}

export function parseInstagramPublishOptions(raw: unknown): InstagramPublishOptions {
  const value = record(raw, ["format", "userTags", "collaborators", "locationId", "isAiGenerated"]);
  const { format, userTags, collaborators, locationId, isAiGenerated } = value;
  if (format !== undefined && format !== "story") throw new Error("Invalid Instagram format.");
  if (
    locationId !== undefined &&
    (typeof locationId !== "string" || !/^\d{1,30}$/.test(locationId))
  )
    throw new Error("Instagram locations need a numeric Meta Page ID.");
  if (isAiGenerated !== undefined && typeof isAiGenerated !== "boolean")
    throw new Error("Instagram AI disclosure must be true or false.");
  if (collaborators !== undefined && (!Array.isArray(collaborators) || collaborators.length > 3))
    throw new Error("Instagram supports up to three collaborators.");
  if (userTags !== undefined && (!Array.isArray(userTags) || userTags.length > 20))
    throw new Error("Use up to 20 Instagram user tags.");
  return {
    ...(format ? { format } : {}),
    ...(collaborators?.length ? { collaborators: collaborators.map(username) } : {}),
    ...(userTags?.length
      ? {
          userTags: userTags.map((rawTag) => {
            const tag = record(rawTag, ["username", "x", "y", "mediaIndex"]);
            const name = username(tag.username);
            const x = coordinates(tag.x);
            const y = coordinates(tag.y);
            const { mediaIndex } = tag;
            if (
              mediaIndex !== undefined &&
              (typeof mediaIndex !== "number" || !Number.isInteger(mediaIndex) || mediaIndex < 0)
            )
              throw new Error("Instagram tags need a valid media index.");
            return {
              username: name,
              ...(x !== undefined ? { x } : {}),
              ...(y !== undefined ? { y } : {}),
              ...(mediaIndex !== undefined ? { mediaIndex } : {}),
            };
          }),
        }
      : {}),
    ...(locationId !== undefined ? { locationId } : {}),
    ...(isAiGenerated !== undefined ? { isAiGenerated } : {}),
  };
}

export function instagramPublishOptionsIssue(
  options: InstagramPublishOptions | undefined,
  media: readonly PublishMedia[],
  caption: string,
): string | undefined {
  if (options === undefined) return;
  try {
    options = parseInstagramPublishOptions(options);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid Instagram publishing options.";
  }
  const story = options.format === "story";
  if (story) {
    if (media.length !== 1) return "An Instagram Story requires one image or video.";
    if (caption.trim() || media[0].alt || options.collaborators?.length || options.locationId)
      return "Instagram Stories do not support captions, links, alt text, collaborators or locations.";
  }
  for (const tag of options.userTags ?? []) {
    if (media.length > 1 && tag.mediaIndex === undefined)
      return "Every Instagram carousel tag needs a media index.";
    const item = media[tag.mediaIndex ?? 0];
    if (!item) return "The Instagram tag points to a missing media item.";
    if (!story && item.kind === "image" && (tag.x === undefined || tag.y === undefined))
      return "Instagram image tags require both coordinates.";
    if (!story && item.kind === "video" && (tag.x !== undefined || tag.y !== undefined))
      return "Instagram video tags do not support coordinates.";
  }
}

export function instagramStoryAccountIssue(
  options: InstagramPublishOptions | undefined,
  accountType: string | undefined,
): string | undefined {
  if (options?.format === "story" && accountType && accountType !== "BUSINESS")
    return "Instagram Story publishing requires a Business account.";
}

export function instagramPostFields(options: InstagramPublishOptions | undefined) {
  return {
    ...(options?.collaborators?.length ? { collaborators: options.collaborators } : {}),
    ...(options?.locationId ? { location_id: options.locationId } : {}),
    ...(options?.isAiGenerated !== undefined ? { is_ai_generated: options.isAiGenerated } : {}),
  };
}

export function instagramTagFields(options: InstagramPublishOptions | undefined, index: number) {
  const tags = options?.userTags
    ?.filter((tag) => (tag.mediaIndex ?? 0) === index)
    .map(({ username, x, y }) => ({ username, x, y }));
  return tags?.length ? { user_tags: tags } : {};
}
