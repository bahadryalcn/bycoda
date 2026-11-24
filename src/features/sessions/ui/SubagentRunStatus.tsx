import { useT } from "../../../shared/i18n";
import { CircleAlert } from "../../../shared/ui/icons";
import { Progress } from "../../../shared/ui/Progress";
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

const PROGRESS_TONE: Record<DockAgentStatus, "accent" | "success" | "danger" | "warning"> = {
  running: "accent",
  done: "success",
  failed: "danger",
  stopped: "warning",
  interrupted: "warning",
};

/**
 * A run has no known total, so the bar only states where it stands: moving while it runs
 * (never a made-up percentage), full once it ended, in the role of how it ended.
 */
function SubagentProgress({ status, label }: { status: DockAgentStatus; label: string }) {
  return (
    <Progress
      compact
      tone={PROGRESS_TONE[status]}
      value={status === "running" ? undefined : 100}
      aria-label={label}
      className={styles.progress}
    />
  );
}

/** "12 steps", with the failed ones apart from the run's own outcome. */
function StepCount({ strip, status }: { strip: SubagentStepStrip; status: DockAgentStatus }) {
  const t = useT();
  if (!strip.total) return null;
  return (
    <>
      {strip.total === 1 ? t("1 step") : t("{p0} steps", { p0: strip.total })}
      {strip.failed && status !== "failed" ? (
        <Text size="inherit" tone="danger" weight="medium">
          {" "}
          {t("{p0} failed", { p0: strip.failed })}
        </Text>
      ) : null}
    </>
  );
}

/**
 * A run's state, clock and recent steps, on the row's trailing side. `list` lays the state,
 * progress bar and elapsed time and steps into the columns of the row list; `card` lays the state
 * line and bar into the last two tracks of a card.
 */
export function SubagentRunStatus({
  status,
  needsInput,
  startedAt,
  endedAt,
  strip,
  layout = "row",
}: {
  status: DockAgentStatus;
  needsInput: boolean;
  startedAt?: number;
  endedAt?: number;
  strip: SubagentStepStrip;
  layout?: "row" | "list" | "card";
}) {
  const t = useT();
  const waiting = status === "running" && needsInput;
  const label = waiting
    ? t("Needs input")
    : status === "stopped"
      ? t("Stopped")
      : lifecycleLabel(status, t);
  const state = (
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
  );
  const clock = <AgentClock startedAt={startedAt} endedAt={endedAt} live={status === "running"} />;
  if (layout !== "row") {
    // The wrapper only carries the data hooks; its children are placed by the host's grid.
    return (
      <span className={styles.statusParts} data-subagent-state data-subagent-lifecycle={status}>
        {layout === "list" ? (
          <>
            <span className={styles.listState}>{state}</span>
            <span className={styles.listProgress}>
              <SubagentProgress status={status} label={label} />
            </span>
            <Text size="micro" tone="muted" truncate className={`${styles.listMeta} tabular-nums`}>
              {clock}
              {strip.total ? " · " : null}
              <StepCount strip={strip} status={status} />
            </Text>
          </>
        ) : (
          <>
            <span className={styles.cardState}>
              {state}
              <Text size="micro" tone="muted" truncate className="tabular-nums">
                {clock}
                {strip.total ? " · " : null}
                <StepCount strip={strip} status={status} />
              </Text>
            </span>
            <SubagentProgress status={status} label={label} />
          </>
        )}
      </span>
    );
  }
  return (
    <span className={styles.status} data-subagent-state data-subagent-lifecycle={status}>
      <span className={styles.statusLine}>
        {state}
        <Text size="micro" tone="muted" className="shrink-0">
          {clock}
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
