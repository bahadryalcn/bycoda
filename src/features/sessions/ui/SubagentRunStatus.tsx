import { useT } from "../../../shared/i18n";
import { CircleAlert } from "../../../shared/ui/icons";
import { StepStrip } from "../../../shared/ui/StepStrip";
import { Text, type TextTone } from "../../../shared/ui/Text";
import type { DockAgentStatus } from "../model/activityDock";
import type { SubagentStepStrip } from "../model/subagentStepStrip";
import { AgentClock } from "./AgentClock";
import { AgentStatusDot } from "./AgentStatusDot";
import { lifecycleLabel } from "./SubagentAnatomy";
import styles from "./SubagentRow.module.css";

/** Ink stays quiet while a run is fine; only states that want attention take a colour. */
const STATUS_TONE: Record<DockAgentStatus, TextTone> = {
  running: "primary",
  done: "muted",
  failed: "danger",
  stopped: "warning",
  interrupted: "warning",
};

/** What a screen reader hears for the row, since the strip and its marks are visual. */
export function subagentRunDescription(
  label: string,
  strip: SubagentStepStrip,
  runFailed: boolean,
  t: ReturnType<typeof useT>,
): string {
  const steps = strip.total === 1 ? "1 step" : t("{p0} steps", { p0: strip.total });
  return [
    label,
    strip.total ? steps : "",
    strip.failed && !runFailed ? t("{p0} failed", { p0: strip.failed }) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** A run's state, clock and recent steps, on the row's trailing side. */
export function SubagentRunStatus({
  status,
  needsInput,
  startedAt,
  endedAt,
  strip,
}: {
  status: DockAgentStatus;
  needsInput: boolean;
  startedAt?: number;
  endedAt?: number;
  strip: SubagentStepStrip;
}) {
  const t = useT();
  const waiting = status === "running" && needsInput;
  const label = waiting
    ? t("Needs input")
    : status === "stopped"
      ? t("Stopped")
      : lifecycleLabel(status, t);
  return (
    <span className={styles.status} data-subagent-state data-subagent-lifecycle={status}>
      <span className={styles.statusLine}>
        <span className={styles.state}>
          {waiting ? (
            <CircleAlert className="icon-xs shrink-0" tone="warning" strokeWidth={2} />
          ) : (
            <AgentStatusDot status={status} />
          )}
          <Text
            size="caption"
            weight="medium"
            tone={waiting ? "warning" : STATUS_TONE[status]}
            truncate
          >
            {label}
          </Text>
        </span>
        <Text size="micro" tone="muted" className="shrink-0">
          <AgentClock startedAt={startedAt} endedAt={endedAt} live={status === "running"} />
        </Text>
      </span>
      <span className={styles.rail}>
        <StepStrip cells={strip.cells} className={styles.strip} />
        {strip.total ? (
          <Text size="micro" tone="muted" className={`${styles.count} tabular-nums`}>
            {strip.total}
            {strip.failed && status !== "failed" ? (
              <Text size="inherit" tone="danger" weight="medium">
                ×{strip.failed}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </span>
    </span>
  );
}
