import type { SocialAccount, SocialJob } from "./adapter";
import { browserContentIssue } from "./browserCapabilities";
import { facebookReelContentIssue } from "./facebookReels";
import { messagingContentIssue } from "./adapters/messaging-shared";
import { linkedInMultiImageIssue } from "./linkedinMedia";
import { metaPublishingIssue } from "./metaMedia";
import { snapchatContentIssue } from "./snapchat";
import { telegramChannelContentIssue } from "./telegramChannel";
import { tiktokContentIssue } from "./tiktok";
import { xMediaIssue } from "./xMedia";

export function contentSupport(
  account: SocialAccount,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  if (job.payload.facebook && (account.platform !== "facebook" || account.connection === "browser"))
    return "The Facebook Reel destination requires a Facebook Page API connection.";
  if (account.connection === "browser" && account.platform !== "x")
    return browserContentIssue(account, job);
  if (account.platform === "telegram" && account.accountType === "channel")
    return telegramChannelContentIssue(account, job);
  if (account.platform === "facebook" && job.payload.facebook)
    return facebookReelContentIssue(account, job);
  if (job.payload.media.some((item) => item.kind === "document"))
    return "PDF document publishing requires a LinkedIn browser connection.";
  if (account.platform === "tiktok") return tiktokContentIssue(job);
  if (account.platform === "snapchat") return snapchatContentIssue(account, job);
  if (account.platform === "whatsapp" || account.platform === "telegram")
    return messagingContentIssue(account, job);
  if (account.platform === "x") {
    const message =
      job.kind === "message" ||
      (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
    if (message && account.connection === "browser" && job.payload.media.length)
      return "Browser DM media attachments are unavailable; use the X API connection.";
    return xMediaIssue(job.payload.media, message);
  }
  if (job.kind !== "publish" && job.payload.media.length)
    return "Reply/message media attachments are not supported yet.";
  if (account.platform === "linkedin" && job.payload.media.length > 1)
    return linkedInMultiImageIssue(account, job);
  if (job.kind === "publish" && ["instagram", "facebook"].includes(account.platform))
    return metaPublishingIssue(account.platform as "instagram" | "facebook", job);
  if (account.platform === "youtube" && job.kind === "publish") {
    const options = job.payload.youtube;
    if (
      job.payload.media.length !== 1 ||
      job.payload.media[0].kind !== "video" ||
      !job.payload.media[0].uploadId ||
      job.payload.media[0].url
    )
      return "YouTube requires one host-uploaded MP4/WebM video up to 64 MiB. Text-only Community posts are not supported.";
    if (
      !options?.title?.trim() ||
      options.title.length > 100 ||
      /[<>]/.test(options.title) ||
      !["private", "unlisted", "public"].includes(options.privacy) ||
      typeof options.madeForKids !== "boolean" ||
      typeof options.containsSyntheticMedia !== "boolean"
    )
      return "Set a valid YouTube title, visibility and explicit audience/synthetic-media declarations.";
    const description = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
    if (/[<>]/.test(description)) return "YouTube descriptions cannot contain < or > characters.";
    if (new TextEncoder().encode(description).length > 5000)
      return "YouTube description including links must fit 5000 UTF-8 bytes.";
    return undefined;
  }
  if (job.payload.media.some((item) => item.kind === "video"))
    return "Video upload/processing is not implemented; use an image or text.";
  if (
    account.platform === "linkedin" &&
    job.payload.media.length &&
    (account.accountType !== "organization" ||
      job.payload.media.length !== 1 ||
      !job.payload.media[0].uploadId)
  )
    return "LinkedIn image publishing requires an organization, one uploaded image and image-readiness permission. Member write-only tokens cannot verify Images API readiness.";
  return undefined;
}
