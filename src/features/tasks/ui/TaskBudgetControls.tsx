import "./task-form.css";
import { t, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { NumberField } from "../../../shared/ui/NumberField";
import type { TaskRunBudget, TaskRunBudgetUsage } from "../model/taskBudget";

export function TaskBudgetControls({
  budget,
  onChange,
}: {
  budget?: TaskRunBudget;
  onChange: (budget: TaskRunBudget | undefined) => void;
}) {
  useLocale();
  const update = (key: keyof TaskRunBudget, text: string) => {
    const value = text === "" ? undefined : Number(text);
    const next = { ...budget, [key]: value };
    onChange(
      Object.values(next).some((entry) => entry !== undefined && entry > 0) ? next : undefined,
    );
  };
  return (
    <Disclosure summary={t("Total run budget")}>
      <div className="task-form-section-body">
        <div className="task-form-grid">
          <NumberField
            label={t("Agent minutes")}
            min={0}
            step={0.1}
            value={budget?.maxAgentMinutes ?? ""}
            onChange={(event) => update("maxAgentMinutes", event.target.value)}
          />
          <NumberField
            label={t("Maximum agent runs")}
            min={0}
            step={1}
            value={budget?.maxAttempts ?? ""}
            onChange={(event) => update("maxAttempts", event.target.value)}
          />
          <NumberField
            label={t("Reported token limit")}
            min={0}
            step={1}
            value={budget?.maxTokens ?? ""}
            onChange={(event) => update("maxTokens", event.target.value)}
          />
        </div>
        <p className="task-form-hint">
          {t(
            "Includes planning, workers, reviewers and correction runs. Empty or zero means unlimited. Token limits depend on provider reporting.",
          )}
        </p>
      </div>
    </Disclosure>
  );
}

export function TaskBudgetUsage({
  usage,
  stop,
  budget,
}: {
  usage?: TaskRunBudgetUsage;
  stop?: string;
  budget?: TaskRunBudget;
}) {
  useLocale();
  if (!usage && !stop) return null;
  const threshold = (budget?.warningPercent ?? 80) / 100;
  const nearing = Boolean(
    usage &&
    budget &&
    ((budget.maxAgentMinutes && usage.agentMinutes >= budget.maxAgentMinutes * threshold) ||
      (budget.maxAttempts && usage.attempts >= budget.maxAttempts * threshold) ||
      (budget.maxTokens && usage.reportedTokens >= budget.maxTokens * threshold)),
  );
  return (
    <div className="min-w-0 space-y-1 text-ui-caption">
      <p className="text-(--ui-text-muted)">
        {t("Run usage")}
        {nearing ? (
          <span className="ml-2 text-(--ui-tone-warning-fg)">
            {t("Run budget is nearing its limit.")}
          </span>
        ) : null}
      </p>
      {usage ? (
        <DescriptionList size="sm">
          <DescriptionItem term={t("Agent minutes")}>
            {usage.agentMinutes.toFixed(1)}
          </DescriptionItem>
          <DescriptionItem term={t("Agent runs")}>{usage.attempts}</DescriptionItem>
          <DescriptionItem term={t("Reported tokens")}>
            {usage.tokensComplete
              ? usage.tokens
              : t("Unknown total ({p0} reported)", {
                  p0: usage.reportedTokens,
                })}
          </DescriptionItem>
        </DescriptionList>
      ) : null}
      {stop ? (
        <p role="status" className="break-words text-(--ui-tone-warning-fg)">
          {stop}
        </p>
      ) : null}
      {usage?.historyComplete === false ? (
        <p className="text-ui-micro text-(--ui-tone-warning-fg)">
          {t(
            "Earlier runs are missing from the usage history. Recorded readings are lower bounds.",
          )}
        </p>
      ) : null}
    </div>
  );
}
