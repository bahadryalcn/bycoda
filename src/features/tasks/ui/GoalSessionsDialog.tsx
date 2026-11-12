import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { taskSessionIds } from "../model/backgroundSession";
import type { BoardTask } from "../model/taskClient";
import { STATUS_LABELS } from "./TaskDetail";
import type { TaskGoalsController } from "./TaskGoalsController";
import "./task-goals.css";

/** A goal's worker and review sessions, each opened on its own host. */
export function GoalSessionsDialog({
  goals,
  tasks,
  onOpenSession,
}: {
  goals: TaskGoalsController;
  tasks: BoardTask[];
  onOpenSession: (task: BoardTask, sessionId: string) => void;
}) {
  const goal = goals.sessionsFor;
  if (!goal) return null;
  const goalTasks = tasks.filter(
    (task) => task.machineId === goal.machineId && task.goalId === goal.id,
  );
  return (
    <Modal
      title={t("Task sessions")}
      context={goal.title}
      size="lg"
      onClose={() => goals.setSessionsFor(null)}
    >
      <Text as="div" size="secondary" tone="inherit" className="grid">
        <SectionLabel count={goalTasks.length}>{t("Tasks")}</SectionLabel>
        {goalTasks.map((task) => {
          const sessions = taskSessionIds(task);
          return (
            <div key={task.id} className="goal-session-task">
              <div className="goal-session-head">
                <Text as="span" size="inherit" tone="inherit" weight="medium">
                  {task.title}
                </Text>
                <Badge size="sm" appearance="subtle">
                  {t(STATUS_LABELS[task.status])}
                </Badge>
              </div>
              <Text size="micro" tone="secondary" className="break-all">
                {task.branch} {task.worktreeCwd ?? task.workspace?.checkoutCwd ?? task.cwd}
              </Text>
              <div className="flex flex-wrap items-center gap-2">
                {sessions.worker ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      goals.setSessionsFor(null);
                      onOpenSession(task, sessions.worker!);
                    }}
                  >
                    {t("Open worker session")}
                  </Button>
                ) : (
                  <Text size="caption" tone="secondary">
                    {t("Session will appear when this task starts.")}
                  </Text>
                )}
                {sessions.review ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      goals.setSessionsFor(null);
                      onOpenSession(task, sessions.review!);
                    }}
                  >
                    {t("Open review session")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </Text>
    </Modal>
  );
}
