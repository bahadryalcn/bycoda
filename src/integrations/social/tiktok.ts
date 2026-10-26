import type {
  SocialAccount,
  SocialJob,
  TikTokVideoOptions,
  TikTokCreatorInfo,
} from "../../features/social/model/social";
import {
  SocialHttp,
  SocialPlatformError,
  type SocialAdapter,
  type SocialSendResult,
} from "./adapter";

const origin = "https://open.tiktokapis.com/v2/";
export const TIKTOK_PRIVACY = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
const flags = [
  "allowComment",
  "allowDuet",
  "allowStitch",
  "brandContent",
  "brandOrganic",
  "isAigc",
  "consent",
] as const;
export function parseTikTokOptions(raw: unknown): TikTokVideoOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid TikTok video options.");
  const value = raw as Record<string, unknown>;
  const photo = value.mediaType === "photo";
  const durationSeconds = photo && value.durationSeconds === undefined ? 0 : value.durationSeconds;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "privacy",
          "durationSeconds",
          "mediaType",
          "photoTitle",
          "photoCoverIndex",
          "autoAddMusic",
          ...flags,
        ].includes(key),
    ) ||
    (value.mediaType !== undefined && !["video", "photo"].includes(String(value.mediaType))) ||
    typeof value.privacy !== "string" ||
    (value.privacy !== "" && !(TIKTOK_PRIVACY as readonly string[]).includes(value.privacy)) ||
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    flags.some(
      (key) =>
        !(photo && ["allowDuet", "allowStitch"].includes(key) && value[key] === undefined) &&
        typeof value[key] !== "boolean",
    ) ||
    (value.photoTitle !== undefined &&
      (typeof value.photoTitle !== "string" || value.photoTitle.length > 90)) ||
    (value.photoCoverIndex !== undefined &&
      (!Number.isInteger(value.photoCoverIndex) || Number(value.photoCoverIndex) < 0)) ||
    (value.autoAddMusic !== undefined && typeof value.autoAddMusic !== "boolean") ||
    (photo && (value.photoCoverIndex === undefined || value.autoAddMusic === undefined))
  )
    throw new Error("Invalid TikTok publishing options.");
  return {
    privacy: value.privacy,
    durationSeconds,
    ...Object.fromEntries(flags.map((key) => [key, value[key] ?? false])),
    ...(value.mediaType !== undefined ? { mediaType: value.mediaType } : {}),
    ...(value.photoTitle !== undefined ? { photoTitle: value.photoTitle } : {}),
    ...(value.photoCoverIndex !== undefined ? { photoCoverIndex: value.photoCoverIndex } : {}),
    ...(value.autoAddMusic !== undefined ? { autoAddMusic: value.autoAddMusic } : {}),
  } as TikTokVideoOptions;
}
export function tiktokContentIssue(job: Pick<SocialJob, "kind" | "payload">): string | undefined {
  if (job.kind !== "publish")
    return "TikTok personal-account comments and DMs require a separate integration and eligible API access.";
  let options: TikTokVideoOptions;
  try {
    options = parseTikTokOptions(job.payload.tiktok);
  } catch {
    return "Set valid TikTok publishing options before approval.";
  }
  const photo = options.mediaType === "photo";
  const media = job.payload.media;
  if (photo) {
    if (
      !media.length ||
      media.length > 4 ||
      media.some((item) => item.kind !== "image") ||
      options.photoCoverIndex! >= media.length ||
      options.allowDuet ||
      options.allowStitch
    )
      return "TikTok photo publishing requires one to four images, a selected cover and no Duet or Stitch.";
  } else if (media.length !== 1 || media[0].kind !== "video")
    return "TikTok video publishing requires one HTTPS video URL.";
  if (
    media.some((item) => {
      if (!item.url || item.uploadId) return true;
      try {
        const url = new URL(item.url);
        return url.protocol !== "https:" || !!url.username || !!url.password;
      } catch {
        return true;
      }
    })
  )
    return "TikTok requires HTTPS media URLs on a TikTok-verified domain or URL prefix.";
  if (
    !(TIKTOK_PRIVACY as readonly string[]).includes(options.privacy) ||
    (!photo && options.durationSeconds <= 0) ||
    !options.consent
  )
    return "Load current TikTok creator settings, preview the media, select visibility and confirm the Music Usage Confirmation before approval.";
  if (options.brandContent && options.privacy === "SELF_ONLY")
    return "TikTok branded content cannot use private visibility.";
  const limit = photo ? 4000 : 2200;
  if ([job.payload.text, job.payload.link].filter(Boolean).join("\n").length > limit)
    return `TikTok captions including links must fit ${limit} UTF-16 characters.`;
  return undefined;
}

