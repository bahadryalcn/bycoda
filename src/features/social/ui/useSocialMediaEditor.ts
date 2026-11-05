import { createContext, useContext, useEffect, useMemo } from "react";
import type { SocialClient } from "../model/socialClient";
import { SocialMediaEditor } from "../model/socialMediaEditor";

export function useSocialMediaEditor(
  client: SocialClient,
  releaseOnClose = false,
): SocialMediaEditor {
  const editor = useMemo(() => new SocialMediaEditor(client), [client]);
  useEffect(() => {
    editor.open();
    return () => editor.close(releaseOnClose);
  }, [editor, releaseOnClose]);
  return editor;
}

export const SocialMediaEditorContext = createContext<SocialMediaEditor | undefined>(undefined);
export function useSharedSocialMediaEditor(client: SocialClient): SocialMediaEditor {
  const shared = useContext(SocialMediaEditorContext);
  const local = useSocialMediaEditor(client, false);
  return shared ?? local;
}
