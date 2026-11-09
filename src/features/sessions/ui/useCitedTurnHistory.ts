import { useEffect, useRef } from "react";
import type { Block } from "../model/session";
import type { TranscriptJump } from "../model/transcriptJump";

/** An explicit citation can demand older bounded pages; ordinary renders never do. */
export function useCitedTurnHistory({
  visible,
  jump,
  blocks,
  hasMore,
  loading,
  error,
  load,
}: {
  visible: boolean;
  jump: TranscriptJump | null;
  blocks: readonly Block[];
  hasMore: boolean;
  loading: boolean;
  error?: string;
  load?: () => Promise<number | void> | void;
}) {
  const attempted = useRef("");
  useEffect(() => {
    if (
      !visible ||
      !jump ||
      !hasMore ||
      loading ||
      error ||
      !load ||
      blocks.some((block) => block.id === jump.blockId)
    )
      return;
    const key = `${jump.token}:${blocks.length}`;
    if (attempted.current === key) return;
    attempted.current = key;
    let cancelled = false;
    let started = false;
    // RemoteSession owns request identity, revision, cancellation and error UI.
    // Reattempt only after actual page progress or a new citation, never a render loop.
    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        started = true;
        return load();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (!started && attempted.current === key) attempted.current = "";
    };
  }, [visible, jump, blocks, hasMore, loading, error, load]);
}
