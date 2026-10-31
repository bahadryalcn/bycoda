import { memo, useEffect, useState, type ReactNode } from "react";
import { useLocale } from "../../../shared/i18n";
import { Brain, Clock, Loader, RefreshCw } from "../../../shared/ui/icons";
import { claimTurnClock, type TurnActivityPhase } from "../model/turnActivity";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";

/** How long a turn that already shows output must be silent before the line returns. */
export const TURN_SILENCE_MS = 4000;

type Props = {
  phase: TurnActivityPhase;
  label: string;
  afterSilence: boolean;
  /**
   * Changes whenever the turn receives anything. Only read by a line shown
   * after silence, which restarts its wait on every change.
   */
  activityKey: unknown;
  /** The turn clock's origin (epoch ms); see `turnClockOrigin`. */
  origin?: number;
  /** This line shows the turn clock; the composer's dock leaves its own out. */
  ownsClock: boolean;
  sessionId?: string;
};

/**
 * The live end of a running turn while it has nothing else to show: what the
 * turn is doing, and for how long. It is never history — the parent renders it
 * only for the live turn, and it gives way the moment output arrives.
 */
export const TurnActivityLine = memo(function TurnActivityLine({
  phase,
  label,
  afterSilence,
  activityKey,
  origin,
  ownsClock,
  sessionId,
}: Props) {
  return afterSilence ? (
    <SilentTurnLine phase={phase} label={label} activityKey={activityKey} />
  ) : (
    <PendingTurnLine
      phase={phase}
      label={label}
      origin={origin}
      ownsClock={ownsClock}
      sessionId={sessionId}
    />
  );
});

/** Before any output: the phase, and the turn clock when this line owns it. */
function PendingTurnLine({
  phase,
  label,
  origin,
  ownsClock,
  sessionId,
}: Pick<Props, "phase" | "label" | "origin" | "ownsClock" | "sessionId">) {
  const claims = ownsClock && !!sessionId;
  useEffect(() => {
    if (!claims || !sessionId) return;
    return claimTurnClock(sessionId);
  }, [claims, sessionId]);
  return (
    <TurnActivityRow phase={phase} label={label}>
      {ownsClock ? <TurnActivityClock origin={origin} /> : null}
    </TurnActivityRow>
  );
}

/**
 * Mid-turn: appears only after the turn has been silent for a while, and
 * counts that silence. The turn's own clock stays where it already is.
 */
function SilentTurnLine({
  phase,
  label,
  activityKey,
}: Pick<Props, "phase" | "label" | "activityKey">) {
  const [quiet, setQuiet] = useState<{ key: unknown; since: number } | null>(null);
  useEffect(() => {
    const since = Date.now();
    const timer = window.setTimeout(() => setQuiet({ key: activityKey, since }), TURN_SILENCE_MS);
    return () => window.clearTimeout(timer);
  }, [activityKey]);
  if (!quiet || quiet.key !== activityKey) return null;
  return (
    <TurnActivityRow phase={phase} label={label}>
      <TurnActivityClock origin={quiet.since} />
    </TurnActivityRow>
  );
}

function TurnActivityRow({
  phase,
  label,
  children,
}: {
  phase: TurnActivityPhase;
  label: string;
  children?: ReactNode;
}) {
  useLocale();
  return (
    <div
      data-turn-activity={phase}
      className="turn-activity-line flex min-w-0 items-center gap-1.5 px-4 py-1 font-sans text-sm text-(--ui-text-secondary)"
    >
      <TurnActivityIcon phase={phase} />
      {/* One live signal: the label breathes; the icon and the clock stay still. */}
      <span role="status" aria-live="polite" className="zen-thinking-pulse min-w-0 truncate">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Its own component so only the clock re-renders each second. */
function TurnActivityClock({ origin }: { origin?: number }) {
  const elapsed = formatElapsed(useElapsedFrom(origin, false));
  return (
    <span aria-hidden className="shrink-0 text-ui-micro tabular-nums">
      {elapsed}
    </span>
  );
}

function TurnActivityIcon({ phase }: { phase: TurnActivityPhase }) {
  const props = {
    className: "size-3.5 shrink-0 text-(--ui-text-secondary)",
    strokeWidth: 1.75,
  } as const;
  if (phase === "thinking") return <Brain {...props} />;
  if (phase === "waiting") return <Clock {...props} />;
  if (phase === "retrying" || phase === "reconnecting") return <RefreshCw {...props} />;
  return <Loader {...props} />;
}
