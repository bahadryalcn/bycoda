import {
  SocialPlatformError,
  type SocialAccount,
  type SocialHttp,
  type SocialJob,
  type SocialSendResult,
} from "../adapter";
import { id, requireId, text } from "./common";

export function instagramMessageContentIssue(
  job: Pick<SocialJob, "kind" | "payload">,
): string | undefined {
  const { media, recipientId, postId } = job.payload;
  if (
    job.kind !== "reply" ||
    !recipientId ||
    postId ||
    media.length !== 1 ||
    !["image", "video"].includes(media[0].kind) ||
    !media[0].url ||
    media[0].uploadId ||
    job.payload.text.trim() ||
    job.payload.link
  )
    return "Choose one HTTPS image or video in an existing Instagram DM. Send text separately.";
  try {
    const url = new URL(media[0].url);
    if (url.protocol === "https:" && !url.username && !url.password) return undefined;
  } catch {
    // A malformed URL is rejected before the request.
  }
  return "Choose an HTTPS attachment URL without credentials.";
}

export async function sendInstagramMessage(
  http: SocialHttp,
  endpoint: string,
  account: SocialAccount,
  job: SocialJob,
  token: string,
  beforeSubmit?: () => Promise<void>,
): Promise<SocialSendResult> {
  const { instagramPrivateReply, media, recipientId, replyUntil } = job.payload;
  const deadline = instagramPrivateReply?.until ?? replyUntil;
  if (deadline === undefined || Date.now() >= deadline)
    throw new SocialPlatformError("rejected", undefined, { reasonCode: "meta.window_closed" });
  const recipient = instagramPrivateReply
    ? { comment_id: instagramPrivateReply.commentId }
    : { id: recipientId };
  id(instagramPrivateReply?.commentId ?? recipientId);
  if (media.length && instagramMessageContentIssue(job))
    throw new SocialPlatformError("unsupported");
  const message = media.length
    ? { attachment: { type: media[0].kind, payload: { url: media[0].url } } }
    : { text: text(job) };
  await beforeSubmit?.();
  const { value } = await http.json(`${endpoint}/${id(account.platformId)}/messages`, token, {
    recipient,
    message,
  });
  return { platformId: requireId(value.message_id) };
}
