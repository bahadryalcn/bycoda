import { useState } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

const preference = createStoredSetting<{ view: string; groupId: string | null }>({
  key: "bycoda.skillGroups.view.v1",
  serialize: JSON.stringify,
  fallback: { view: "all", groupId: null },
  parse: (raw) => {
    const value = JSON.parse(raw);
    return {
      view: value.view === "groups" ? "groups" : "all",
      groupId: typeof value.groupId === "string" ? value.groupId : null,
    };
  },
});

/** The library's view (All skills / Groups) and the group open in the editor, kept across visits. */
export function useSkillGroupView() {
  const [state, setState] = useState(() => preference.load());
  const update = (next: typeof state) => {
    setState(next);
    // Presentation preferences must not block working with the library when storage is unavailable.
    try {
      preference.save(next);
    } catch {
      /* Session state remains usable. */
    }
  };
  return {
    ...state,
    setView: (view: string) => update({ ...state, view }),
    /** Opening a group also switches to Groups view, so a group created elsewhere lands in its editor. */
    selectGroup: (groupId: string | null) =>
      update({ view: groupId ? "groups" : state.view, groupId }),
  };
}
