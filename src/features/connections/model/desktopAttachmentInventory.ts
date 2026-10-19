import { invoke } from "@tauri-apps/api/core";
import { allComposerAttachmentIds, getComposerAttachments } from "../../sessions/model/draftCache";
import { attachmentOwnershipSourceNames, type AttachmentOwnership } from "./attachmentOwnership";
import { pendingRemoteAttachmentIds, pendingRemoteEnvironmentAttachmentIds } from "./remoteOutbox";

/** Native storage reads establish absence; any failure preserves every claim. */
export async function desktopAttachmentInventory(
  scope: AttachmentOwnership,
  machineId: string,
  environmentId: string,
  shellId: string,
  project: string,
  fallbackQueueId?: string,
): Promise<Record<string, string[]>> {
  const queues = new Set(
    attachmentOwnershipSourceNames(machineId, environmentId, scope.ownerId)
      .filter((source) => source.startsWith("queue:"))
      .map((source) => source.slice(6)),
  );
  if (fallbackQueueId) queues.add(fallbackQueueId);
  const raw = await invoke<{ draftIds: unknown; queues: Record<string, unknown> }>(
    "session_attachment_references",
    {
      sessionId: shellId,
      queueSessionIds: [...queues],
    },
  );
  if (!raw || typeof raw !== "object" || !raw.queues || typeof raw.queues !== "object")
    throw new Error("Invalid saved attachment inventory");
  const sources: Record<string, string[]> = {
    draft: [
      ...new Set([
        ...attachmentIds(raw.draftIds),
        ...getComposerAttachments(shellId).map((file) => file.id),
      ]),
    ],
    pending: pendingRemoteAttachmentIds(project, environmentId, shellId),
  };
  for (const id of queues) sources[`queue:${id}`] = attachmentIds(raw.queues[id]);
  return sources;
}

function attachmentIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !id))
    throw new Error("Invalid saved attachment references");
  return raw as string[];
}

export async function globalDesktopAttachmentInventory(
  sessionId: string,
  environmentId: string,
): Promise<Record<string, string[]>> {
  const raw = await invoke<{ draftIds: unknown; queues: Record<string, unknown> }>(
    "session_attachment_references",
    {
      sessionId,
      queueSessionIds: [],
      allSessions: true,
    },
  );
  if (
    !raw ||
    typeof raw !== "object" ||
    !raw.queues ||
    typeof raw.queues !== "object" ||
    Array.isArray(raw.queues)
  )
    throw new Error("Invalid global attachment inventory");
  return {
    draft: [...new Set([...attachmentIds(raw.draftIds), ...allComposerAttachmentIds()])],
    queues: Object.values(raw.queues).flatMap(attachmentIds),
    pending: pendingRemoteEnvironmentAttachmentIds(environmentId),
  };
}
