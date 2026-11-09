import {
  SocialPlatformError,
  type SocialAccount,
  type SocialJob,
  type SocialMedia,
} from "../adapter";

export const messageText = (job: Pick<SocialJob, "payload">) =>
  [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Shared preview/dispatch validation for the two API messaging adapters. */
export function messagingContentIssue(
  account: Pick<SocialAccount, "platform">,
  job: Pick<SocialJob, "payload" | "kind">,
): string | undefined {
  const message =
    job.kind === "message" ||
    (job.kind === "reply" && !!job.payload.recipientId && !job.payload.postId);
  if (!message || (account.platform === "whatsapp" && job.kind !== "reply"))
    return "This API supports existing Telegram bot chats or WhatsApp customer replies only.";
  const items = job.payload.media;
  if (items.length > 1) return "Messages accept one uploaded PNG/JPEG image or MP4 video.";
  if (
    items.some(
      (item) =>
        (item.kind !== "image" && item.kind !== "video") ||
        !item.uploadId ||
        item.url ||
        item.alt ||
        item.title,
    )
  )
    return "Messages require one host-uploaded PNG/JPEG image or MP4 video, without alternative text or a document title.";
  const text = messageText(job);
  if (!items.length && !text.trim()) return "Enter message text or attach an image or video.";
  if (text.length > (items.length ? 1024 : 4096))
    return items.length
      ? "Media captions including links must fit 1024 UTF-16 characters."
      : "Messages including links must fit 4096 UTF-16 characters.";
}

export function mediaFormat(
  item: SocialMedia,
  bytes: Uint8Array,
  platform: "telegram" | "whatsapp",
): { mime: "image/png" | "image/jpeg" | "video/mp4"; name: string } {
  const imageLimit = (platform === "telegram" ? 10 : 5) * 1024 * 1024;
  const videoLimit = (platform === "telegram" ? 50 : 16) * 1024 * 1024;
  if (item.kind === "image" && bytes.length <= imageLimit) {
    if (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    )
      return { mime: "image/png", name: "image.png" };
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      return { mime: "image/jpeg", name: "image.jpg" };
  }
  if (
    item.kind === "video" &&
    bytes.length >= 12 &&
    bytes.length <= videoLimit &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp"
  )
    return { mime: "video/mp4", name: "video.mp4" };
  throw new SocialPlatformError("rejected");
}
