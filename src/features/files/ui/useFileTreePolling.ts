import { useEffect, useRef } from "react";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { remotePollDue } from "../../connections/model/remoteHealth";
import { notifyDirsChanged, subscribeDirsChanged } from "../model/fileTree";

/** Keeps the root's directory listings fresh: resume refresh plus a focus-aware poll. */
export function useFileTreePolling(cwd: string, visible: boolean) {
  useEffect(() => {
    const unsub = subscribeDirsChanged(() => undefined, cwd);
    const onResume = () => {
      if (!document.hidden) notifyDirsChanged(cwd, true, true);
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      unsub();
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [cwd]);

  const pollPaused = useRef(false);
  useEffect(() => {
    if (!visible) {
      pollPaused.current = true;
      return;
    }
    const remote = cwd.startsWith(REMOTE_PATH_PREFIX);
    // Local folders re-list only expanded directories, and only while the
    // window has focus and the tree is shown; returning to either refreshes.
    if (pollPaused.current && !remote) notifyDirsChanged(cwd, true);
    pollPaused.current = false;
    const timer = window.setInterval(
      () => {
        if (document.hidden) return;
        if (remote ? remotePollDue(cwd) : document.hasFocus()) notifyDirsChanged(cwd, true);
      },
      remote ? 5000 : 3000,
    );
    return () => window.clearInterval(timer);
  }, [cwd, visible]);
}
