import type { SocialJob, SocialMedia } from "../../features/social/model/social";
import { SocialHttp, SocialPlatformError } from "./adapter";

export const X_VIDEO_LIMIT = 64 * 1024 * 1024;
export function xMediaFormat(bytes: Uint8Array): "png" | "jpg" | "mp4" {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
    bytes.length <= 5 * 1024 * 1024
  )
    return "png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.length <= 5 * 1024 * 1024
  )
    return "jpg";
  if (
    bytes.length >= 12 &&
    bytes.length <= X_VIDEO_LIMIT &&
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
  )
    return "mp4";
  throw new SocialPlatformError("rejected");
}
export function xMediaIssue(items: SocialMedia[], message = false): string | undefined {
  if (items.some((item) => !item.uploadId || item.url)) return "X requires host-uploaded media.";
  if (message && items.length > 1) return "X messages accept one media attachment.";
  if (items.length > 4 || (items.some((item) => item.kind === "video") && items.length !== 1))
    return "X accepts up to four images or one MP4 video, without mixing them.";
}
const mediaId = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{1,25}$/.test(value))
    throw new SocialPlatformError("unknown");
  return value;
};

/** Durable processing state prevents posting before video processing succeeds. */
export async function uploadXMedia(
  http: SocialHttp,
  job: SocialJob,
  token: string,
  read: (id: string) => Promise<Uint8Array>,
  message: boolean,
  checkpoint?: (state: NonNullable<SocialJob["preparation"]>) => void,
  now = Date.now,
): Promise<string[]> {
  if (xMediaIssue(job.payload.media, message)) throw new SocialPlatformError("unsupported");
  let state = { ...job.preparation };
  const save = () => {
    job.preparation = { ...state };
    checkpoint?.(job.preparation);
  };
  const ids = [...(state.mediaIds ?? [])];
  for (const item of job.payload.media.slice(ids.length)) {
    const bytes = await read(item.uploadId!);
    const format = xMediaFormat(bytes);
    if ((item.kind === "video") !== (format === "mp4")) throw new SocialPlatformError("rejected");
    if (format !== "mp4") {
      const form = new FormData();
      form.set(
        "media",
        new Blob([new Uint8Array(bytes)], { type: format === "png" ? "image/png" : "image/jpeg" }),
        `image.${format}`,
      );
      form.set("media_category", message ? "dm_image" : "tweet_image");
      const { value } = await http.request("https://api.x.com/2/media/upload", token, {
        method: "POST",
        body: form,
      });
      ids.push(mediaId(value.data?.id));
    } else {
      let processing: Record<string, any> | undefined;
      if (state.xVideo) {
        if (state.xVideo.expiresAt <= now()) throw new SocialPlatformError("rejected");
        const { value } = await http.request(
          `https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId(state.xVideo.id)}`,
          token,
        );
        processing = value.data?.processing_info;
        // A status response must explicitly establish successful processing.
        if (!processing) throw new SocialPlatformError("unknown");
      } else {
        const { value } = await http.json("https://api.x.com/2/media/upload/initialize", token, {
          media_type: "video/mp4",
          total_bytes: bytes.length,
          media_category: message ? "dm_video" : "tweet_video",
        });
        const id = mediaId(value.data?.id);
        const expiry = Number(value.data?.expires_after_secs);
        if (!Number.isFinite(expiry) || expiry <= 0) throw new SocialPlatformError("unknown");
        for (let offset = 0, index = 0; offset < bytes.length; offset += 4 * 1024 * 1024, index++) {
          const form = new FormData();
          form.set("segment_index", String(index));
          form.set(
            "media",
            new Blob([new Uint8Array(bytes.slice(offset, offset + 4 * 1024 * 1024))]),
            "segment.mp4",
          );
          await http.request(`https://api.x.com/2/media/upload/${id}/append`, token, {
            method: "POST",
            body: form,
          });
        }
        const finalized = await http.request(
          `https://api.x.com/2/media/upload/${id}/finalize`,
          token,
          { method: "POST" },
        );
        state.xVideo = { id, expiresAt: now() + expiry * 1000 };
        save();
        processing = finalized.value.data?.processing_info;
      }
      if (processing && processing.state !== "succeeded") {
        if (!["pending", "in_progress"].includes(processing.state))
          throw new SocialPlatformError("rejected");
        const delay = Number(processing.check_after_secs);
        throw new SocialPlatformError(
          "processing",
          now() + Math.max(1000, Math.min(60_000, Number.isFinite(delay) ? delay * 1000 : 5000)),
        );
      }
      ids.push(state.xVideo!.id);
    }
    state = { ...state, mediaIds: [...ids] };
    save();
  }
  if (state.xVideo && state.xVideo.expiresAt <= now()) throw new SocialPlatformError("rejected");
  return ids;
}
