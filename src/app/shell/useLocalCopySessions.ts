import { useEffect, useState } from "react";
import {
  listSessionsByProject,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";

const NONE: SessionSummary[] = [];

/**
 * This computer's stored conversations for a project copy that is not the open
 * one. `revision` is any value that changes when local sessions may have
 * changed; the list is read again then.
 */
export function useLocalCopySessions(path: string | undefined, revision: string): SessionSummary[] {
  const [loaded, setLoaded] = useState<{ path: string; rows: SessionSummary[] }>({
    path: "",
    rows: NONE,
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the shown list in step with the native session store for a folder no other view has loaded, and drops a late reply for a folder that is no longer the copy.
  useEffect(() => {
    if (!path) return;
    let current = true;
    listSessionsByProject(path)
      .then((rows) => {
        if (current) setLoaded({ path, rows });
      })
      // The open copy's list is unaffected; this copy's rows stay as they were.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [path, revision]);
  return path && loaded.path === path ? loaded.rows : NONE;
}
