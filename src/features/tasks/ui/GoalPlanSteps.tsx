import { type ReactNode, useState } from "react";
import { t } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { Check, RotateCcw } from "../../../shared/ui/icons";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { BoardGoal } from "../model/goalClient";
import { projectDisplayName } from "../../projects/public/projectNames";
import "./task-goals.css";

/** The plan a goal proposes, one numbered step per task with its project and dependencies. */
export function GoalPlanSteps({ goal }: { goal: BoardGoal }) {
  if (goal.status !== "awaiting-approval" || !goal.plan) return null;
  const tasks = goal.plan.tasks;
  const projectOf = (id: string | undefined, path: string) =>
    goal.projects.find((project) => project.id === id)?.name ?? projectDisplayName(path);
  const titleOf = (key: string) => tasks.find((task) => task.key === key)?.title ?? key;
  return (
    <div className="grid min-w-0 gap-1">
      <SectionLabel as="h4" count={tasks.length}>
        {t("Plan")}
      </SectionLabel>
      <ol aria-label={t("Plan")} className="goal-plan">
        {tasks.map((task, index) => (
          <li key={task.key} title={task.prompt} className="goal-plan-step">
            <span aria-hidden className="goal-plan-index">
              {index + 1}
            </span>
            <span className="goal-plan-text">
              <span className="goal-plan-title">{task.title}</span>
              <span className="goal-plan-meta">
                {t("in ")}
                {projectOf(task.projectId, task.project)}
              </span>
              {task.dependsOn.length ? (
                <span className="goal-plan-meta">
                  <span className="shrink-0">{t("· after ")}</span>
                  <BadgeList
                    label={t("After")}
                    size="xs"
                    max={2}
                    className="min-w-0"
                    items={task.dependsOn.map((key, position) => {
                      const title = titleOf(key);
                      return { id: `${position}:${title}`, label: title };
                    })}
                  />
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Approve and replan for a plan waiting on the owner, or a planning run that failed. */
export function GoalApprovalBar({
  goal,
  busy,
  onApprove,
  onReplan,
  onError,
}: {
  goal: BoardGoal;
  busy: boolean;
  onApprove: () => void;
  onReplan: (feedback: string) => Promise<unknown>;
  onError: (reason: unknown) => void;
}): ReactNode {
  const [replanning, setReplanning] = useState(false);
  const [feedback, setFeedback] = useState("");
  const failedPlanning = goal.status === "blocked" && goal.taskIds.length === 0;
  const awaiting = goal.status === "awaiting-approval";
  const canReplan = awaiting || failedPlanning;
  if (!canReplan) return null;
  return (
    <>
      <div className="goal-card-buttons">
        {awaiting ? (
          <Button
            variant="primary"
            size="sm"
            startIcon={<Check />}
            disabled={busy}
            onClick={onApprove}
          >
            {t("Approve")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          startIcon={<RotateCcw />}
          disabled={busy}
          aria-expanded={replanning}
          onClick={() => setReplanning((open) => !open)}
        >
          {t("Replan")}
        </Button>
      </div>
      {replanning ? (
        <form
          aria-label={t("Replan")}
          className="goal-replan"
          onSubmit={(event) => {
            event.preventDefault();
            onReplan(feedback)
              .then(() => {
                setReplanning(false);
                setFeedback("");
              })
              .catch(onError);
          }}
        >
          <TextareaField
            hideLabel
            label=""
            autoFocus
            aria-label={t("Plan feedback")}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("What should the plan do differently? (optional)")}
            rows={2}
            fieldClassName="min-w-0 flex-1"
            className="resize-y"
          />
          <Button variant="primary" type="submit" disabled={busy}>
            {t("Plan again")}
          </Button>
        </form>
      ) : null}
    </>
  );
}
