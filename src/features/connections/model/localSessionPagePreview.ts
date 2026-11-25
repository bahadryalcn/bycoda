import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { captureConnectionGeneration, readRemoteLifecycle } from "./remoteLifecycle";
import {
  readRemotePageCache,
  remotePageDeletionRevision,
  type RemotePageSnapshot,
} from "./remotePageCache";
import type { HostSessionBinding } from "./sessionExecutionBinding";

/** Only the row under consideration holds a disk preview. The Host still verifies it on open. */
let intent:
  | {
      shellId: string;
      startedAt: number;
      matchesOwner: (owner?: HostSessionBinding) => boolean;
      read: Promise<RemotePageSnapshot | undefined>;
      page?: RemotePageSnapshot;
    }
  | undefined;

export function localSessionPagePreview(shellId: string, owner?: HostSessionBinding) {
  if (
    intent?.shellId === shellId &&
    elapsedSince(intent.startedAt) <= 5_000 &&
    intent.matchesOwner(owner)
  )
    return intent;
}

export function prefetchLocalSessionPage(
  shellId: string,
  owner: HostSessionBinding,
  current: () => boolean,
) {
  if (!owner.created || !current() || localSessionPagePreview(shellId, owner)) return;
  const generation = captureConnectionGeneration(owner.environmentId);
  const deletion = remotePageDeletionRevision;
  const matchesOwner = (candidate?: HostSessionBinding) =>
    !!candidate?.created &&
    candidate.machineId === owner.machineId &&
    candidate.environmentId === owner.environmentId &&
    candidate.sessionId === owner.sessionId &&
    candidate.projectId === owner.projectId &&
    candidate.authorityGeneration === owner.authorityGeneration &&
    generation === readRemoteLifecycle(owner.environmentId).generation &&
    deletion === remotePageDeletionRevision &&
    current();
  const read = readRemotePageCache(owner).then((page) => {
    if (!matchesOwner(owner)) return;
    if (page?.session.id !== owner.sessionId || page.projectId !== owner.projectId) return;
    if (intent?.read === read) intent.page = page;
    return page;
  });
  intent = {
    shellId,
    startedAt: monotonicNow(),
    matchesOwner,
    read,
  };
}
