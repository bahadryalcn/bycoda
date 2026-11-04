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
  if (options?.questionSessionId && entries.some(([, files]) =>
    files.some((file) => !!file.hostEnvironmentId && file.hostEnvironmentId === options.environmentId),
  )) throw new Error("This attachment belongs to an earlier Host operation. Reattach the original file to answer this question.");
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
