import { useCallback, type RefObject } from "react";

/** Clear the shared draft/textarea ritual; action-specific selections stay with the action. */
export function useClearComposerDraft(
  input: RefObject<HTMLTextAreaElement | null>,
  setDraft: (text: string) => void,
  onDraftChange?: (text: string) => void,
) {
  return useCallback(() => {
    if (input.current) {
      input.current.value = "";
      input.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
  }, [input, setDraft, onDraftChange]);
}
