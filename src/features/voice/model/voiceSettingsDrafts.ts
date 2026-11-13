import { useState } from "react";

/** Window-local authoring only. Never stores credentials or writes incomplete preferences. */
export type DictionaryDraft = {
  editing: number | "new" | null;
  term: string;
  aliases: string[];
  projectId: string;
  editingRevision: string;
  conflict: boolean;
};
let dictionary: DictionaryDraft | null = null;
const phrases = new Map<string, { draft: string; baseline: string }>();

export function clearRetainedVoiceDrafts() {
  dictionary = null;
  phrases.clear();
}

export function useDictionaryDraft() {
  const [draft, setDraft] = useState<DictionaryDraft>(
    () =>
      dictionary ?? {
        editing: null,
        term: "",
        aliases: [],
        projectId: "",
        editingRevision: "",
        conflict: false,
      },
  );
  return [
    draft,
    (patch: Partial<DictionaryDraft>) => {
      const next = { ...draft, ...patch };
      dictionary = next.editing === null ? null : next;
      setDraft(next);
    },
  ] as const;
}

export function usePhraseDraft(id: string, value: string) {
  const [state, setState] = useState(() => phrases.get(id) ?? { draft: value, baseline: value });
  const update = (next: typeof state) => {
    if (next.draft === next.baseline) phrases.delete(id);
    else phrases.set(id, next);
    setState(next);
  };
  if (value !== state.baseline) {
    update({
      baseline: value,
      draft: state.draft === state.baseline || state.draft.trim() === value ? value : state.draft,
    });
  }
  return [state.draft, (draft: string) => update({ ...state, draft })] as const;
}
