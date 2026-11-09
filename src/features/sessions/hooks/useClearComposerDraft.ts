import { useCallback, type RefObject } from "react";
const allowClear = () => true;

/** Clear the shared draft/textarea ritual; action-specific selections stay with the action. */
export function useClearComposerDraft(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  setDraft: (text: string) => void,
  onDraftChange?: (text: string) => void,
  canClear: () => boolean = allowClear,
) {
  return useCallback(() => {
    if (!canClear()) return;
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
  }, [inputRef, setDraft, onDraftChange, canClear]);
}
