import { useT } from "./index";

/**
 * Labels for the find controls shared by the editor, file preview and project search,
 * so the same control reads and announces the same way on every surface. Sentence case.
 * Each surface passes its own translator (`t` or `useT()`).
 */
export function findControlLabels(translate: (message: string) => string) {
  return {
    matchCase: translate("Match case"),
    matchWholeWord: translate("Match whole word"),
    useRegex: translate("Use regular expression"),
    toggleReplace: translate("Toggle replace"),
    previousMatch: translate("Previous match"),
    nextMatch: translate("Next match"),
  };
}

export function useFindControlLabels() {
  return findControlLabels(useT());
}
