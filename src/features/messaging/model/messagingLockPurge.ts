import { getGroupLockView, subscribeGroupLock } from "../../group-lock/model/groupLock";
import { dropAllMessagingCaches } from "./messagingCache";

/**
 * Cached message bodies leave memory when a group lock engages. Subscribed at module level, so it
 * holds while the Messages panel is closed and no hook is mounted to notice the lock.
 */
let known: ReadonlySet<string> = getGroupLockView().lock.lockedGroupIds;
subscribeGroupLock(() => {
  const current = getGroupLockView().lock.lockedGroupIds;
  const engaged = [...current].some((id) => !known.has(id));
  known = current;
  if (engaged) dropAllMessagingCaches();
});
