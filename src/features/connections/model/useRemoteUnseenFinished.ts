import { useCallback, useEffect, useRef, useState } from "react";
import { nextRemoteUnseenFinished, type RemoteRailSession } from "./remoteRailSessions";

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Rail host sessions that finished while not open here, kept until opened or
 * dismissed. Returns the ids and a function that dismisses one. */
export function useRemoteUnseenFinished(
  listed: readonly RemoteRailSession[],
  loadedHostIds: ReadonlySet<string>,
  focusedHostId?: string,
): [ReadonlySet<string>, (hostId: string) => void] {
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(() => new Set());
  const tracked = useRef<{
    running: ReadonlySet<string>;
    unseen: ReadonlySet<string>;
  }>({ running: new Set(), unseen: new Set() });
  useEffect(() => {
    const next = nextRemoteUnseenFinished({
      listed,
      previousRunningIds: tracked.current.running,
      previousUnseenIds: tracked.current.unseen,
      loadedHostIds,
      focusedHostId,
    });
    tracked.current = { running: next.runningIds, unseen: next.unseenIds };
    setUnseen((current) => (sameIds(current, next.unseenIds) ? current : next.unseenIds));
  }, [listed, loadedHostIds, focusedHostId]);
  const dismiss = useCallback((hostId: string) => {
    if (!tracked.current.unseen.has(hostId)) return;
    const next = new Set(tracked.current.unseen);
    next.delete(hostId);
    tracked.current = { ...tracked.current, unseen: next };
    setUnseen(next);
  }, []);
  return [unseen, dismiss];
}
