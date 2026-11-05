import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { composerDraftOf, setComposerDraftSnapshot } from "../model/draftCache";
import { composerDraftsLoaded, subscribeComposerDraftLoadState } from "../data/composerDraftStore";
import type { Block } from "../model/session";
import { blockDigest, canonicalJson, hash128 } from "../../sync/public/conversationDigest";
import {
  hasHostSessionOwnerFence,
  hydrateHostSessionBindings,
} from "../../connections/public/sessionExecutionBinding";

function sourceDigest(block: Block): string {
  return hash128(
    canonicalJson({
      block: blockDigest(block),
      files:
        block.attachments?.map(({ id, path, data, hostEnvironmentId, missing }) => ({
          id,
          path,
          data,
          hostEnvironmentId,
          missing,
        })) ?? [],
    }),
  );
}

/** Project a saved turn into an empty composer while keeping its durable source. */
export function useSavedDraftProjection(sessionId: string, block: Block | undefined) {
  const key = block ? `${sessionId}:${block.id}` : undefined;
  const loaded = useSyncExternalStore(
    subscribeComposerDraftLoadState,
    composerDraftsLoaded,
    composerDraftsLoaded,
  );
  const digest = useMemo(() => (block ? sourceDigest(block) : undefined), [block]);
  const [ready, setReady] = useState<{
    key: string;
    digest: string;
    projected: boolean;
    initialDraft: string;
  }>();
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!loaded || !block || !key || !digest) return;
    let cancelled = false;
    setFailure(undefined);
    void hydrateHostSessionBindings()
      .then(() => {
        if (cancelled) return;
        if (hasHostSessionOwnerFence(sessionId)) return;
        const current = composerDraftOf(sessionId);
        let projected = current.sourceDraftId === block.id && current.sourceDraftDigest === digest;
        if (
          !current.sourceDraftId &&
          !current.text &&
          !current.attachments.length &&
          !current.mcpTags.length
        ) {
          setComposerDraftSnapshot(sessionId, {
            ...current,
            text: block.text,
            attachments: block.attachments ?? [],
            sourceDraftId: block.id,
            sourceDraftDigest: digest,
          });
          projected = true;
        }
        setReady({ key, digest, projected, initialDraft: composerDraftOf(sessionId).text });
      })
      .catch(() => {
        if (!cancelled) setFailure(key);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, key, block, digest, loaded, attempt]);
  return {
    ready: loaded && !!key && ready?.key === key && ready.digest === digest,
    projected: loaded && !!key && ready?.key === key && ready.digest === digest && ready.projected,
    initialDraft:
      loaded && !!key && ready?.key === key && ready.digest === digest
        ? ready.initialDraft
        : undefined,
    failed: !!key && failure === key,
    retry: () => setAttempt((value) => value + 1),
  };
}
