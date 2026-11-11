import { useRef, useState } from "react";
import { InlineError } from "../../../shared/ui/InlineError";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import "./task-detail.css";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { NumberField } from "../../../shared/ui/NumberField";
import type { HostTask } from "../model/hostTasks";
import {
  parseTaskEvaluation,
  readTaskEvaluation,
  taskMetricsComparisons,
  type TaskEvaluationInput,
} from "../model/taskMetrics";

type Props = {
  task: HostTask;
  onSaveEvaluation: (evaluation: TaskEvaluationInput) => Promise<void>;
};
const number = (value: number | null, maximumFractionDigits = 1) =>
  value === null ? t("Unknown") : value.toLocaleString(getLocale(), { maximumFractionDigits });

function Stat({ label, value }: { label: string; value: string }) {
  return <DescriptionItem term={label}>{value}</DescriptionItem>;
}

export function TaskRunInsights({ task, onSaveEvaluation }: Props) {
  useLocale();
  const usage = task.budgetUsage;
  const completeHistory = usage?.historyComplete !== false;
  return (
    <>
      {!completeHistory ? (
        <p className="text-ui-micro text-(--ui-tone-warning-fg)">
          {t(
            "Earlier runs are missing from the usage history. Recorded readings are lower bounds.",
          )}
        </p>
      ) : null}
      <Disclosure className="min-w-0" variant="row" size="sm" summary={t("Run quality and usage")}>
        <DescriptionList columns="auto" size="sm">
          <Stat
            label={t("Total agent minutes")}
            value={number(completeHistory ? (usage?.agentMinutes ?? null) : null)}
          />
          <Stat
            label={t("Agent runs")}
            value={number(completeHistory ? (usage?.attempts ?? null) : null, 0)}
          />
          <Stat label={t("Reported tokens")} value={number(usage?.tokens ?? null, 0)} />
          <Stat
            label={t("Reported cost (USD)")}
            value={number(usage?.reportedCostUsd ?? null, 4)}
          />
        </DescriptionList>
        <p className="text-ui-micro text-(--ui-text-secondary)">
          {t(
            "Includes recorded workers, reviewers and retries. Missing provider readings remain unknown; no billing estimate is inferred.",
          )}
        </p>
        {task.status === "done" || task.status === "review" ? (
          <EvaluationEditor
            key={`${task.id}:${task.runId ?? task.sessionId ?? "manual"}:${task.completedAt ?? task.startedAt ?? "unfinished"}`}
            task={task}
            onSaveEvaluation={onSaveEvaluation}
          />
        ) : null}
      </Disclosure>
    </>
  );
}

function EvaluationEditor({ task, onSaveEvaluation }: Props) {
  const previous = readTaskEvaluation(task.evaluation);
  const [accepted, setAccepted] = useState(previous?.accepted ?? false);
  const [minutes, setMinutes] = useState(String(previous?.reviewMinutes ?? 0));
  const [corrections, setCorrections] = useState(String(previous?.corrections ?? 0));
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="min-w-0 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        setError("");
        setMessage("");
        let evaluation: TaskEvaluationInput;
        try {
          if (!minutes.trim() || !corrections.trim())
            throw new Error(t("Enter a valid review time and correction count."));
          evaluation = parseTaskEvaluation({
            accepted,
            reviewMinutes: Number(minutes),
            corrections: Number(corrections),
          });
        } catch {
          setError(t("Enter a valid review time and correction count."));
          return;
        }
        pending.current = true;
        setBusy(true);
        try {
          await onSaveEvaluation(evaluation);
          setMessage(t("Evaluation saved"));
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : t("Could not save the task evaluation."),
          );
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <Checkbox
        className="items-start gap-2 text-ui-caption"
        label={t("I accept this result for quality comparison")}
        checked={accepted}
        disabled={busy}
        onChange={(event) => setAccepted(event.currentTarget.checked)}
      />
      {/* Two fields share a row only when this panel is wide enough (a detail side pane is
          narrower than the window), so the count follows the pane, not the viewport. */}
      <div className="@container min-w-0">
        <div className="grid min-w-0 grid-cols-1 gap-2 @xs:grid-cols-2">
          <NumberField
            label={t("My review time (minutes)")}
            min={0}
            max={52_560_000}
            step="any"
            required
            value={minutes}
            disabled={busy}
            onChange={(event) => setMinutes(event.currentTarget.value)}
          />
          <NumberField
            label={t("Corrections I needed")}
            min={0}
            max={1_000_000}
            step={1}
            required
            value={corrections}
            disabled={busy}
            onChange={(event) => setCorrections(event.currentTarget.value)}
          />
        </div>
      </div>
      <p className="text-ui-micro text-(--ui-text-secondary)">
        {t(
          "Saving an evaluation does not complete, approve or publish the task. Comparisons include only completed results you accepted.",
        )}
      </p>
      {error ? <InlineError>{error}</InlineError> : null}
      {message ? (
        <p role="status" className="text-ui-caption">
          {message}
        </p>
      ) : null}
      <Button type="submit" loading={busy}>
        {t("Save evaluation")}
      </Button>
    </form>
  );
}

