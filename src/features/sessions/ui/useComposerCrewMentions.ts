import { useEffect, useMemo, useState } from "react";
import { loadCrewMentionSource } from "../model/crewDelegation";
import {
  rankCrewMentions,
  type CrewMentionRow,
  type CrewMentionSource,
} from "../model/crewMentions";

type ScopedSource = { cwd: string; source: CrewMentionSource | null };

const NO_ROWS: CrewMentionRow[] = [];

/**
 * Members and crews for `@` mentions, ranked against the query. The Host is asked only while
 * the mention menu is open; a read for another project, or one that finishes after the menu
 * closed or the project changed, is dropped. The last list stays for the same project.
 */
export function useComposerCrewMentions(input: {
  cwd: string;
  active: boolean;
  query: string;
}): CrewMentionRow[] {
  const { cwd, active, query } = input;
  const [state, setState] = useState<ScopedSource>({ cwd, source: null });

  useEffect(() => {
    if (!active || !cwd) return;
    let cancelled = false;
    void loadCrewMentionSource(cwd)
      .then((source) => {
        if (!cancelled) setState({ cwd, source });
      })
      .catch((error) => console.warn("Loading composer crews failed", error));
    return () => {
      cancelled = true;
    };
  }, [active, cwd]);

  const source = state.cwd === cwd ? state.source : null;
  return useMemo(
    () => (active && source ? rankCrewMentions(source, query) : NO_ROWS),
    [active, source, query],
  );
}
