import { t, useLocale } from "../../../shared/i18n";
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
    <details className="min-w-0 space-y-2 text-ui-caption">
      <summary className="cursor-pointer">{t("Total run budget")}</summary>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
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
      <p className="text-ui-micro text-(--ui-text-secondary)">
        {t(
          "Includes planning, workers, reviewers and correction runs. Empty or zero means unlimited. Token limits depend on provider reporting.",
        )}
      </p>
    </details>
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
    <details className="min-w-0 space-y-2 text-ui-caption">
      <summary className="cursor-pointer">
        {t("Run usage")}
        {nearing ? (
          <span className="ml-2 text-(--ui-tone-warning-fg)">
            {t("Run budget is nearing its limit.")}
          </span>
        ) : null}
      </summary>
      {usage ? (
        <dl className="grid grid-cols-2 gap-1">
          <dt>{t("Agent minutes")}</dt>
          <dd>{usage.agentMinutes.toFixed(1)}</dd>
          <dt>{t("Agent runs")}</dt>
          <dd>{usage.attempts}</dd>
          <dt>{t("Reported tokens")}</dt>
          <dd>
            {usage.tokensComplete
              ? usage.tokens
              : t("Unknown total ({p0} reported)", { p0: usage.reportedTokens })}
          </dd>
        </dl>
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
    </details>
  );
}
