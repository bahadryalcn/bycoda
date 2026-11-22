import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n/core";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { FAILURE_GRACE_MS, FAILURE_RETRY_DELAYS_MS } from "../../../shared/ui/reportFailure";
import { classifyCommandFailure } from "./remoteCommandRetry";
import {
  isHostRestartFailure,
  isTransientTransportError,
  presentRemoteError,
} from "./remoteFailure";

export function classifyFailureLifetime(error: unknown): "transient" | "permanent" {
  return isTransientTransportError(error) ? "transient" : "permanent";
}

export function describeActionFailure(error: unknown) {
  const command = classifyCommandFailure(error);
  const transient = classifyFailureLifetime(error) === "transient";
  const uncertain = command === "uncertain" && transient;
  return {
    message: uncertain
      ? t("Remote outcome is unknown. Check the target before another run.")
      : presentRemoteError(error, { explicit: true }),
    transient: transient && !uncertain,
    notSent: command === "not-sent",
  };
}

// A declared Host shutdown can take five seconds to restart. Keep enough time for
// the read at 2 + 4 seconds to settle while ordinary unavailability escalates at 3 seconds.
const DECLARED_RESTART_GRACE_MS = 7_000;

type ReadFailureOptions = {
  error: unknown;
  retry?: () => void | Promise<unknown>;
  graceMs?: number;
  /** Keep the interruption active when a caller clears its error during a new read. */
  loading?: boolean;
  /** Change when the data owner or read target changes. */
  scope?: unknown;
};

type Episode = { scope: unknown; error: unknown; restart: boolean };

/** Quietly retries reads, retaining the first failure's deadline across failed attempts. */
export function useGracedFailure({
  error,
  retry,
  graceMs,
  loading = false,
  scope,
}: ReadFailureOptions): { visibleError?: string; pending: boolean } {
  const transient = !!error && classifyFailureLifetime(error) === "transient";
  const restart = transient && isHostRestartFailure(error);
  const permanent = !!error && !transient;
  const retryLatest = useStableCallback(retry);
  const [recorded, setRecorded] = useState<Episode>();
  const [expired, setExpired] = useState<Episode>();
  const [progress, setProgress] = useState<{
    episode: Episode;
    attempts: number;
    running: boolean;
  }>();
  const episode = recorded && Object.is(recorded.scope, scope) ? recorded : undefined;
  const attempts = progress?.episode === episode ? (progress?.attempts ?? 0) : 0;
  const running = progress?.episode === episode && progress?.running === true;
  const active = transient || (!permanent && !!episode && (loading || running));
  const delay =
    graceMs ?? ((episode?.restart ?? restart) ? DECLARED_RESTART_GRACE_MS : FAILURE_GRACE_MS);

  // Capture the first failure while deriving the view for the current read owner.
  if (transient && !episode) setRecorded({ scope, error, restart });
  if (!active && recorded) {
    setRecorded(undefined);
    setExpired(undefined);
    setProgress(undefined);
  }

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Holds the timer for this interruption's visibility deadline.
  useEffect(() => {
    if (!active || !episode) return;
    const timer = setTimeout(() => setExpired(episode), delay);
    return () => clearTimeout(timer);
  }, [active, delay, episode]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Holds one retry timer until the next background read can start.
  useEffect(() => {
    if (!transient || !episode || !retryLatest || loading || running) return;
    const timer = setTimeout(
      () => {
        const next = { episode, attempts: attempts + 1, running: true };
        setProgress(next);
        const settle = () =>
          setProgress((current) => (current === next ? { ...next, running: false } : current));
        Promise.resolve().then(retryLatest).then(settle, settle);
      },
      FAILURE_RETRY_DELAYS_MS[Math.min(attempts, FAILURE_RETRY_DELAYS_MS.length - 1)],
    );
    return () => clearTimeout(timer);
  }, [attempts, episode, loading, retryLatest, running, transient]);

  const visible = permanent || (active && !!episode && expired === episode);
  return {
    visibleError: visible
      ? presentRemoteError(error || episode?.error, { graceExpired: true })
      : undefined,
    pending: active && !visible,
  };
}
