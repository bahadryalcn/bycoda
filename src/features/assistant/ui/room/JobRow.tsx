import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import type { AssistantJob } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import {
  ActionHost,
  actionContentAttributes,
  InlineAction,
  InlineMoreAction,
  InlineTextAction,
} from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Progress } from "../../../../shared/ui/Progress";
import { motionAttributes } from "../../../../shared/ui/Motion";
import { WorkingIndicator } from "../../../../shared/ui/WorkingIndicator";
import {
  AlertCircle,
  CheckCircle,
  CircleX,
  Clock,
  Pause,
  Play,
  Square,
} from "../../../../shared/ui/icons";
import { finished, jobStatusLabel, jobStatusTone } from "./assistantRoomHelpers";
import styles from "./Jobs.module.css";

type JobAction = "pause" | "resume" | "stop" | "delete" | "keep";

/** The start-of-row status mark: running work animates, every other state has its own icon. */
function JobStatusMark({ job }: { job: AssistantJob }) {
  const icon = "icon-sm";
  let mark;
  switch (job.status) {
    case "running":
    case "planning":
      mark = <WorkingIndicator size="sm" />;
      break;
    case "done":
      mark = <CheckCircle className={icon} aria-hidden />;
      break;
    case "failed":
      mark = <CircleX className={icon} aria-hidden />;
      break;
    case "waiting":
    case "stalled":
      mark = <AlertCircle className={icon} aria-hidden />;
      break;
    case "paused":
      mark = <Pause className={icon} aria-hidden />;
      break;
    case "cancelled":
      mark = <Square className={icon} aria-hidden />;
      break;
    default:
      mark = <Clock className={icon} aria-hidden />;
  }
  const tone = jobStatusTone(job);
  return (
    <Text
      as="span"
      size="inherit"
      tone={
        tone === "success" || tone === "danger" || tone === "warning" || tone === "info"
          ? tone
          : "secondary"
      }
      leading="inherit"
      className={styles.mark}
    >
      {mark}
    </Text>
  );
}

