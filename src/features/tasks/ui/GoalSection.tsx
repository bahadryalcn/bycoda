import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useRef } from "react";
import { t } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { approveGoal, goalKey, recheckGoalFinalReview, replanGoal } from "../model/goalClient";
import type { BoardTask } from "../model/taskClient";
import { GoalCard } from "./GoalCard";
import { ALL_GOALS, type TaskGoalsController } from "./TaskGoalsController";
import "./task-goals.css";

/** Goals above the board, filtered to the one the owner is looking at. */
export function GoalList({
  goals,
  filter,
  tasks,
  acting,
  revealKey,
}: {
  goals: TaskGoalsController;
  filter: string;
  tasks: BoardTask[];
  acting: string | null;
  revealKey?: string;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (revealKey && disclosure.current) {
      disclosure.current.open = true;
      disclosure.current.scrollIntoView?.({ block: "nearest" });
    }
  }, [revealKey]);
  return (
    <Disclosure
      ref={disclosure}
      variant="row"
      size="sm"
      {...surfaceAttributes({ frame: "neutral", edge: "bottom" }, "task-goals-disclosure")}
      summary={t("Goals")}
      count={goals.goals.length}
    >
      <ul aria-label={t("Goals")} className="goal-list">
        {goals.goals
          .filter((goal) => filter === ALL_GOALS || goalKey(goal.machineId, goal.id) === filter)
          .map((goal) => {
            const key = goalKey(goal.machineId, goal.id);
            return (
              <li key={key}>
                <GoalCard
                  goal={goal}
                  tasks={tasks.filter((task) => task.machineId === goal.machineId)}
                  busy={acting != null}
                  pending={acting === `goal:${key}`}
                  onApprove={() => goals.actOn(goal, () => approveGoal(goal)).catch(goals.report)}
                  onEdit={() => goals.startEditing(goal)}
                  onReplan={(feedback) => goals.actOn(goal, () => replanGoal(goal, feedback))}
                  onError={goals.report}
                  onCancel={() => goals.cancel(goal)}
                  onDelete={() => goals.remove(goal)}
                  onSessions={() => goals.setSessionsFor(goal)}
                  onOpenPlanner={goal.plannerSessionId ? () => goals.openPlanner(goal) : undefined}
                  onRecheckFinal={() =>
                    goals.actOn(goal, () => recheckGoalFinalReview(goal)).catch(goals.report)
                  }
                  onOpenFinal={() => goals.openFinal(goal)}
                />
              </li>
            );
          })}
      </ul>
    </Disclosure>
  );
}
