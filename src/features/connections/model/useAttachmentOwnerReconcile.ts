import { useEffect } from "react";
import { subscribePersistedComposerDrafts } from "../../sessions/data/composerDraftStore";
import {
  retireClosedAttachmentOwners,
  type AttachmentOwnership,
  type AttachmentOwnershipRequest,
} from "./attachmentOwnership";
import { desktopAttachmentInventory } from "./desktopAttachmentInventory";
import { subscribePersistedRemoteQueues } from "./useRemoteQueue";

/**
 * Keeps the host's attachment ownership claims in line with what this window
 * still holds: reconciles once the saved queue is readable, then again whenever
 * the persisted composer draft or the conversation's queue changes its set of
 * attachment ids. Reconciles run one after another, and a failed one only warns
 * (every claim is preserved on failure).
 */
export function useAttachmentOwnerReconcile(input: {
  ownership: AttachmentOwnership | undefined;
  online: boolean;
  queueLoaded: boolean;
  machineId: string;
  environmentId: string;
  shellId: string;
  projectKey: string;
  sharedQueueEnabled: boolean;
  activeSessionId: string | undefined;
  request: AttachmentOwnershipRequest;
}): void {
  const {
    ownership,
    online,
    queueLoaded,
    machineId,
    environmentId,
    shellId,
    projectKey,
    sharedQueueEnabled,
    activeSessionId,
    request,
  } = input;
  useEffect(() => {
    if (!ownership || !online || !queueLoaded) return;
    let stopped = false;
    let chain = Promise.resolve();
    let draftIds = "";
    let queueIds = "";
    const reconcile = () => {
      chain = chain
        .catch(() => {})
        .then(async () => {
          if (stopped) return;
          const sources = await desktopAttachmentInventory(
            ownership,
            machineId,
            environmentId,
            shellId,
            projectKey,
            sharedQueueEnabled ? undefined : activeSessionId,
          );
          if (stopped) return;
          await ownership.reconcileDurable(sources);
          await retireClosedAttachmentOwners(machineId, environmentId, ownership, sources, request);
        });
      void chain.catch(console.warn);
    };
    const releaseDraft = subscribePersistedComposerDrafts((id, files) => {
      const next = JSON.stringify(files.map((file) => file.id).sort());
      if (id === shellId && draftIds !== next) {
        draftIds = next;
        reconcile();
      }
    });
    const releaseQueue = subscribePersistedRemoteQueues((key, value) => {
      const next = JSON.stringify(
        value.messages.flatMap((row) => row.attachments.map((file) => file.id)).sort(),
      );
      if (key === activeSessionId && queueIds !== next) {
        queueIds = next;
        reconcile();
      }
    });
    reconcile();
    return () => {
      stopped = true;
      releaseDraft();
      releaseQueue();
    };
  }, [
    ownership,
    online,
    queueLoaded,
    machineId,
    environmentId,
    shellId,
    projectKey,
    sharedQueueEnabled,
    activeSessionId,
  ]);
}
