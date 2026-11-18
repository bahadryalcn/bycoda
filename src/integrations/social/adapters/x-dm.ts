import { SocialPlatformError, type SocialJob, type SocialSendResult } from "../adapter";
import { id, requireId, text } from "./common";

export function xDmRequest(job: SocialJob) {
  const { threadId, recipientId, media } = job.payload;
  const message = text(job);
  if (!message.trim() && !media.length) throw new SocialPlatformError("rejected");
  // Conversation IDs are opaque, while the one-to-one creation endpoint requires a numeric user ID.
  if (!threadId && (typeof recipientId !== "string" || !/^\d{1,19}$/.test(recipientId)))
    throw new SocialPlatformError("rejected");
  const target = threadId ? id(threadId) : `with/${id(recipientId)}`;
  return { url: `https://api.x.com/2/dm_conversations/${target}/messages`, message };
}

type XDirectMessageBody = { text?: string; attachments?: { media_id: string }[] };

export async function xSendDm(
  request: ReturnType<typeof xDmRequest>,
  mediaIds: string[],
  publish: (url: string, body: XDirectMessageBody) => Promise<{
    value: { data?: { dm_event_id?: unknown } };
  }>,
  beforeSubmit?: () => Promise<void>,
): Promise<SocialSendResult> {
  if (mediaIds.length > 1 || mediaIds.some((value) => !/^\d{1,19}$/.test(value)))
    throw new SocialPlatformError("rejected");
  const body: XDirectMessageBody = {};
  if (request.message.trim()) body.text = request.message;
  if (mediaIds.length) body.attachments = [{ media_id: mediaIds[0] }];
  if (!body.text && !body.attachments) throw new SocialPlatformError("rejected");
  await beforeSubmit?.();
  const { value } = await publish(request.url, body);
  return { platformId: requireId(value.data?.dm_event_id) };
}
