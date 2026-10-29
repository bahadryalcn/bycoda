import { useEffect, useRef } from "react";
import type { HostSession } from "./protocol";
import { readRemotePageCache } from "./remotePageCache";

/**
 * Shows the disk copy of a conversation while the host has not answered yet.
 *
 * The hook only reads the cache and decides whether the copy may still be
 * shown; the caller owns the snapshot, the tail-read flag and the data state,
 * and applies the copy in `restore`. A copy is dropped when the effect was
 * replaced, when a live snapshot arrived first, or when the host already
 * reported the conversation deleted.
 */
export function useRemotePageCacheRestore(input: {
  environmentId: string;
  sessionId: string | undefined;
  /** A snapshot (live or cached) is already shown: the disk copy is older. */
  hasSnapshot: () => boolean;
  isDeleted: () => boolean;
  restore: (saved: HostSession) => void;
}): void {
  const { environmentId, sessionId } = input;
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    void readRemotePageCache({ environmentId, sessionId }).then((cached) => {
      if (!current || !cached || latest.current.hasSnapshot() || latest.current.isDeleted()) return;
      latest.current.restore(cached as HostSession);
    });
    return () => {
      current = false;
    };
  }, [environmentId, sessionId]);
}
