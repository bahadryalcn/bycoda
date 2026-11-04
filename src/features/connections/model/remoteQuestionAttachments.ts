import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { uploadRemoteAttachments } from "./remoteAttachments";

/** Preserve per-question ownership while replacing local paths with uploaded Host refs. */
export async function uploadQuestionAttachments(
  machineId: string,
  reply: UserQuestionReply,
  options: Parameters<typeof uploadRemoteAttachments>[2],
): Promise<UserQuestionReply> {
  if (reply.kind !== "answered" || !reply.attachments) return reply;
  const entries = Object.entries(reply.attachments);
  const uploaded = await uploadRemoteAttachments(
    machineId,
    entries.flatMap(([, files]) => files),
    options,
  );
  let offset = 0;
  const attachments = Object.fromEntries(
    entries.map(([id, files]) => {
      const references = uploaded.slice(offset, offset + files.length);
      offset += files.length;
      return [id, references];
    }),
  );
  return { ...reply, attachments };
}
