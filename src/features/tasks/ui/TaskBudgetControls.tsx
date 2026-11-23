import { Text } from "../../../shared/ui/Text";
import "./task-form.css";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import type { TaskRunBudget, TaskRunBudgetUsage } from "../model/taskBudget";
import { TaskFormRow } from "./TaskFormFields";

export function TaskBudgetControls({
  budget,
  onChange,
  compact = false,
}: {
  budget?: TaskRunBudget;
  onChange: (budget: TaskRunBudget | undefined) => void;
  compact?: boolean;
}) {
  useLocale();
  const update = (key: keyof TaskRunBudget, text: string) => {
    const value = text === "" ? undefined : Number(text);
    const next = { ...budget, [key]: value };
    onChange(
      Object.values(next).some((entry) => entry !== undefined && entry > 0) ? next : undefined,
    );
  };
  const help = t(
    "Includes planning, workers, reviewers and correction runs. Empty or zero means unlimited. Token limits depend on provider reporting.",
  );
  const fields = (
    <div className={compact ? "task-budget-compact" : "task-form-grid"}>
      <NumberField
        label={t("Agent minutes")}
        hideLabel={compact}
        placeholder={compact ? t("Minutes") : undefined}
        fieldVariant={compact ? "compact" : undefined}
        steppers={!compact}
        min={0}
        step={0.1}
        value={budget?.maxAgentMinutes ?? ""}
        onChange={(event) => update("maxAgentMinutes", event.target.value)}
      />
      <NumberField
        label={t("Maximum agent runs")}
        hideLabel={compact}
        placeholder={compact ? t("Runs") : undefined}
        fieldVariant={compact ? "compact" : undefined}
        steppers={!compact}
        min={0}
        step={1}
        value={budget?.maxAttempts ?? ""}
        onChange={(event) => update("maxAttempts", event.target.value)}
      />
      <NumberField
        label={t("Reported token limit")}
        hideLabel={compact}
        placeholder={compact ? t("Tokens") : undefined}
        fieldVariant={compact ? "compact" : undefined}
        steppers={!compact}
        min={0}
        step={1}
        value={budget?.maxTokens ?? ""}
        onChange={(event) => update("maxTokens", event.target.value)}
      />
    </div>
  );
  if (compact)
    return (
      <TaskFormRow
        label={
          <span className="inline-flex items-center gap-1">
            {t("Run budget")} <InfoPopover>{help}</InfoPopover>
          </span>
        }
      >
        {fields}
      </TaskFormRow>
    );
  return (
    <Disclosure variant="row" summary={t("Total run budget")}>
      <div className="task-form-section-body">
        {fields}
        <InfoPopover>{help}</InfoPopover>
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
  const format = useFormat();
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
            {format.formatNumber(usage.agentMinutes, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </DescriptionItem>
          <DescriptionItem term={t("Agent runs")}>
            {format.formatNumber(usage.attempts)}
          </DescriptionItem>
          <DescriptionItem term={t("Reported tokens")}>
            {usage.tokensComplete
              ? usage.tokens === null
                ? null
                : format.formatNumber(usage.tokens)
              : t("Unknown total ({p0} reported)", {
                  p0: format.formatNumber(usage.reportedTokens),
                })}
          </DescriptionItem>
        </DescriptionList>
      ) : null}
      {stop ? (
        <Text as="p" tone="warning" size="inherit" role="status" className="break-words">
          {stop}
        </Text>
      ) : null}
    </Text>
  );
}
