import { useCallback, useEffect, useState } from "react";
import { gitOperationStatus, subscribeGitChanged } from "../../../platform/tauri/fs";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { remotePollDue, reportRemoteLoad } from "../../connections/public/remoteHealth";
import type { LegacyConflictStatus } from "../model/conflictSection";

const POLL_MS = 5000;

/**
 * The merge state of a project whose index does not carry it: a host that
 * predates conflict info, but has the `git.actions` status commands. Polls
 * only while `active` (the panel turns it on for that case alone; a local
 * project and a current host never poll). Polling slows while a remote machine
 * is unreachable, and the last state stays shown meanwhile.
 */
export function useLegacyConflictStatus(cwd: string, active: boolean): LegacyConflictStatus | null {
  const remote = isRemoteProjectPath(cwd);
  const [loaded, setLoaded] = useState<{
    cwd: string;
    status: LegacyConflictStatus | null;
  } | null>(null);

  // Going inactive forgets the last state, as a fresh start does.
  if (!active && loaded !== null) setLoaded(null);

  const load = useCallback(() => {
    if (!active || document.hidden) return;
    void gitOperationStatus(cwd).then(
      (next) => {
        if (remote) reportRemoteLoad(cwd, "banner");
        setLoaded({ cwd, status: next });
      },
      (error: unknown) => {
        // An unreachable machine keeps the last state shown.
        if (remote) return reportRemoteLoad(cwd, "banner", error);
        setLoaded({ cwd, status: null });
      },
    );
  }, [active, cwd, remote]);

  useEffect(() => {
    if (!active) return;
    load();
    const timer = window.setInterval(() => {
      if (!remote || remotePollDue(cwd)) load();
    }, POLL_MS);
    window.addEventListener("focus", load);
    const unsubscribe = subscribeGitChanged(load, { cwd });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      unsubscribe();
    };
  }, [active, cwd, load, remote]);

  // A state loaded for another project is never shown for this one.
  return active && loaded?.cwd === cwd ? loaded.status : null;
}
