import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { ApprovalRequest } from "../../../shared/ui/ApprovalRequest";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import {
  recipeCursor,
  type RecipeInstance,
  type RecipeStepResult,
} from "../model/automationRecipe";

type StepStatus = RecipeStepResult["status"] | "pending";

const STEP_STATUS: Record<StepStatus, { label: () => string; tone: StatusTextTone }> = {
  pending: { label: () => t("Pending"), tone: "idle" },
  running: { label: () => t("Running"), tone: "running" },
  awaiting: { label: () => t("Needs you"), tone: "needs-you" },
  succeeded: { label: () => t("Succeeded"), tone: "done" },
  failed: { label: () => t("Failed"), tone: "failed" },
  declined: { label: () => t("Declined"), tone: "failed" },
  cancelled: { label: () => t("Cancelled"), tone: "idle" },
};

/** Why an instance stopped, from its structured stop; the step's own title names where. */
function stopText(instance: RecipeInstance): string | null {
  const stop = instance.stop;
  if (!stop) return null;
  const title = instance.steps[stop.stepIndex]?.title ?? "";
  switch (stop.code) {
    case "decision_declined":
      return t("Declined at {p0}", { p0: title });
    case "owner_stopped":
      return t("Stopped at {p0}", { p0: title });
    case "step_uncertain":
      return t("The outcome of {p0} is unknown, so it was not repeated", { p0: title });
    case "step_stopped":
      return stop.message
        ? t("{p0} stopped: {p1}", { p0: title, p1: stop.message })
        : t("{p0} stopped", { p0: title });
  }
}

/**
 * The steps of one recipe occurrence with their status and task, the version it runs on and, while
 * it waits on an owner decision, the approve and decline actions.
 */
export function RecipeRunSteps({
  instance,
  running,
  onOpenTask,
  onDecide,
}: {
  instance: RecipeInstance;
  running: boolean;
  onOpenTask?: (taskId: string) => void | Promise<void>;
  /** Resolves once the Host recorded the answer; the caller refreshes the history. */
  onDecide?: (approve: boolean) => Promise<void>;
}) {
  useLocale();
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = recipeCursor(instance);
  const awaiting = running && instance.results[cursor]?.status === "awaiting";
  const decide = async (approve: boolean) => {
    if (!onDecide || pending !== null) return;
    setPending(approve);
    setError(null);
    try {
      await onDecide(approve);
    } catch (cause) {
      setError(presentRemoteError(cause, { explicit: true }) ?? t("Could not save the decision."));
    } finally {
      setPending(null);
    }
  };
  const stop = stopText(instance);
  return (
    <div className="grid min-w-0 gap-1 px-4 pb-3">
      <Text size="micro" tone="muted">
        {t("Version {p0}", { p0: instance.version })}
      </Text>
      <ol className="grid min-w-0 gap-1">
        {instance.steps.map((step, index) => {
          const result = instance.results[index];
          const status = STEP_STATUS[result?.status ?? "pending"];
          const taskId = result?.taskId;
          return (
            <li key={step.id} className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <Text size="micro" tone="muted" className="w-5 shrink-0 text-center tabular-nums">
                  {index + 1}
                </Text>
                <Text size="secondary" tone="neutral" truncate className="min-w-0 flex-1">
                  {step.title}
                </Text>
                <StatusText tone={status.tone} className="shrink-0 whitespace-nowrap">
                  {status.label()}
                </StatusText>
                {taskId && onOpenTask ? (
                  <Button variant="ghost" type="button" onClick={() => void onOpenTask(taskId)}>
                    {t("Open task")}
                  </Button>
                ) : null}
              </div>
              {result?.summary ? (
                <Text size="micro" tone="muted" truncate className="ps-8">
                  {result.summary}
                </Text>
              ) : null}
            </li>
          );
        })}
      </ol>
      {awaiting && onDecide ? (
        <ApprovalRequest
          title={instance.steps[cursor]?.title ?? ""}
          detail={
            instance.steps[cursor]?.kind === "decision" ? instance.steps[cursor].question : ""
          }
          allow={{
            label: t("Approve"),
            onClick: () => void decide(true),
            pending: pending === true,
            disabled: pending !== null,
          }}
          deny={{
            label: t("Decline"),
            onClick: () => void decide(false),
            pending: pending === false,
            disabled: pending !== null,
          }}
        />
      ) : null}
      {stop ? (
        <Text size="micro" tone="danger" className="break-words">
          {stop}
        </Text>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
