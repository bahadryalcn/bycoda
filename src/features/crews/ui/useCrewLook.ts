import { useState, type Dispatch, type SetStateAction } from "react";
import type { CrewDefinition } from "../model/crew";
import {
  loadCrewAppearances,
  saveCrewAppearance,
  useCrewAppearances,
  type CrewAppearance,
} from "../model/crewAppearance";
import { adoptSaved } from "../model/crewBulk";
import {
  hasLook,
  keepMigratedLook,
  mergeLook,
  outgoingWithLook,
  resolveCrewLook,
  settleLocalLook,
} from "../model/crewLook";

/**
 * The editor's crew look. On a host with `crews.identity.v1` the look is part of the
 * draft and travels with the normal save; otherwise it stays on this device as before.
 */
export function useCrewLook(input: {
  draft: CrewDefinition | null;
  setDraft: Dispatch<SetStateAction<CrewDefinition | null>>;
  isNew: boolean;
  supported: boolean;
  copyOfId?: string;
}) {
  const { draft, setDraft, isNew, supported, copyOfId } = input;
  const local = useCrewAppearances();
  // An unsaved crew's look on a host without identity, and a copy's inherited local look.
  const [draftLook, setDraftLook] = useState<CrewAppearance>(() =>
    copyOfId ? (loadCrewAppearances()[copyOfId] ?? {}) : {},
  );
  const stored = draft && !isNew ? resolveCrewLook(draft, local) : undefined;
  const look = supported
    ? (draft?.appearance ?? (isNew ? draftLook : stored) ?? {})
    : (stored ?? draftLook);
  return {
    look,
    setLook: (patch: CrewAppearance) => {
      if (supported)
        setDraft((current) =>
          current ? { ...current, appearance: mergeLook(look, patch) } : current,
        );
      else if (draft && !isNew) saveCrewAppearance(draft.id, patch);
      else setDraftLook((current) => ({ ...current, ...patch }));
    },
    /** Carries a stored crew's device look to the unsaved copy made from it. */
    seedFrom: (id: string) => setDraftLook(loadCrewAppearances()[id] ?? {}),
    /** The definition to create: a look chosen before creating goes with it on identity hosts. */
    forCreate: (definition: CrewDefinition): CrewDefinition =>
      supported && definition.appearance === undefined && hasLook(draftLook)
        ? { ...definition, appearance: draftLook }
        : definition,
    afterCreate: (definition: CrewDefinition) => {
      if (!supported) saveCrewAppearance(definition.id, draftLook);
    },
    /** Autosave payload; adds a device-only look the Host does not have yet. */
    outgoing: (definition: CrewDefinition) =>
      outgoingWithLook(definition, loadCrewAppearances(), supported),
    /** The draft after a successful save, keeping a look that migrated with it. */
    adopt: (current: CrewDefinition, sent: CrewDefinition, returned: CrewDefinition) =>
      keepMigratedLook(adoptSaved(current, sent, returned), sent, returned),
    /** Called only after the Host accepted the save. */
    saved: settleLocalLook,
  };
}
