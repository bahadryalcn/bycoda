import { Text } from "../../../shared/ui/Text";
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
        <Text as="p" size="micro" tone="secondary" leading="inherit" className="task-form-hint">
          {t(
            "Includes planning, workers, reviewers and correction runs. Empty or zero means unlimited. Token limits depend on provider reporting.",
          )}
        </Text>
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
    <Text as="div" size="caption" tone="inherit" className="min-w-0 space-y-1">
      <Text as="p" tone="muted" size="inherit">
        {t("Run usage")}
        {nearing ? (
          <Text tone="warning" size="inherit" className="ml-2">
            {t("Run budget is nearing its limit.")}
          </Text>
        ) : null}
      </Text>
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
        <Text as="p" tone="warning" size="inherit" role="status" className="break-words">
          {stop}
        </Text>
      ) : null}
      {usage?.historyComplete === false ? (
        <Text as="p" size="micro" tone="warning">
          {t(
            "Earlier runs are missing from the usage history. Recorded readings are lower bounds.",
          )}
        </Text>
      ) : null}
    </Text>
  );
}
