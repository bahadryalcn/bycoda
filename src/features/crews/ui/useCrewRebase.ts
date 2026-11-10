import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CrewDefinition } from "../model/crew";
import { rebaseOntoSync } from "../model/crewLink";

/**
 * Keeps an open draft saveable when the Host moved the crew's revision by syncing a
 * library profile into linked members. The stored copy the draft was edited from is
 * remembered; when a newer copy differs only by such a sync and the draft did not touch
 * those members, the draft takes it and autosave sends the next change with the new
 * revision. Any other newer copy stays a conflict for the owner to resolve.
 */
export function useCrewRebase(
  draft: CrewDefinition | null,
  latest: CrewDefinition | undefined,
  setDraft: Dispatch<SetStateAction<CrewDefinition | null>>,
) {
  const base = useRef<CrewDefinition>(undefined);
  useEffect(() => {
    if (!draft || !latest || draft.id !== latest.id) return;
    if (latest.updatedAt === draft.updatedAt) base.current = latest;
    else if (latest.updatedAt > draft.updatedAt && base.current) {
      const rebased = rebaseOntoSync(base.current, draft, latest);
      if (rebased) setDraft((current) => (current === draft ? rebased : current));
    }
  }, [draft, latest, setDraft]);
}
