import "./decisionModels.css";
import { routingChanges } from "../model/presentation";
import { Badge } from "../../../shared/ui/Badge";
import { TextField } from "../../../shared/ui/TextField";
import { InlineAction } from "../../../shared/ui/ActionHost";
import {
  MonitorSmartphone,
  CursorMagicSelection,
  Globe,
  Gauge,
  MessageSquare,
  Shield,
  Inbox,
  CircleHelp,
  RotateCcw,
  Plus,
  Minus,
} from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import { formatNumber, t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SourceOrderPicker } from "./SourceOrderPicker";
import { parseThreshold, resetRoute } from "../model/routingEditor";
import type { DecisionRouting, DecisionSource, DecisionTaskType } from "../model/decisionTypes";
import {
  DEFAULT_ROUTE_THRESHOLD,
  setRouteSources,
  setRouteThreshold,
  taskTypeLabel,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";
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
  const [editingTask, setEditingTask] = useState<DecisionTaskType | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DecisionRouting>(routing);
  const [thresholdText, setThresholdText] = useState<Partial<Record<DecisionTaskType, string>>>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [draftSource, setDraftSource] = useState(routing);
  if (draftSource !== routing && routingChanges(draftSource, routing) > 0) {
    setDraftSource(routing);
    setDraft(routing);
    setThresholdText({});
  }
  const invalid = DECISION_TASK_TYPES.some(
    (task) => thresholdText[task] !== undefined && parseThreshold(thresholdText[task]) === null,
  );
  const changes = routingChanges(draft, routing);
  const dirty = changes > 0 || invalid;
  const taskIcons = {
    screen_state: MonitorSmartphone,
    element_choice: CursorMagicSelection,
    audience_classify: Globe,
    interest_score: Gauge,
    sentiment: MessageSquare,
    optout: Shield,
    inbox_priority: Inbox,
    generic: CircleHelp,
  };
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
      <div className="flex min-w-0 items-center justify-between gap-2 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Text size="caption" tone="secondary">
            {t("Automatic: local models first")}
          </Text>
          {Object.values(draft).some((route) => route?.sourceIds.length) ? (
            <Badge size="xs">
              {t("{p1} customized", {
                p1: formatNumber(
                  Object.values(draft).filter((route) => route?.sourceIds.length).length,
                ),
              })}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("Done") : t("Customize")}
        </Button>
      </div>
      <div className="decision-routing-list">
        {expanded ? (
          <div className="decision-routing-row">
            <Text size="caption" tone="secondary" className="decision-routing-task">
              {t("Task")}
            </Text>
            <Text size="caption" tone="secondary">
              {t("Sources")}
            </Text>
            <Text size="caption" tone="secondary">
              {t("Minimum confidence")}
            </Text>
          </div>
        ) : null}
        {[...DECISION_TASK_TYPES]
          .sort(
            (a, b) =>
              Number(Boolean(draft[b]?.sourceIds.length)) -
              Number(Boolean(draft[a]?.sourceIds.length)),
          )
          .filter((task) => expanded || draft[task]?.sourceIds.length)
          .map((task) => {
            const route = draft[task];
            const Icon = taskIcons[task];
            const text =
              thresholdText[task] ??
              formatNumber(route?.threshold ?? DEFAULT_ROUTE_THRESHOLD, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
            const thresholdInvalid =
              thresholdText[task] !== undefined && parseThreshold(text) === null;
            const orderedNames = (route?.sourceIds ?? []).map(
              (id) => (sources ?? []).find((source) => source.id === id)?.name ?? id,
            );
            return (
              <div key={task} className="decision-routing-row">
                <div className="decision-routing-task">
                  <Icon className="icon-md" aria-hidden="true" />
                  <Text size="body" weight="medium" truncate>
                    {taskTypeLabel(task)}
                  </Text>
                  {expanded && route?.sourceIds.length ? (
                    <Badge className="shrink-0" size="xs">
                      {t("Custom")}
                    </Badge>
                  ) : null}
                </div>
                {expanded && (route?.sourceIds.length || editingTask === task) ? (
                  <>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <SourceOrderPicker
                        label={taskTypeLabel(task)}
                        value={route?.sourceIds ?? []}
                        sources={sources ?? []}
                        disabled={busy || sources === null}
                        onChange={(next) => changeSources(task, next)}
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-1">
                      <TextField
                        label={t("Minimum confidence")}
                        inputMode="decimal"
                        hideLabel
                        value={text}
                        disabled={busy || !route?.sourceIds.length}
                        error={thresholdInvalid ? t("Enter a number from 0 to 1.") : undefined}
                        onChange={(event) => changeThreshold(task, event.target.value)}
                        onBlur={() => {
                          const value = parseThreshold(text);
                          if (value !== null)
                            setThresholdText((current) => ({
                              ...current,
                              [task]: formatNumber(value, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }),
                            }));
                        }}
                        endAdornment={
                          <span className="flex items-center">
                            <InlineAction
                              reveal="always"
                              label={t("Decrease value")}
                              disabled={
                                busy || !route?.sourceIds.length || (parseThreshold(text) ?? 0) <= 0
                              }
                              onClick={() =>
                                changeThreshold(
                                  task,
                                  formatNumber(
                                    Math.max(
                                      0,
                                      Math.round(((parseThreshold(text) ?? 0) - 0.01) * 100) / 100,
                                    ),
                                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                                  ),
                                )
                              }
                            >
                              <Minus />
                            </InlineAction>
                            <InlineAction
                              reveal="always"
                              label={t("Increase value")}
                              disabled={
                                busy || !route?.sourceIds.length || (parseThreshold(text) ?? 1) >= 1
                              }
                              onClick={() =>
                                changeThreshold(
                                  task,
                                  formatNumber(
                                    Math.min(
                                      1,
                                      Math.round(((parseThreshold(text) ?? 0) + 0.01) * 100) / 100,
                                    ),
                                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                                  ),
                                )
                              }
                            >
                              <Plus />
                            </InlineAction>
                          </span>
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        label={t("Reset to automatic")}
                        disabled={busy}
                        onClick={() => {
                          setDraft((current) => resetRoute(current, task));
                          setThresholdText((current) => {
                            const next = { ...current };
                            delete next[task];
                            return next;
                          });
                          setEditingTask(null);
                          setSaved(false);
                        }}
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                  </>
                ) : expanded ? (
                  <div className="col-span-2 flex min-w-0 items-center justify-between gap-2">
                    <Text size="caption" tone="secondary">
                      {t("Automatic: local models first")}
                    </Text>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setEditingTask(task)}
                    >
                      {t("Customize")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-1">
                      {orderedNames.map((name, index) => (
                        <Badge key={index} size="xs" truncate>
                          {formatNumber(index + 1)} {name}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Text size="caption">
                        {formatNumber(route?.threshold ?? DEFAULT_ROUTE_THRESHOLD, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                      <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
                        {t("Edit")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
      {saveError !== null ? (
        <div className="border-t border-(--ui-settings-hairline) px-4 py-2.5">
          <ErrorNotice error={saveError} onRetry={save} />
        </div>
      ) : null}
      {dirty || saved || busy ? (
        <div className="flex min-w-0 items-center justify-end gap-3 border-t border-(--ui-settings-hairline) px-4 py-2.5">
          {dirty ? (
            <>
              <Text size="caption" tone="secondary">
                {t("{p1} unsaved changes", { p1: formatNumber(changes) })}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDraft(routing);
                  setThresholdText({});
                  setSaveError(null);
                  setSaved(false);
                }}
              >
                {t("Discard")}
              </Button>
            </>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            success={saved && !dirty && saveError === null}
            successLabel={saved && !dirty && saveError === null ? t("Saved") : undefined}
            disabled={!dirty || invalid || busy}
            onClick={save}
          >
            {t("Save routing")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
