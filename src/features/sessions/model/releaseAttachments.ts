import type { Attachment } from "./session";
import { revokeAttachment } from "./attachments";

/** Borrowed/retained previews belong to their original owner and must stay valid. */
export function releaseAttachments(
  files: readonly Attachment[],
  borrowedIds: Set<string>,
  retainedIds: ReadonlySet<string> = new Set(),
) {
  for (const file of files) {
    if (!retainedIds.has(file.id) && !borrowedIds.delete(file.id)) revokeAttachment(file);
  }
}
