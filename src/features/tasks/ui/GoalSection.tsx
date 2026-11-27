import { useEffect, useRef } from "react";
import { t } from "../../../shared/i18n";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { approveGoal, goalKey, recheckGoalFinalReview, replanGoal } from "../model/goalClient";
import type { BoardTask } from "../model/taskClient";
import { GoalCard } from "./GoalCard";
import { ALL_GOALS, type TaskGoalsController } from "./TaskGoalsController";
import "./task-goals.css";

/** Epics above the tasks as compact cards, filtered to the one the owner is looking at. An epic
 * that needs the owner opens its details by itself, so nothing hides behind a closed heading. */
export function GoalList({
  goals,
  filter,
  tasks,
  acting,
  onOpenTask,
  revealKey,
}: {
  goals: TaskGoalsController;
  filter: string;
  tasks: BoardTask[];
  acting: string | null;
  onOpenTask: (task: BoardTask) => void;
  revealKey?: string;
}) {
  const section = useRef<HTMLElement>(null);
  // A reveal request (a notification or the epic filter) brings the epics into view.
  useEffect(() => {
    if (revealKey) section.current?.scrollIntoView?.({ block: "nearest" });
  }, [revealKey]);
  return (
    <section
      ref={section}
      aria-label={t("Epics")}
      {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "task-goals-section")}
    >
      <SectionLabel as="h2" count={goals.goals.length}>
        {t("Epics")}
      </SectionLabel>
      <ul aria-label={t("Epics")} className="goal-list">
        {goals.goals
          .filter((goal) => filter === ALL_GOALS || goalKey(goal.machineId, goal.id) === filter)
          .map((goal) => {
            const key = goalKey(goal.machineId, goal.id);
            return (
              <li key={key}>
                <GoalCard
                  goal={goal}
                  tasks={tasks.filter((task) => task.machineId === goal.machineId)}
                  onOpenTask={onOpenTask}
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
    </section>
  );
}