export function createTikTokAdapter(http: SocialHttp, now = Date.now): SocialAdapter {
  async function creatorInfo(account: SocialAccount, token: string): Promise<TikTokCreatorInfo> {
    const { value: identity } = await http.request(
      `${origin}user/info/?fields=open_id,display_name`,
      token,
    );
    if (identity.data?.user?.open_id !== account.platformId)
      throw new SocialPlatformError("denied");
    const { value } = await http.json(`${origin}post/publish/creator_info/query/`, token, {});
    const info = value.data;
    if (
      !info ||
      typeof info.creator_nickname !== "string" ||
      !Array.isArray(info.privacy_level_options) ||
      !info.privacy_level_options.length ||
      info.privacy_level_options.some(
        (level: unknown) => !(TIKTOK_PRIVACY as readonly unknown[]).includes(level),
      ) ||
      !Number.isFinite(info.max_video_post_duration_sec) ||
      info.max_video_post_duration_sec <= 0 ||
      ["comment_disabled", "duet_disabled", "stitch_disabled"].some(
        (key) => typeof info[key] !== "boolean",
      )
    )
      throw new SocialPlatformError("rejected");
    return {
      nickname: info.creator_nickname,
      privacyOptions: info.privacy_level_options,
      commentDisabled: info.comment_disabled,
      duetDisabled: info.duet_disabled,
      stitchDisabled: info.stitch_disabled,
      maxDurationSeconds: info.max_video_post_duration_sec,
    };
  }
  async function status(job: SocialJob, token: string): Promise<SocialSendResult | undefined> {
    const publishId = job.preparation?.tiktokPublishId;
    if (!publishId) return undefined;
    const { value } = await http.json(`${origin}post/publish/status/fetch/`, token, {
      publish_id: publishId,
    });
    if (value.data?.status === "FAILED") throw new SocialPlatformError("rejected");
    if (value.data?.status !== "PUBLISH_COMPLETE") return undefined;
    // Private posts do not return a public video ID. The durable publish ID confirms completion.
    const publicId = value.data.publicaly_available_post_id?.[0];
    return {
      platformId: typeof publicId === "string" && /^\d+$/.test(publicId) ? publicId : publishId,
      visibility:
        job.payload.tiktok?.privacy === "SELF_ONLY"
          ? "private"
          : job.payload.tiktok?.privacy === "PUBLIC_TO_EVERYONE"
            ? "public"
            : undefined,
    };
  }
  return {
    creatorInfo,
    async send(account, job, token, _media, checkpoint, beforeSubmit) {
      if (tiktokContentIssue(job)) throw new SocialPlatformError("unsupported");
      if (!job.preparation?.tiktokPublishId) {
        const info = await creatorInfo(account, token);
        const options = parseTikTokOptions(job.payload.tiktok);
        const photo = options.mediaType === "photo";
        if (
          !info.privacyOptions.includes(options.privacy) ||
          (!photo && options.durationSeconds > info.maxDurationSeconds) ||
          (options.allowComment && info.commentDisabled) ||
          (options.allowDuet && info.duetDisabled) ||
          (options.allowStitch && info.stitchDisabled)
        )
          throw new SocialPlatformError("denied");
        const description = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
        const common = {
          privacy_level: options.privacy,
          disable_comment: !options.allowComment,
          brand_content_toggle: options.brandContent,
          brand_organic_toggle: options.brandOrganic,
        };
        const body = photo
          ? {
              post_info: {
                ...common,
                title: options.photoTitle ?? "",
                description,
                auto_add_music: options.autoAddMusic,
              },
              source_info: {
                source: "PULL_FROM_URL",
                photo_images: job.payload.media.map((item) => new URL(item.url!).toString()),
                photo_cover_index: options.photoCoverIndex,
              },
              media_type: "PHOTO",
              post_mode: "DIRECT_POST",
              is_aigc: options.isAigc,
            }
          : {
              post_info: {
                ...common,
                title: description,
                disable_duet: !options.allowDuet,
                disable_stitch: !options.allowStitch,
                is_aigc: options.isAigc,
              },
              source_info: {
                source: "PULL_FROM_URL",
                video_url: new URL(job.payload.media[0].url!).toString(),
              },
            };
        await beforeSubmit?.();
        const { value } = await http.json(
          `${origin}post/publish/${photo ? "content" : "video"}/init/`,
          token,
          body,
        );
        const publishId = value.data?.publish_id;
        if (typeof publishId !== "string" || !publishId || publishId.length > 64)
          throw new SocialPlatformError("unknown");
        job.preparation = { ...job.preparation, tiktokPublishId: publishId };
        await checkpoint?.(job.preparation);
      }
      const result = await status(job, token);
      if (!result) throw new SocialPlatformError("processing", now() + 30_000);
      return result;
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
    reconcile: (_account, job, token) => status(job, token),
  };
}
