/** Public contract for phones that unlock groups through the desktop: the relay and its reset epoch. */
export { runRemoteGroupLockJob } from "../model/remoteGroupLock";
export type { RemoteGroupLockJob, RemoteGroupLockReply } from "../model/remoteGroupLock";
export { getRemoteGrantEpoch } from "../model/groupLock";
