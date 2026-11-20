import { useCallback, useEffect, useRef, useState } from "react";
import { githubStatus, type GithubStatus } from "../../inbox/public/githubStatus";
import { errorText } from "../../../shared/lib/errors";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

/** How often the settings row re-reads the status while the pinned GitHub CLI installs. */
export const GITHUB_CLI_POLL_MS = 2000;
/** The pinned install normally takes about a minute; past this the row stops watching and offers a retry. */
export const GITHUB_CLI_INSTALL_WATCH_MS = 3 * 60_000;

/**
 * GitHub CLI status for this computer. Reads you start (mount, Check again) show a checking state;
 * the background reads that follow an install do not, so the Installing state stays steady. The
 * watch is bounded: after {@link GITHUB_CLI_INSTALL_WATCH_MS} it stops and reports `slow` until
 * the owner checks again. This only reads status; the installer stays owned by the desktop.
 */
export function useGithubCliStatus() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const request = useRef(0);
  const watchStartedAt = useRef<number | null>(null);

  const read = useCallback(async (background: boolean) => {
    const generation = ++request.current;
    if (!background) {
      setChecking(true);
      setError(null);
      setSlow(false);
      watchStartedAt.current = null;
    }
    try {
      const next = await githubStatus();
      if (generation !== request.current) return;
      if (!next.installing) watchStartedAt.current = null;
      else watchStartedAt.current ??= monotonicNow();
      setStatus(next);
    } catch (err: unknown) {
      // A failed background read stops the watch; the last good status stays visible.
      if (generation === request.current) setError(errorText(err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, []);

  const check = useCallback(() => read(false), [read]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Load the native GitHub CLI status on mount and invalidate the read on unmount.
  useEffect(() => {
    void read(false);
    return () => {
      request.current += 1;
    };
  }, [read]);

  // While the pinned copy installs, re-read quietly until it is ready, has failed, the read
  // fails, or the watch deadline passes. Each finished read schedules the next one.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll the native GitHub CLI status while the installer is running.
  useEffect(() => {
    if (!status?.installing || error || slow) return;
    const timer = window.setTimeout(() => {
      const startedAt = watchStartedAt.current ?? monotonicNow();
      if (elapsedSince(startedAt) >= GITHUB_CLI_INSTALL_WATCH_MS) setSlow(true);
      else void read(true);
    }, GITHUB_CLI_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status, error, slow, read]);

  return { status, checking, error, slow: slow && Boolean(status?.installing), check };
}
