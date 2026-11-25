import {
  SocialPlatformError,
  type SocialHttp,
  type SocialMedia,
  type SocialSendResult,
} from "../adapter";
import { facebookNumericId } from "./facebook-video";
import { uploadFacebookPhoto } from "../metaMedia";

export function storyPostId(value: unknown): string {
  const id = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== "string" || !/^[1-9]\d{0,24}(?:_[1-9]\d{0,24})?$/.test(id))
    throw new SocialPlatformError("unknown");
  return id;
}

export async function prepareFacebookStory(
  http: SocialHttp,
  endpoint: string,
  version: string,
  page: string,
  token: string,
  media: SocialMedia,
  read: (id: string) => Promise<Uint8Array>,
  beforeSubmit?: () => Promise<void>,
): Promise<string> {
  const actor = `${endpoint}/${page}`;
  if (media.kind === "image") {
    const id = await uploadFacebookPhoto(http, `${actor}/photos`, token, media, read, beforeSubmit);
    if (!facebookNumericId(id)) throw new SocialPlatformError("unknown");
    return id;
  }
  await beforeSubmit?.();
  const { value } = await http.json(`${actor}/video_stories`, token, { upload_phase: "start" });
  if (
    !facebookNumericId(value.video_id) ||
    value.upload_url !== `https://rupload.facebook.com/video-upload/${version}/${value.video_id}`
  )
    throw new SocialPlatformError("unknown");
  return value.video_id;
}

export async function submitFacebookStory(
  http: SocialHttp,
  actor: string,
  token: string,
  media: SocialMedia,
  mediaId: string,
): Promise<string> {
  const video = media.kind === "video";
  const { value } = await http.json(
    `${actor}/${video ? "video_stories" : "photo_stories"}`,
    token,
    video ? { video_id: mediaId, upload_phase: "finish" } : { photo_id: mediaId },
  );
  if (value.success !== true) throw new SocialPlatformError("unknown");
  return storyPostId(value.post_id);
}

/** A lost Story finish response can only be reconciled by its exact uploaded object. */
export async function confirmFacebookStory(
  http: SocialHttp,
  actor: string,
  token: string,
  media: SocialMedia,
  mediaId: string,
): Promise<SocialSendResult> {
  const { value } = await http.request(`${actor}/stories?limit=50`, token);
  if (!Array.isArray(value.data) || value.data.length > 50)
    throw new SocialPlatformError("unknown");
  const match = value.data.find(
    (story) =>
      story?.media_id === mediaId &&
      story?.media_type === (media.kind === "image" ? "photo" : "video") &&
      ["PUBLISHED", "ARCHIVED"].includes(story.status),
  );
  if (!match) throw new SocialPlatformError("unknown");
  return { platformId: storyPostId(match.post_id) };
}
