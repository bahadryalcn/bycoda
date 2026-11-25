import { TaskModelChoiceLabel } from "./TaskModelChoiceLabel";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Surface } from "../../../shared/ui/Surface";
import { InlineError } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Fragment, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MessageSquare, Pencil, Square, Trash2 } from "../../../shared/ui/icons";
import { Progress } from "../../../shared/ui/Progress";
import { Spinner } from "../../../shared/ui/Spinner";
import { type BoardGoal } from "../model/goalClient";
import { goalProgress } from "../model/hostGoals";
import type { BoardTask } from "../model/taskClient";
import { TaskBudgetUsage } from "./TaskBudgetControls";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { GoalFinalReview } from "./GoalFinalReview";
import { GoalApprovalBar, GoalPlanSteps } from "./GoalPlanSteps";
import { MetaLine } from "./TaskStatusLine";
import "./task-goals.css";

/** One epic as a compact card: its title, how many of its tasks are done, one muted line about
 * where it runs, the planner and an overflow. A plan waiting for approval, a blocked epic and a
 * failed final acceptance open their details at once so the owner's next step is in view; any
 * other epic opens them from the chevron. */
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
  // The owner's own choice; until then the epic opens when it needs the owner.
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const progress = goalProgress(goal, tasks);
  const reason = goal.planError ?? goal.error;
  const finished = goal.status === "done" || goal.status === "cancelled";
  const hasDetails =
    !finished ||
    Boolean(
      goal.budgetUsage ||
      goal.budgetStop ||
      goal.budget ||
      (goal.finalAcceptance &&
        (goal.finalAcceptance.status === "passed" || goal.finalAcceptance.status === "failed")),
    );
  const needsOwner =
    goal.status === "awaiting-approval" ||
    goal.status === "blocked" ||
    (goal.status !== "cancelled" &&
      goal.finalAcceptance != null &&
      goal.finalAcceptance.status !== "passed");
  const open = hasDetails && (chosenOpen ?? needsOwner);
  const canEdit = !finished;
  const canCancel = !finished;
  const canDelete = goal.status !== "planning" && goal.status !== "running";
  const hasSessions = goal.taskIds.length > 0;
  const projects = goal.projects.map((project) => project.name).join(", ");
  const meta = [
    progress.total > 0 ? (
      <span key="progress" className="goal-card-progress">
        <Progress
          compact
          aria-label={t("Epic progress")}
          value={progress.done}
          max={progress.total}
          tone={
            goal.status === "blocked" ? "danger" : goal.status === "done" ? "success" : "neutral"
          }
        />
        <span>{t("{p0}/{p1} done", { p0: progress.done, p1: progress.total })}</span>
      </span>
    ) : null,
    projects ? (
      <OverflowTooltip key="projects" label={projects}>
        <Text
          size="inherit"
          tone="inherit"
          leading="inherit"
          truncate
          className="goal-card-projects"
        >
          {projects}
        </Text>
      </OverflowTooltip>
    ) : null,
    <Fragment key="model">
      {goal.modelChoice && goal.modelChoice.kind !== "fixed" ? (
        <>
          <TaskModelChoiceLabel choice={goal.modelChoice} machineId={goal.machineId} /> ·{" "}
        </>
      ) : null}
      <ModelLabel harness={goal.harness} model={goal.model} />
    </Fragment>,
    goal.machineName,
    goal.stale && !goal.pendingRefresh ? (
      <Text key="offline" size="inherit" tone="warning" leading="inherit">
        {t("Offline")}
      </Text>
    ) : null,
  ].filter(Boolean);
  const menuItems = [
    ...(canEdit
      ? [
          {
            kind: "item" as const,
            id: "edit",
            label: t("Edit"),
            icon: <Pencil className="icon-xs" />,
            disabled: busy || Boolean(goal.stale) || !goal.settingsSupported,
            description: goal.settingsSupported
              ? undefined
              : t("Update the selected host to edit epic settings."),
          },
        ]
      : []),
    ...(hasSessions
      ? [
          {
            kind: "item" as const,
            id: "sessions",
            label: t("Task sessions"),
            icon: <MessageSquare className="icon-xs" />,
          },
        ]
      : []),
    ...((canEdit || hasSessions) && (canCancel || canDelete) ? [{ kind: "sep" as const }] : []),
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
  ];
  return (
    <Surface
      as="article"
      variant="canvas"
      padding="sm"
      aria-label={goal.title}
      data-goal-status={goal.status}
      aria-busy={pending || undefined}
      className="goal-card"
    >
      <ActionHost
        variant="row"
        interactionTone="neutral"
        pressFeedback={false}
        className="goal-card-head"
      >
        <div className="goal-card-main">
          <div className="goal-card-title-row">
            <Tooltip label={goal.prompt} asChild>
              <Heading size="item" className="goal-card-title" truncate>
                {goal.title}
              </Heading>
            </Tooltip>
            {goal.status === "running" || goal.status === "done" ? null : (
              <GoalStatusBadge status={goal.status} />
            )}
          </div>
          <Text as="div" size="caption" tone="muted" leading="inherit" className="goal-card-meta">
            <MetaLine parts={meta} />
          </Text>
        </div>
        <div className="goal-card-actions">
          {pending ? <Spinner size="xs" tone="secondary" delay className="mx-1.5" /> : null}
          {onOpenPlanner ? (
            <Button variant="secondary" size="sm" onClick={onOpenPlanner}>
              {t("Open planner")}
            </Button>
          ) : null}
          {menuItems.length > 0 ? (
            <InlineMoreAction
              reveal="always"
              label={t("More actions")}
              expanded={menuAnchor !== null}
              onOpen={setMenuAnchor}
            />
          ) : null}
          {menuAnchor ? (
            <DropdownMenu
              anchor={menuAnchor}
              label={t("More actions")}
              onClose={() => setMenuAnchor(null)}
              items={menuItems}
              onPick={(id) => {
                if (id === "sessions") onSessions();
                else if (busy) return;
                else if (id === "edit") onEdit();
                else if (id === "cancel") onCancel();
                else if (id === "delete") onDelete();
              }}
            />
          ) : null}
        </div>
      </ActionHost>
      {goal.status === "blocked" && reason ? (
        <InlineError className="goal-card-reason" details={reason} />
      ) : null}
      {/* Disclosure keeps its body mounted while closed, so a replan draft survives collapsing. */}
      {hasDetails ? (
        <Disclosure
          variant="compact"
          summary={t("Details")}
          open={open}
          onOpenChange={setChosenOpen}
          className="goal-card-body"
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
        </Disclosure>
      ) : null}
    </Surface>
  );
}
