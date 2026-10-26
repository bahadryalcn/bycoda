import type {
  SocialAccount,
  SocialJob,
  SocialOperation,
  SocialPlatform,
} from "../../features/social/model/social";

/** These are web-adapter contracts, independent of official API product scopes. */
export const BROWSER_PLATFORM_OPERATIONS: Record<
  Exclude<SocialPlatform, "x">,
  readonly SocialOperation[]
> = {
  instagram: [
    "publish",
    "media",
    "comments.read",
    "reply",
    "comment",
    "inbox.read",
    "message.reply",
    "poll",
  ],
  facebook: [
    "publish",
    "media",
    "comments.read",
    "reply",
    "comment",
    "inbox.read",
    "message.reply",
    "poll",
  ],
  linkedin: [
    "publish",
    "media",
    "comments.read",
    "reply",
    "comment",
    "inbox.read",
    "message.reply",
    "message.start",
    "poll",
  ],
  youtube: ["publish", "media", "comments.read", "reply", "comment", "poll"],
  tiktok: ["publish", "media", "comments.read", "reply", "comment", "poll"],
  snapchat: ["publish", "media", "inbox.read", "message.reply", "poll"],
  whatsapp: ["inbox.read", "message.reply", "message.start", "poll", "media"],
  telegram: ["inbox.read", "message.reply", "message.start", "poll", "media"],
};

export function browserScopes(platform: Exclude<SocialPlatform, "x">): string[] {
  return BROWSER_PLATFORM_OPERATIONS[platform].map((operation) => `browser:${operation}`);
}

export function browserOperations(
  account: Pick<SocialAccount, "platform" | "accountType">,
): readonly SocialOperation[] {
  if (account.platform === "x") return [];
  const operations = BROWSER_PLATFORM_OPERATIONS[account.platform];
  if (account.platform === "snapchat")
    return operations.filter((operation) =>
      account.accountType === "public_profile"
        ? operation === "publish" || operation === "media"
        : account.accountType === "member" &&
          ["inbox.read", "message.reply", "poll"].includes(operation),
    );
  return account.platform === "linkedin" && account.accountType === "organization"
    ? operations.filter(
        (operation) => !["inbox.read", "message.reply", "message.start"].includes(operation),
      )
    : operations;
}

export function browserJobOperation(job: Pick<SocialJob, "kind" | "payload">): SocialOperation {
  if (job.kind === "message") return "message.start";
  if (job.kind === "reply" && !job.payload.postId) return "message.reply";
  return job.kind;
}

/** Browser attachments are owner-uploaded bytes; arbitrary remote downloads are never performed. */
export function browserContentIssue(
  account: SocialAccount,
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  if (account.platform === "x") return undefined;
  const operations = browserOperations(account);
  if (!operations.includes(browserJobOperation(job)))
    return "This operation is unavailable in this platform's browser connection.";
  const media = job.payload.media;
  if (media.some((item) => item.kind === "document")) {
    if (
      account.platform !== "linkedin" ||
      job.kind !== "publish" ||
      media.length !== 1 ||
      media[0].kind !== "document" ||
      !media[0].uploadId ||
      media[0].url ||
      !media[0].title?.trim() ||
      media[0].title.length > 58 ||
      media[0].alt
    )
      return "Document publishing requires LinkedIn browser mode, one uploaded PDF and a title up to 58 characters.";
    return undefined;
  }
  if (
    account.platform === "linkedin" &&
    media.some((item) => item.alt?.trim()) &&
    media.length !== 1
  )
    return "LinkedIn browser alternative text currently requires one uploaded image.";
  if (
    ["instagram", "facebook"].includes(account.platform) &&
    job.kind !== "publish" &&
    media.length
  )
    return "This browser recipe supports media publishing and text-only conversation replies.";
  if (
    ["linkedin", "youtube", "tiktok", "snapchat"].includes(account.platform) &&
    job.kind !== "publish" &&
    media.length
  )
    return "This browser conversation supports text only.";
  if (
    account.platform === "snapchat" &&
    job.kind === "publish" &&
    (media.length !== 1 || media[0].kind !== "video")
  )
    return "Snapchat Spotlight requires one uploaded video and previously accepted creator terms in the browser.";
  if (account.platform === "snapchat" && job.kind === "publish") {
    const options = job.payload.snapchat;
    if (options || /^web:snapchat:public_profile:[a-f\d-]{36}$/i.test(account.platformId)) {
      if (
        !options ||
        !["spotlight", "story"].includes(options.target) ||
        ![options.durationSeconds, options.width, options.height].every(Number.isFinite) ||
        options.durationSeconds < 5 ||
        options.durationSeconds > 60 ||
        options.width < 540 ||
        options.height < 960
      )
        return "Choose Story or Spotlight and a 5–60 second MP4 of at least 540 × 960 pixels.";
      if (options.target === "story" && (job.payload.text.trim() || job.payload.link))
        return "Snapchat Public Story uploads do not support a caption or link. Clear these fields before approval.";
      if (options.target === "spotlight" && job.payload.text.length > 160)
        return "Snapchat Spotlight descriptions must fit 160 characters.";
    }
  }
  if (["whatsapp", "telegram", "snapchat"].includes(account.platform) && media.length > 1)
    return "This browser conversation supports one uploaded attachment per message.";
  if (media.length && !operations.includes("media"))
    return "Attachments are unavailable in this browser connection.";
  if (media.some((item) => !item.uploadId || item.url))
    return "Browser attachments require an owner-uploaded file.";
  if (media.length > 4 || (media.some((item) => item.kind === "video") && media.length !== 1))
    return "Use up to four images or one video in a browser operation.";
  if (account.platform === "instagram" && job.kind === "publish" && !media.length)
    return "Instagram publishing requires an uploaded image or video.";
  if (["youtube", "tiktok"].includes(account.platform) && job.kind === "publish") {
    if (account.platform === "tiktok" && job.payload.tiktok?.mediaType === "photo")
      return "TikTok browser publishing currently supports video only. Photo publishing requires the API connection.";
    if (media.length !== 1 || media[0].kind !== "video")
      return "This publishing screen requires one uploaded video.";
    if (account.platform === "youtube") {
      const options = job.payload.youtube;
      if (
        !options?.title.trim() ||
        options.title.length > 100 ||
        /[<>]/.test(options.title) ||
        !["private", "unlisted", "public"].includes(options.privacy) ||
        typeof options.madeForKids !== "boolean" ||
        typeof options.containsSyntheticMedia !== "boolean"
      )
        return "Set the video's title, visibility and audience/synthetic-media declarations.";
      const description = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
      if (/[<>]/.test(description) || new TextEncoder().encode(description).length > 5000)
        return "YouTube descriptions must fit 5000 UTF-8 bytes and cannot contain angle brackets.";
    } else {
      const options = job.payload.tiktok;
      if (
        !options ||
        ![
          "PUBLIC_TO_EVERYONE",
          "MUTUAL_FOLLOW_FRIENDS",
          "FOLLOWER_OF_CREATOR",
          "SELF_ONLY",
        ].includes(options.privacy) ||
        !options.consent ||
        !Number.isFinite(options.durationSeconds) ||
        options.durationSeconds <= 0 ||
        [
          options.allowComment,
          options.allowDuet,
          options.allowStitch,
          options.brandContent,
          options.brandOrganic,
          options.isAigc,
        ].some((value) => typeof value !== "boolean")
      )
        return "Choose TikTok visibility and explicit content/music consent before publishing.";
    }
  }
  return undefined;
}
