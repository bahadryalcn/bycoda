import { useLocale } from "../../../shared/i18n";
import { Badge, type BadgeSize, type BadgeTone } from "../../../shared/ui/Badge";
import { Clock } from "../../../shared/ui/icons";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { CrewRunView } from "../model/crewClient";
import {
  crewAttentionLabel,
  crewExecutionLabel,
  crewExecutionState,
  crewHasRunningWork,
  crewOpenAttention,
  crewProgressLabel,
  type CrewAttention,
  type CrewExecutionState,
} from "../model/crewPresentation";

export function executionTone(state: CrewExecutionState): BadgeTone {
  return state === "finished" ? "success" : state === "working" ? "accent" : "neutral";
}

export function attentionTone(attention: CrewAttention): BadgeTone {
  return attention === "blocked" ? "danger" : "warning";
}

/** Idle and finished states are implied by the controls and the list tab; only live ones are named. */
function namedState(state: CrewExecutionState, forList: boolean) {
  return state === "working" || (forList && state === "paused");
}

/**
 * What needs the owner (CR-W04), plus the working signal while work runs. A paused or idle
 * run shows no state badge: its Resume or Start control already says so, and the state stays
 * available to assistive technology.
 */
export function CrewWorkBadges({ run, size = "sm" }: { run: CrewRunView; size?: BadgeSize }) {
  useLocale();
  const state = crewExecutionState(run);
  const attention = crewOpenAttention(run);
  const running = run.status !== "finished" && crewHasRunningWork(run);
  return (
    <>
      {namedState(state, false) || state === "finished" ? (
        <Badge
          tone={executionTone(state)}
          size={size}
          icon={running ? <WorkingIndicator size="xs" /> : undefined}
        >
          {crewExecutionLabel(state)}
        </Badge>
      ) : (
        <span className="sr-only">{crewExecutionLabel(state)}</span>
      )}
      {attention ? (
        <Badge tone={attentionTone(attention)} size={size}>
          {crewAttentionLabel(attention)}
        </Badge>
      ) : null}
    </>
  );
}

/** Plain-text form for lists and the rail: "Paused · Needs decision"; idle work says nothing. */
export function CrewWorkStatusText({ run }: { run: CrewRunView }) {
  useLocale();
  const state = crewExecutionState(run);
  const attention = crewOpenAttention(run);
  const running = run.status !== "finished" && crewHasRunningWork(run);
  const named = namedState(state, true);
  if (!named && !attention) return null;
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
      {running ? <WorkingIndicator size="xs" /> : null}
      {named ? <span>{crewExecutionLabel(state)}</span> : null}
      {named && attention ? <span aria-hidden="true">·</span> : null}
      {attention ? (
        <Badge tone={attentionTone(attention)} size="xs">
          {crewAttentionLabel(attention)}
        </Badge>
      ) : null}
    </span>
  );
}

/** Progress for lists: tasks done, or planning; "no assignments yet" is left out as filler. */
export function crewQuietProgress(run: CrewRunView) {
  return run.tasks.length || (run.status === "active" && run.coordinatorStatus === "running")
    ? crewProgressLabel(run)
    : "";
}

/** Last change of the work record; the full date stays in the tooltip. */
export function CrewWorkUpdated({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-ui-caption text-(--ui-text-muted)">
      <Clock aria-hidden="true" className="icon-xs shrink-0" />
      <Timestamp value={value} />
    </span>
  );
}
