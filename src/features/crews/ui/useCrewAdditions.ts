import { useState } from "react";
import type { CrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { blankMember } from "../model/crewEditorDraft";
import { memberDraftStarted } from "../model/crewRoster";
import type { MemberPickerMode } from "./CrewMemberPicker";

/**
 * The Add members page's state. Picks and the unfinished new-member draft live with the
 * editor, not the page, so leaving and returning keeps them until the owner deliberately
 * adds or discards them.
 */
export function useCrewAdditions(data: ProjectCrews) {
  const [mode, setMode] = useState<MemberPickerMode>(data.agents.length ? "library" : "new");
  const [picked, setPicked] = useState<string[]>([]);
  const [newMember, setNewMember] = useState<CrewAgent>(() => blankMember(data));
  const [issues, setIssues] = useState(false);

  /** Opens the page, keeping unfinished picks and a started draft. */
  const open = () => {
    setIssues(false);
    setNewMember((current) => (memberDraftStarted(current) ? current : blankMember(data)));
    // An empty library can only add new members; an untouched draft opens on the library.
    setMode((current) =>
      !data.agents.length ? "new" : memberDraftStarted(newMember) ? current : "library",
    );
  };
  /** Deliberately drops the library picks and the unfinished new-member draft. */
  const reset = () => {
    setPicked([]);
    setNewMember(blankMember(data));
    setIssues(false);
  };
  return {
    mode,
    setMode,
    picked,
    setPicked,
    newMember,
    setNewMember,
    issues,
    setIssues,
    open,
    reset,
  };
}

export type CrewAdditions = ReturnType<typeof useCrewAdditions>;
