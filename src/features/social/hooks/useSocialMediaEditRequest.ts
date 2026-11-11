import { useEffect, useRef } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { socialMediaIds, type SocialMediaEditor } from "../model/socialMediaEditor";

/** Do not publish a copied editor state until its own durable media claims exist. */
export function useSocialMediaEditRequest<T extends { version: number }>(
  request: T | undefined,
  editor: SocialMediaEditor,
  apply: (request: T) => void,
  onError: () => void,
): void {
  const applyLatest = useStableCallback(apply);
  const errorLatest = useStableCallback(onError);
  const appliedVersion = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!request) return;
    let active = true;
    editor.invalidate();
    void (async () => {
      try {
        for (const id of socialMediaIds(request)) await editor.claimExisting(id);
        if (active && !editor.isClosed() && appliedVersion.current !== request.version) {
          appliedVersion.current = request.version;
          applyLatest(request);
        }
      } catch {
        if (active) errorLatest();
      }
    })();
    return () => {
      active = false;
    };
  }, [request?.version, editor, applyLatest, errorLatest]);
}
