import { t } from "../../../shared/i18n";
import { MAX_ATTACHMENTS } from "./attachments";
import type { Attachment } from "./session";

/** One picker/paste/drop owns its claims through the draft merge. Concurrent reads share the pending set. */
export function beginAttachmentRead(
  existing: () => readonly Attachment[],
  pending: Set<string | symbol>,
) {
  const held = new Set<string | symbol>();
  let omitted = 0;
  let pendingPath = false;
  return {
    get matchedPendingPath() {
      return pendingPath;
    },
    remaining: () => Math.max(0, MAX_ATTACHMENTS - existing().length - pending.size),
    reserve(path?: string) {
      const current = existing();
      if (
        path &&
        current.some((item) => item.path === path && item.hostEnvironmentId === undefined)
      )
        return undefined;
      if (path && pending.has(path)) {
        pendingPath = true;
        return null;
      }
      if (current.length + pending.size >= MAX_ATTACHMENTS) {
        omitted++;
        return null;
      }
      const slot = path ?? Symbol();
      pending.add(slot);
      held.add(slot);
      return slot;
    },
    release(slot: string | symbol) {
      pending.delete(slot);
      held.delete(slot);
    },
    finish() {
      for (const slot of held) pending.delete(slot);
      held.clear();
    },
    notice() {
      return omitted
        ? t("Attached {p0} of {p1} files. A message carries up to {p2}.", {
            p0: held.size,
            p1: held.size + omitted,
            p2: MAX_ATTACHMENTS,
          })
        : null;
    },
  };
}
export type AttachmentReadCapacity = ReturnType<typeof beginAttachmentRead>;
