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
  type CrewAttention,
  type CrewExecutionState,
} from "../model/crewPresentation";

export function executionTone(state: CrewExecutionState): BadgeTone {
  return state === "finished" ? "success" : state === "working" ? "info" : "neutral";
}

export function attentionTone(attention: CrewAttention): BadgeTone {
  return attention === "blocked" ? "danger" : "warning";
}

/**
 * Execution state and, separately, what needs the owner (CR-W04). A paused run
 * with an open decision shows both, e.g. "Paused" and "Needs decision".
 * Running work shows the shared working signal even while new assignments are paused.
 */
export function CrewWorkBadges({ run, size = "sm" }: { run: CrewRunView; size?: BadgeSize }) {
  useLocale();
  const state = crewExecutionState(run);
  const attention = crewOpenAttention(run);
  const running = run.status !== "finished" && crewHasRunningWork(run);
  return (
    <>
      <Badge
        tone={executionTone(state)}
        size={size}
        icon={running ? <WorkingIndicator size="xs" /> : undefined}
      >
        {crewExecutionLabel(state)}
      </Badge>
      {attention ? (
        <Badge tone={attentionTone(attention)} size={size}>
          {crewAttentionLabel(attention)}
        </Badge>
      ) : null}
    </>
  );
}

/** Plain-text form for the sidebar: "Paused · Needs decision", attention in its tone ink. */
export function CrewWorkStatusText({ run }: { run: CrewRunView }) {
  useLocale();
  const state = crewExecutionState(run);
  const attention = crewOpenAttention(run);
  const running = run.status !== "finished" && crewHasRunningWork(run);
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
      {running ? <WorkingIndicator size="xs" /> : null}
      <span>{crewExecutionLabel(state)}</span>
      {attention ? (
        <>
          <span aria-hidden="true">·</span>
          <span
            className={
              attention === "blocked" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-tone-warning-fg)"
            }
          >
            {crewAttentionLabel(attention)}
          </span>
        </>
      ) : null}
    </span>
  );
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
