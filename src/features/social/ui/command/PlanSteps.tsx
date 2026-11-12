import { Code } from "../../../../shared/ui/Code";
import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Surface } from "../../../../shared/ui/Surface";
import { TechnicalDetails } from "../common/TechnicalDetails";
import type { AiPlan } from "../../model/socialActions";
import { pendingApprovalIds, stepStatusLabel, type StepResult } from "./commandModel";

export type PlanStepsProps = {
  plan: AiPlan;
  results: Record<string, StepResult>;
  approved: string[];
  busy: boolean;
  onApprove: (ids: string[]) => void;
  onRun: () => void;
};

/** The planned steps in order, each with what the Host will do with it, and the plan's run action. */
export function PlanSteps({ plan, results, approved, busy, onApprove, onRun }: PlanStepsProps) {
  const pending = pendingApprovalIds(plan.steps, results).filter((id) => !approved.includes(id));
  return (
    <Surface as="section" variant="card" className="command-plan" aria-label={t("Plan")}>
      <ol className="command-steps">
        {plan.steps.map((step) => {
          const result = results[step.id];
          const isApproved = approved.includes(step.id);
          return (
            <li key={step.id} className="command-step">
              <div className="command-step-head">
                <Text
                  size="secondary"
                  tone="primary"
                  leading="inherit"
                  className="command-step-summary"
                >
                  {step.summary}
                </Text>
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className="command-step-status"
                >
                  {stepStatusLabel(step, result, isApproved)}
                </Text>
              </div>
              {result?.message ? (
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className="command-step-reason"
                >
                  {result.message}
                </Text>
              ) : null}
              {!result && step.reason ? (
                <Text
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className="command-step-reason"
                >
                  {step.reason}
                </Text>
              ) : null}
              {pending.includes(step.id) ? (
                <Button variant="secondary" size="sm" onClick={() => onApprove([step.id])}>
                  {t("Approve")}
                </Button>
              ) : null}
              <TechnicalDetails>
                <Code>{step.action}</Code>
              </TechnicalDetails>
            </li>
          );
        })}
      </ol>
      <div className="command-plan-actions">
        {pending.length > 0 ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onApprove(pending)}>
            {t("Approve all")}
          </Button>
        ) : null}
        <Button variant="primary" size="sm" loading={busy} onClick={onRun}>
          {t("Run plan")}
        </Button>
      </div>
    </Surface>
  );
}
