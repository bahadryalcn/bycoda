import {
  SocialPlatformError,
  type SocialHttp,
  type SocialJob,
  type SocialSendResult,
} from "../adapter";
import { facebookScheduleTime } from "./facebook-schedule";

export function facebookNumericId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,24}$/.test(value);
}

export function facebookHttpsMedia(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4000) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

export async function readFacebookVideo(
  uploadId: string,
  read: (id: string) => Promise<Uint8Array>,
) {
  const bytes = await read(uploadId);
  if (
    bytes.length < 12 ||
    bytes.length > 64 * 1024 * 1024 ||
    new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp"
  )
    throw new SocialPlatformError("unsupported");
  return bytes;
}

export async function submitFacebookVideo(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
  payload: SocialJob["payload"],
  bytes: Uint8Array | undefined,
  now: number,
): Promise<string> {
  const media = payload.media[0];
  const form = new FormData();
  if (bytes)
    form.set("source", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), "video.mp4");
  else form.set("file_url", media.url!);
  if (media.title) form.set("title", media.title);
  form.set("description", [payload.text, payload.link].filter(Boolean).join("\n"));
  if (payload.facebook?.target === "video" && payload.facebook.scheduledPublishAt !== undefined) {
    const scheduled = facebookScheduleTime(payload.facebook.scheduledPublishAt, now);
    if (scheduled === undefined) throw new SocialPlatformError("rejected");
    form.set("published", "false");
    form.set("scheduled_publish_time", String(scheduled));
    form.set("unpublished_content_type", "SCHEDULED");
  }
  const { value } = await http.request(
    `https://graph-video.facebook.com/${graphVersion}/${pageId}/videos`,
    token,
    {
      method: "POST",
      body: form,
    },
  );
  if (!facebookNumericId(value.id)) throw new SocialPlatformError("unknown");
  return value.id;
}

export async function confirmFacebookVideo(
  http: SocialHttp,
  endpoint: string,
  pageId: string,
  token: string,
  videoId: string,
  scheduledAt: number | undefined,
  now: number,
): Promise<SocialSendResult> {
  const { value } = await http.request(
    `${endpoint}/${videoId}?fields=id,from,published,status`,
    token,
  );
  if (value.id !== videoId || value.from?.id !== pageId) throw new SocialPlatformError("unknown");
  const status = value.status;
  const phases = [status?.uploading_phase, status?.processing_phase, status?.publishing_phase];
  if (
    ["error", "expired"].includes(status?.video_status) ||
    phases.some((phase) => phase?.status === "error" || phase?.error || phase?.errors?.length)
  )
    throw new SocialPlatformError("rejected");
  if (status?.video_status === "ready" && value.published === true)
    return { platformId: videoId, url: `https://www.facebook.com/watch/?v=${videoId}` };
  if (
    scheduledAt !== undefined &&
    value.published === false &&
    status?.video_status === "ready" &&
    Number(status?.publishing_phase?.publish_time) === Math.floor(scheduledAt / 1000)
  )
    return { platformId: videoId };
  if (["processing", "ready", "uploading", "upload_complete"].includes(status?.video_status))
    throw new SocialPlatformError("processing", now + 60_000);
  throw new SocialPlatformError("unknown");
}
