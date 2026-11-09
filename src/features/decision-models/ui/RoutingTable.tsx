import { useEffect, useState } from "react";
import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { DecisionRouting, DecisionSource, DecisionTaskType } from "../model/decisionTypes";
import {
  DEFAULT_ROUTE_THRESHOLD,
  cleanRouting,
  setRouteSources,
  setRouteThreshold,
  sourceKindLabel,
  taskTypeLabel,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

/** Empty or non-numeric input, or a value outside 0 to 1, is not a threshold. */
function parseThreshold(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * Per task type: the sources in fallback order and the confidence threshold. Edits stay in a draft
 * until Save; an invalid threshold blocks saving and is named on its field.
 */
export function RoutingTable({
  routing,
  sources,
  busy,
  onSave,
}: {
  routing: DecisionRouting;
  sources: DecisionSource[] | null;
  busy: boolean;
  onSave: (routing: DecisionRouting) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<DecisionRouting>(routing);
  const [thresholdText, setThresholdText] = useState<Partial<Record<DecisionTaskType, string>>>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(routing);
    setThresholdText({});
  }, [routing]);

  const invalid = DECISION_TASK_TYPES.some(
    (task) => thresholdText[task] !== undefined && parseThreshold(thresholdText[task]) === null,
  );
  const dirty =
    JSON.stringify(cleanRouting(draft)) !== JSON.stringify(cleanRouting(routing)) ||
    Object.keys(thresholdText).length > 0;
  const options = (sources ?? []).map((source) => ({
    value: source.id,
    label: source.name,
    description: sourceKindLabel(source.kind),
  }));

  const changeSources = (task: DecisionTaskType, sourceIds: readonly string[]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [task]: setRouteSources(current[task], sourceIds) }));
  };

  const changeThreshold = (task: DecisionTaskType, text: string) => {
    setSaved(false);
    setThresholdText((current) => ({ ...current, [task]: text }));
    const value = parseThreshold(text);
    if (value !== null) {
      setDraft((current) => ({ ...current, [task]: setRouteThreshold(current[task], value) }));
    }
  };

  const save = () => {
    if (invalid || !dirty || busy) return;
    setSaveError(null);
    void onSave(draft).then(
      () => {
        setSaved(true);
        setThresholdText({});
      },
      (error: unknown) => setSaveError(error),
    );
  };

  return (
    <>
      <p className="text-ui-caption px-4 py-2.5 text-(--ui-text-secondary)">
        {t(
          "Answers below the threshold are not used. The next source in the list is tried. Without a source, the built-in order applies.",
        )}
      </p>
      <div
        aria-hidden="true"
        className="text-ui-caption hidden gap-3 border-t border-(--ui-settings-hairline) px-4 py-1.5 font-medium text-(--ui-text-muted) sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_7rem]"
      >
        <span>{t("Task")}</span>
        <span>{t("Sources, in order")}</span>
        <span>{t("Threshold")}</span>
      </div>
      {DECISION_TASK_TYPES.map((task) => {
        const route = draft[task];
        const text = thresholdText[task] ?? String(route?.threshold ?? DEFAULT_ROUTE_THRESHOLD);
        const thresholdInvalid = thresholdText[task] !== undefined && parseThreshold(text) === null;
        const orderedNames = (route?.sourceIds ?? []).map(
          (id) => (sources ?? []).find((source) => source.id === id)?.name ?? id,
        );
        return (
          <div
            key={task}
            className="flex min-w-0 flex-col gap-2 border-t border-(--ui-settings-hairline) px-4 py-2.5 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_7rem] sm:items-start sm:gap-3"
          >
            <span className="text-ui-body pt-1 font-medium">{taskTypeLabel(task)}</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <SearchableSelect
                hideLabel
                label={taskTypeLabel(task)}
                multiple
                value={route?.sourceIds ?? []}
                options={options}
                placeholder={t("Built-in order")}
                searchPlaceholder={t("Search sources")}
                emptyLabel={t("No sources connected")}
                disabled={busy || sources === null}
                onChange={(next) => changeSources(task, next)}
              />
              {orderedNames.length > 1 ? (
                <ol
                  aria-label={t("Order of use")}
                  className="flex min-w-0 flex-wrap items-center gap-1.5"
                >
                  {orderedNames.map((name, index) => (
                    <li key={`${index}:${name}`}>
                      <Badge tone="neutral" size="xs">
                        <span className="tabular-nums">{index + 1}</span> {name}
                      </Badge>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div className="w-full sm:w-auto">
              <NumberField
                label={t("Threshold")}
                hideLabel
                min={0}
                max={1}
                step={0.01}
                value={text}
                disabled={busy}
                error={thresholdInvalid ? t("Enter a number from 0 to 1.") : undefined}
                onChange={(event) => changeThreshold(task, event.target.value)}
              />
            </div>
          </div>
        );
      })}
      {saveError !== null ? (
        <div className="border-t border-(--ui-settings-hairline) px-4 py-2.5">
          <ErrorNotice error={saveError} onRetry={save} />
        </div>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-(--ui-settings-hairline) px-4 py-2.5">
        <div className="min-w-0">
          {saved && !dirty ? <InlineMessage tone="success">{t("Saved.")}</InlineMessage> : null}
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!dirty || invalid || busy}
          onClick={save}
        >
          {t("Save routing")}
        </Button>
      </div>
    </>
  );
}
