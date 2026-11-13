import { useState } from "react";
import { getComposerDraft } from "../model/draftCache";

/** Keep committed parent authority reactive without echoing local edits as external drafts. */
export function useSessionComposerDraft(sessionId: string) {
  const [state, setState] = useState(() => {
    const value = getComposerDraft(sessionId);
    return { value, initialDraft: value };
  });
  return {
    ...state,
    change(value: string) {
      setState((previous) =>
        previous.value === value && previous.initialDraft === undefined
          ? previous
          : { value, initialDraft: undefined },
      );
    },
  };
}
