import { useState } from "react";
import type { CrewAgent, CrewRole } from "../model/crew";
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
  // The add slot the current picks were made in; retained picks keep that slot's responsibility.
  const [pickedFor, setPickedFor] = useState<CrewRole | undefined>(undefined);
  const [newMember, setNewMember] = useState<CrewAgent>(() => blankMember(data));
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [scope, setScope] = useState<"project" | "global">("project");
  const [issues, setIssues] = useState(false);

  /** Opens the page for a role slot, keeping unfinished picks and a started draft. */
  const open = (role?: CrewRole) => {
    setIssues(false);
    setNewMember((current) =>
      !memberDraftStarted(current)
        ? blankMember(data, role)
        : role && current.role !== role
          ? { ...current, role }
          : current,
    );
    // An empty library can only add new members; an untouched draft opens on the library.
    setMode((current) =>
      !data.agents.length ? "new" : memberDraftStarted(newMember) ? current : "library",
    );
  };
  /** Deliberately drops the library picks and the unfinished new-member draft. */
  const reset = () => {
    setPicked([]);
    setNewMember(blankMember(data));
    setSaveToLibrary(false);
    setIssues(false);
  };
  return {
    mode,
    setMode,
    picked,
    setPicked,
    pickedFor,
    setPickedFor,
    newMember,
    setNewMember,
    saveToLibrary,
    setSaveToLibrary,
    scope,
    setScope,
    issues,
    setIssues,
    open,
    reset,
  };
}

export type CrewAdditions = ReturnType<typeof useCrewAdditions>;
