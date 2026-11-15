import type { HostSession } from "../../src/features/connections/model/protocol";
import type { LinkedWorkItem } from "../../src/features/sessions/model/session";
import { sessionAttentionUpdate, type SessionAttentionPatch } from "./session-attention";

export interface SessionMetadataPatch extends SessionAttentionPatch {
  title?: string;
  archived?: boolean;
  pinned?: boolean;
  linkedWorkItem?: LinkedWorkItem | null;
}
const keys = [
  "title",
  "archived",
  "pinned",
  "linkedWorkItem",
  "unread",
  "snoozedUntil",
  "expectedRevision",
];

/** One validated metadata write; transcript and authority remain the store's responsibility. */
export function sessionMetadataUpdate(
  current: HostSession,
  patch: SessionMetadataPatch,
): HostSession {
  if (Object.keys(patch).some((key) => !keys.includes(key)))
    throw new Error("Unsupported client-editable session metadata.");
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 200))
    throw new Error("Invalid session title");
  return {
    ...current,
    revision: current.revision + 1,
    archived: patch.archived ?? current.archived,
    pinned: patch.pinned ?? current.pinned,
    ...sessionAttentionUpdate(current, patch),
    session: {
      ...current.session,
      ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
      ...(patch.linkedWorkItem === undefined
        ? {}
        : { linkedWorkItem: patch.linkedWorkItem ?? undefined }),
    },
  };
}
