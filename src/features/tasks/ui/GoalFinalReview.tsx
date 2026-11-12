import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { GOAL_FINAL_ACCEPTANCE_CRITERIA, goalPlanReviews } from "../model/hostGoals";
import type { BoardGoal } from "../model/goalClient";
import { TaskAcceptanceEvidence } from "./TaskAcceptanceEvidence";
import "./task-goals.css";

/** Final goal acceptance: its state, note, evidence and the owner's recovery actions. */
export function GoalFinalReview({
  goal,
  busy,
  onRecheckFinal,
  onOpenFinal,
}: {
  goal: BoardGoal;
  busy: boolean;
  onRecheckFinal?: () => void;
  onOpenFinal?: () => void;
}) {
  if (!goal.finalReview) return null;
  // A single-task or simple plan runs no final review, so there is nothing to show.
  if (!goal.finalAcceptance && goal.plan && !goalPlanReviews(goal).final) return null;
  return (
    <div className="grid min-w-0 gap-2">
      <p role="status">
        {t("Final goal acceptance")}:{" "}
        {t(
          goal.finalAcceptance?.status === "passed"
            ? "Verified"
            : goal.finalAcceptance?.status === "failed"
              ? "Failed"
              : goal.finalAcceptance?.status === "running"
                ? "Running"
                : "Queued",
        )}
      </p>
      {goal.finalAcceptance?.note ? (
        <Text as="p" tone="secondary" size="inherit" className="break-words">
          {goal.finalAcceptance.note}
        </Text>
      ) : null}
      <div className="goal-card-buttons">
        {goal.finalAcceptance?.sessionId && onOpenFinal ? (
          <Button variant="secondary" size="sm" onClick={onOpenFinal}>
            {t("Open final review")}
          </Button>
        ) : null}
        {goal.finalAcceptance?.status === "failed" && onRecheckFinal ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || goal.stale || !goal.finalReviewSupported}
            onClick={onRecheckFinal}
          >
            {t("Recheck final acceptance")}
          </Button>
        ) : null}
      </div>
      {goal.finalAcceptance?.acceptance ? (
        <TaskAcceptanceEvidence
          task={{
            prompt: JSON.stringify({
              schema: "bycoda.task.v1",
              objective: goal.prompt,
              deliverables: [],
              acceptance: GOAL_FINAL_ACCEPTANCE_CRITERIA,
              constraints: [],
              verification: [],
            }),
            verification: { acceptance: goal.finalAcceptance.acceptance },
          }}
          onOpenReview={() => onOpenFinal?.()}
        />
      ) : null}
    </div>
  );
}
