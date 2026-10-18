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
  if (
    Object.keys(value).some((key) => !["privacy", "durationSeconds", ...flags].includes(key)) ||
    typeof value.privacy !== "string" ||
    (value.privacy !== "" && !(TIKTOK_PRIVACY as readonly string[]).includes(value.privacy)) ||
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    flags.some((key) => typeof value[key] !== "boolean")
  )
    throw new Error("Invalid TikTok video options.");
  return {
    privacy: value.privacy,
    durationSeconds: value.durationSeconds,
    ...Object.fromEntries(flags.map((key) => [key, value[key]])),
  } as TikTokVideoOptions;
}
export function tiktokContentIssue(job: Pick<SocialJob, "kind" | "payload">): string | undefined {
  const options = job.payload.tiktok;
  if (job.kind !== "publish")
    return "TikTok personal-account comments and DMs require a separate integration and eligible API access.";
  if (
    job.payload.media.length !== 1 ||
    job.payload.media[0].kind !== "video" ||
    !job.payload.media[0].url ||
    job.payload.media[0].uploadId
  )
    return "TikTok requires one HTTPS video URL on a TikTok-verified domain or URL prefix.";
  if (
    !options ||
    !(TIKTOK_PRIVACY as readonly string[]).includes(options.privacy) ||
    options.durationSeconds <= 0 ||
    !options.consent
  )
    return "Load current TikTok creator settings, preview the video, select visibility and confirm the Music Usage Confirmation before approval.";
  if (options.brandContent && options.privacy === "SELF_ONLY")
    return "TikTok branded content cannot use private visibility.";
  if ([job.payload.text, job.payload.link].filter(Boolean).join("\n").length > 2200)
    return "TikTok captions including links must fit 2200 UTF-16 characters.";
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
    async send(account, job, token, _media, checkpoint) {
      if (tiktokContentIssue(job)) throw new SocialPlatformError("unsupported");
      if (!job.preparation?.tiktokPublishId) {
        const info = await creatorInfo(account, token);
        const options = parseTikTokOptions(job.payload.tiktok);
        if (
          !info.privacyOptions.includes(options.privacy) ||
          options.durationSeconds > info.maxDurationSeconds ||
          (options.allowComment && info.commentDisabled) ||
          (options.allowDuet && info.duetDisabled) ||
          (options.allowStitch && info.stitchDisabled)
        )
          throw new SocialPlatformError("denied");
        const url = new URL(job.payload.media[0].url!);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new SocialPlatformError("denied");
        const { value } = await http.json(`${origin}post/publish/video/init/`, token, {
          post_info: {
            title: [job.payload.text, job.payload.link].filter(Boolean).join("\n"),
            privacy_level: options.privacy,
            disable_comment: !options.allowComment,
            disable_duet: !options.allowDuet,
            disable_stitch: !options.allowStitch,
            brand_content_toggle: options.brandContent,
            brand_organic_toggle: options.brandOrganic,
            is_aigc: options.isAigc,
          },
          source_info: { source: "PULL_FROM_URL", video_url: url.toString() },
        });
        const publishId = value.data?.publish_id;
        if (typeof publishId !== "string" || !publishId || publishId.length > 300)
          throw new SocialPlatformError("unknown");
        job.preparation = { ...job.preparation, tiktokPublishId: publishId };
        checkpoint?.(job.preparation);
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