/** One row: status mark, title and project, steps meter with tokens, latest activity, and actions. Used by Jobs and Today. */
export function JobRow({
  onReviewTasks,
  onEdit,
  job,
  projectName,
  selected,
  selectionMode,
  busy,
  disabled,
  error,
  onSelect,
  onDetails,
  onControl,
}: {
  onReviewTasks?: () => void;
  onEdit?: (mode: "priority" | "replan") => void;
  job: AssistantJob;
  projectName: string;
  selected: boolean;
  /** Another row is selected: every checkbox stays visible. */
  selectionMode: boolean;
  busy: boolean;
  disabled: boolean;
  error: string;
  onSelect: (selected: boolean) => void;
  onDetails: () => void;
  onControl: (action: JobAction) => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const isFinished = finished(job);
  const { done, total } = job.progress;
  const canToggle = !isFinished && !job.awaitingOwnerRestart && !job.pendingTaskDeletion;
  const caption = [
    jobStatusLabel(job),
    total > 0 ? `${done}/${total}` : "",
    job.tokens > 0 ? t("{p0} tokens", { p0: formatNumber(job.tokens) }) : "",
  ].filter(Boolean);
  return (
    <ActionHost className={styles.row} selected={selected}>
      <Checkbox
        {...motionAttributes({ transition: "opacity", easing: "standard" })}
        {...actionContentAttributes(
          {
            phase: selectionMode || selected ? "always" : "interaction",
            hide: "opacity",
            focus: "within",
          },
          styles.check,
        )}
        data-action-inline=""
        data-visible={selectionMode || selected || undefined}
        aria-label={t("Select {p0}", { p0: job.title })}
        checked={selected}
        onChange={(event) => onSelect(event.currentTarget.checked)}
      />
      <JobStatusMark job={job} />
      <div className={styles.main}>
        <div className={styles.titleLine}>
          <Button
            variant="link"
            className={styles.title}
            truncate
            textSize="body"
            weight="medium"
            tooltip={job.title}
            tooltipWhen="overflow"
            onClick={onDetails}
          >
            {job.title}
          </Button>
          {projectName && (
            <Badge size="sm" tone="neutral" truncate className={styles.project}>
              {projectName}
            </Badge>
          )}
        </div>
        <Text
          as="div"
          size="caption"
          tone="secondary"
          leading="inherit"
          className={styles.progressLine}
        >
          {total > 0 && (
            <Progress
              compact
              aria-label={t("Progress")}
              value={done}
              max={total}
              aria-valuetext={`${done}/${total}`}
              tone={job.status === "failed" ? "danger" : "accent"}
            />
          )}
          <span>{caption.join(" · ")}</span>
        </Text>
        {job.summary && (
          <Text
            as="p"
            size="caption"
            tone="secondary"
            leading="inherit"
            truncate
            className={styles.caption}
          >
            {job.summary}
          </Text>
        )}
        {job.dispatchState === "unknown" && (
          <InlineError>
            {t("Dispatch status unknown. Check the linked epic before retrying.")}
          </InlineError>
        )}
        {error && <InlineError>{error}</InlineError>}
      </div>
      <div className={styles.actions}>
        {job.pendingTaskDeletion && (
          <InlineTextAction disabled={disabled} onClick={() => onControl("keep")}>
            {t("Keep job and tasks")}
          </InlineTextAction>
        )}
        {job.awaitingOwnerRestart && onReviewTasks && (
          <InlineTextAction disabled={disabled} onClick={onReviewTasks}>
            {t("Review tasks")}
          </InlineTextAction>
        )}
        {canToggle && (
          <InlineAction
            reveal="always"
            label={t(job.status === "paused" ? "Resume" : "Pause")}
            loading={busy}
            disabled={disabled}
            onClick={() => onControl(job.status === "paused" ? "resume" : "pause")}
          >
            {job.status === "paused" ? (
              <Play className="icon-sm" aria-hidden />
            ) : (
              <Pause className="icon-sm" aria-hidden />
            )}
          </InlineAction>
        )}
        <InlineMoreAction
          reveal="always"
          label={t("Job actions")}
          expanded={Boolean(menu)}
          loading={busy && !canToggle}
          disabled={disabled}
          onOpen={setMenu}
        />
      </div>
      {menu && (
        <DropdownMenu
          label={t("Job actions")}
          anchor={menu}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "details") onDetails();
            else if (id === "priority" || id === "replan") onEdit?.(id);
            else if (id === "review-tasks") onReviewTasks?.();
            else onControl(id as JobAction);
          }}
          items={[
            { kind: "item", id: "details", label: t("Details") },
            ...(onEdit ? [{ kind: "item" as const, id: "priority", label: t("Priority") }] : []),
            ...(onEdit &&
            !isFinished &&
            job.status !== "paused" &&
            job.goalId &&
            !job.pendingTaskDeletion &&
            !job.awaitingOwnerRestart
              ? [{ kind: "item" as const, id: "replan", label: t("Replan") }]
              : []),
            ...(job.awaitingOwnerRestart && onReviewTasks
              ? [{ kind: "item" as const, id: "review-tasks", label: t("Review tasks") }]
              : []),
            ...(job.pendingTaskDeletion
              ? [{ kind: "item" as const, id: "keep", label: t("Keep job and tasks") }]
              : !isFinished
                ? [
                    { kind: "item" as const, id: "stop", label: t("Stop job") },
                    ...(job.awaitingOwnerRestart
                      ? []
                      : [
                          {
                            kind: "item" as const,
                            id: job.status === "paused" ? "resume" : "pause",
                            label: t(job.status === "paused" ? "Resume" : "Pause"),
                          },
                        ]),
                  ]
                : []),
            { kind: "sep" },
            { kind: "item", id: "delete", label: t("Delete..."), danger: true },
          ]}
        />
      )}
    </ActionHost>
  );
}