export function TaskMetricsComparison({ tasks }: { tasks: HostTask[] }) {
  useLocale();
  const groups = taskMetricsComparisons(tasks);
  return (
    <section className="min-w-0 space-y-3" aria-label={t("Accepted work comparisons")}>
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "Compare similar objectives and acceptance criteria. These are recorded outcomes, not a controlled model benchmark.",
        )}
      </p>
      {!groups.length ? (
        <p className="text-ui-caption">
          {t("Accept a completed result and record your review to compare runs.")}
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li
              key={group.key}
              className="min-w-0 space-y-2 border-b border-(--ui-tone-neutral-border) pb-3"
            >
              <p className="break-words text-ui-caption font-medium">
                {group.harness} · {group.model}
              </p>
              {group.workflowId ? (
                <p className="break-words text-ui-micro text-(--ui-text-secondary)">
                  {t("Workflow {p0}, version {p1}", {
                    p0: group.workflowId,
                    p1: String(group.workflowVersion ?? t("Unknown")),
                  })}
                </p>
              ) : null}
              {Object.keys(group.modelSettings).length ? (
                <p className="break-words text-ui-micro text-(--ui-text-secondary)">
                  {Object.entries(group.modelSettings)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" · ")}
                </p>
              ) : null}
              <DescriptionList columns={2} size="sm">
                <DescriptionItem term={t("Accepted results")}>
                  <span className="tabular-nums">{number(group.samples, 0)}</span>
                </DescriptionItem>
                <DescriptionItem term={t("Agent minutes per accepted result")}>
                  <span className="tabular-nums">{number(group.agentMinutesPerAccepted)}</span>
                </DescriptionItem>
                <DescriptionItem term={t("My review time (minutes)")}>
                  <span className="tabular-nums">{number(group.reviewMinutes)}</span>
                </DescriptionItem>
                <DescriptionItem term={t("Corrections I needed")}>
                  <span className="tabular-nums">{number(group.corrections, 0)}</span>
                </DescriptionItem>
                <DescriptionItem term={t("Reported tokens")}>
                  <span className="tabular-nums">{number(group.tokens, 0)}</span>
                </DescriptionItem>
                <DescriptionItem term={t("Reported cost (USD)")}>
                  <span className="tabular-nums">{number(group.reportedCostUsd, 4)}</span>
                </DescriptionItem>
              </DescriptionList>
              {group.unknownTimeSamples || group.unknownTokenSamples || group.unknownCostSamples ? (
                <p className="text-ui-micro text-(--ui-tone-warning-fg)">
                  {t(
                    "Some usage readings are missing. Partial readings are not shown as complete totals.",
                  )}
                </p>
              ) : null}
              {group.criteriaVariants > 1 || group.objectiveVariants > 1 ? (
                <p className="text-ui-micro text-(--ui-text-secondary)">
                  {t(
                    "This group contains different objectives or criteria. Review task comparability before drawing conclusions.",
                  )}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
