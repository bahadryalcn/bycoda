import { TaskModelChoiceLabel } from "./TaskModelChoiceLabel";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { InlineAction, InlineMoreAction, ActionHost } from "../../../shared/ui/ActionHost";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MessageSquare, Pencil, Sparkles, Square, Trash2 } from "../../../shared/ui/icons";
import { Progress } from "../../../shared/ui/Progress";
import { Spinner } from "../../../shared/ui/Spinner";
import { type BoardGoal } from "../model/goalClient";
import { goalProgress } from "../model/hostGoals";
import type { BoardTask } from "../model/taskClient";
import { TaskBudgetUsage } from "./TaskBudgetControls";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { GoalFinalReview } from "./GoalFinalReview";
import { GoalApprovalBar, GoalPlanSteps } from "./GoalPlanSteps";
import "./task-goals.css";

/** One goal above the board: where it stands, how many of its tasks are done,
 * and what the owner can do about it. A plan waiting for approval is shown in
 * full; a plan that failed shows why. */
export function GoalCard({
  goal,
  tasks,
  busy,
  pending,
  onApprove,
  onEdit,
  onReplan,
  onError,
  onCancel,
  onDelete,
  onOpenPlanner,
  onRecheckFinal,
  onOpenFinal,
  onSessions,
}: {
  goal: BoardGoal;
  /** The tasks on the goal's machine. */
  tasks: readonly BoardTask[];
  busy: boolean;
  pending: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReplan: (feedback: string) => Promise<unknown>;
  onError: (reason: unknown) => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenPlanner?: () => void;
  onRecheckFinal?: () => void;
  onOpenFinal?: () => void;
  onSessions: () => void;
}) {
  useLocale();
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const progress = goalProgress(goal, tasks);
  const reason = goal.planError ?? goal.error;
  const finished = goal.status === "done" || goal.status === "cancelled";
  const canCancel = !finished;
  const canDelete = goal.status !== "planning" && goal.status !== "running";
  return (
    <ActionHost
      as="article"
      aria-label={goal.title}
      data-goal-status={goal.status}
      aria-busy={pending || undefined}
      className="goal-card"
    >
      <div className="goal-card-head">
        <span
          aria-hidden
          {...surfaceAttributes({ radius: "control", variant: "fill-subtle" }, "goal-card-well")}
        >
          <Sparkles className="icon-sm" tone="secondary" />
        </span>
        <div className="goal-card-main">
          <div className="goal-card-title-row">
            <Tooltip label={goal.prompt} asChild>
              <Heading size="item" className="goal-card-title" truncate>
                {goal.title}
              </Heading>
            </Tooltip>
            <GoalStatusBadge status={goal.status} />
          </div>
          <Text as="p" size="caption" tone="secondary">
            <TaskModelChoiceLabel choice={goal.modelChoice} machineId={goal.machineId} /> ·{" "}
            <ModelLabel harness={goal.harness} model={goal.model} />
          </Text>
          <Text
            as="div"
            size="caption"
            tone="secondary"
            leading="inherit"
            className="goal-card-meta"
          >
            {progress.total > 0 ? (
              <span className="goal-card-progress">
                <Progress
                  compact
                  aria-label={t("Epic progress")}
                  value={progress.done}
                  max={progress.total}
                  tone={
                    goal.status === "blocked"
                      ? "danger"
                      : goal.status === "done"
                        ? "success"
                        : "neutral"
                  }
                />
                <span>
                  {progress.done}/{progress.total}
                  {t(" done")}
                </span>
              </span>
            ) : null}
            <span className="goal-card-projects">
              <BadgeList
                label={t("Projects")}
                size="xs"
                className="min-w-0 shrink"
                items={goal.projects.map((project, index) => ({
                  id: `${index}:${project.name}`,
                  label: project.name,
                }))}
              />
            </span>
            <Text
              size="inherit"
              tone="inherit"
              leading="inherit"
              truncate
              className="goal-card-machine"
            >
              {t(" · on")} {goal.machineName}
            </Text>
            {goal.stale ? (
              <Text size="inherit" tone="warning" leading="inherit" wrap="anywhere">
                {t(" (offline, last known)").trim()}
              </Text>
            ) : null}
          </Text>
        </div>
        <div className="goal-card-actions">
          {pending ? <Spinner size="xs" tone="secondary" className="mx-1.5" /> : null}
          {!finished ? (
            <InlineAction
              reveal="always"
              label={t("Edit epic settings")}
              disabled={busy || Boolean(goal.stale) || !goal.settingsSupported}
              tooltip={
                goal.settingsSupported
                  ? undefined
                  : t("Update the selected host to edit epic settings.")
              }
              onClick={onEdit}
            >
              <Pencil />
            </InlineAction>
          ) : null}
          {onOpenPlanner ? (
            <Button variant="ghost" size="sm" startIcon={<MessageSquare />} onClick={onOpenPlanner}>
              {t("Open planner")}
            </Button>
          ) : null}
          {goal.taskIds.length > 0 ? (
            <Button variant="ghost" size="sm" startIcon={<MessageSquare />} onClick={onSessions}>
              {t("Task sessions")}
            </Button>
          ) : null}
          {canCancel || canDelete ? (
            <InlineMoreAction
              reveal="always"
              label={t("More actions")}
              expanded={menuAnchor !== null}
              disabled={busy}
              onOpen={setMenuAnchor}
            />
          ) : null}
          {menuAnchor ? (
            <DropdownMenu
              anchor={menuAnchor}
              label={t("More actions")}
              onClose={() => setMenuAnchor(null)}
              items={[
                ...(canCancel
                  ? [
                      {
                        kind: "item" as const,
                        id: "cancel",
                        label: t("Cancel"),
                        disabled: busy,
                        icon: <Square className="icon-xs" />,
                      },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      {
                        kind: "item" as const,
                        id: "delete",
                        label: t("Delete"),
                        disabled: busy,
                        danger: true,
                        icon: <Trash2 className="icon-xs" />,
                      },
                    ]
                  : []),
              ]}
              onPick={(id) => {
                if (busy) return;
                if (id === "cancel") onCancel();
                else if (id === "delete") onDelete();
              }}
            />
          ) : null}
        </div>
      </div>
      {goal.status === "blocked" && reason ? (
        <Text as="p" size="caption" tone="danger" leading="inherit" className="goal-card-reason">
          {reason}
        </Text>
      ) : null}
      <Text
        as="div"
        size="caption"
        tone="inherit"
        leading="inherit"
        {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "goal-card-body")}
      >
        <GoalFinalReview
          goal={goal}
          busy={busy}
          onRecheckFinal={onRecheckFinal}
          onOpenFinal={onOpenFinal}
        />
        <TaskBudgetUsage usage={goal.budgetUsage} stop={goal.budgetStop} budget={goal.budget} />
        <GoalPlanSteps goal={goal} />
        <GoalApprovalBar
          goal={goal}
          busy={busy}
          onApprove={onApprove}
          onReplan={onReplan}
          onError={onError}
        />
      </Text>
    </ActionHost>
  );
}
