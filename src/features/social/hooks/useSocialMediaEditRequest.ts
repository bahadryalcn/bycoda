import { useEffect, useRef } from "react";
import { socialMediaIds, type SocialMediaEditor } from "../model/socialMediaEditor";

/** Do not publish a copied editor state until its own durable media claims exist. */
export function useSocialMediaEditRequest<T extends { version: number }>(
  request: T | undefined,
  editor: SocialMediaEditor,
  apply: (request: T) => void,
  onError: () => void,
): void {
  const callbacks = useRef({ apply, onError });
  const appliedVersion = useRef<number | undefined>(undefined);
  useEffect(() => {
    callbacks.current = { apply, onError };
  });
  useEffect(() => {
    if (!request) return;
    let active = true;
    editor.invalidate();
    void (async () => {
      try {
        for (const id of socialMediaIds(request)) await editor.claimExisting(id);
        if (active && !editor.isClosed() && appliedVersion.current !== request.version) {
          appliedVersion.current = request.version;
          callbacks.current.apply(request);
        }
      } catch {
        if (active) callbacks.current.onError();
      }
    })();
    return () => {
      active = false;
    };
  }, [request?.version, editor]);
}
