import "./decisionModels.css";
import {
  useRetainedTransaction,
  retainedTransactionValue,
} from "../../model-routing/public/settings";
import { useId } from "react";
import { routingChangedTasks, routingChanges } from "../model/presentation";
import { SettingsSaveBar, type PendingChange } from "../../../shared/ui/settings";
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
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useState } from "react";
import { DECISION_TASK_TYPES } from "../../../shared/model/host-contracts/decision-models";
import { formatNumber, t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SourceOrderPicker } from "./SourceOrderPicker";
import { mergeRoutingDraft, parseThreshold, resetRoute } from "../model/routingEditor";
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
  hostId,
  routing,
  sources,
  busy,
  onSave,
}: {
  hostId?: string;
  routing: DecisionRouting;
  sources: DecisionSource[] | null;
  busy: boolean;
  onSave: (routing: DecisionRouting) => Promise<unknown>;
}) {
  const instanceId = useId();
  const identity = hostId ?? instanceId;
  const [retainedPending, setRetainedPending] = useRetainedTransaction(
    `decision:${identity}:routing:pending`,
    false,
  );
  const [editingTask, setEditingTask] = useState<DecisionTaskType | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useRetainedTransaction<DecisionRouting>(
    `decision:${identity}:routing:draft`,
    routing,
  );
  const [thresholdText, setThresholdText] = useRetainedTransaction<
    Partial<Record<DecisionTaskType, string>>
  >(`decision:${identity}:routing:text`, {});
  const [saveError, setSaveError] = useRetainedTransaction<unknown>(
    `decision:${identity}:routing:error`,
    null,
  );
  const [saved, setSaved] = useRetainedTransaction(`decision:${identity}:routing:saved`, false);
  const [draftSource, setDraftSource] = useRetainedTransaction(
    `decision:${identity}:routing:baseline`,
    routing,
  );
  const [observed, setObserved] = useRetainedTransaction(
    `decision:${identity}:routing:observed`,
    routing,
  );
  if (routingChanges(observed, routing) > 0 && !retainedPending) {
    setObserved(routing);
    setDraftSource(routing);
    setDraft(mergeRoutingDraft(draftSource, draft, routing));
    setThresholdText((current) => {
      const next = { ...current };
      for (const task of DECISION_TASK_TYPES) {
        if (
          current[task] !== undefined &&
          parseThreshold(current[task]) ===
            (draftSource[task]?.threshold ?? DEFAULT_ROUTE_THRESHOLD)
        )
          delete next[task];
      }
      return next;
    });
  }
  const invalid = DECISION_TASK_TYPES.some(
    (task) => thresholdText[task] !== undefined && parseThreshold(thresholdText[task]) === null,
  );
  const changedTasks = routingChangedTasks(draft, draftSource);
  const dirty = changedTasks.length > 0 || invalid;
  const pendingChanges: PendingChange[] = changedTasks.map((task) => ({
    id: task,
    label: taskTypeLabel(task),
    detail: draft[task]?.sourceIds.length ? undefined : t("Automatic"),
    revert: () => {
      setDraft((current) => ({ ...current, [task]: draftSource[task] }));
      setThresholdText((current) => {
        const next = { ...current };
        delete next[task];
        return next;
      });
      setSaved(false);
    },
  }));
  // An invalid threshold blocks Save but is not a change yet; the count still names it.
  if (!pendingChanges.length && invalid)
    pendingChanges.push({ id: "threshold", label: t("Confidence threshold") });
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
  /** True only once the Host acknowledged exactly the draft that was sent. */
  const save = (): Promise<boolean> => {
    if (
      invalid ||
      !dirty ||
      busy ||
      retainedTransactionValue<boolean>(`decision:${identity}:routing:pending`)
    )
      return Promise.resolve(false);
    setRetainedPending(true);
    setSaveError(null);
    return onSave(draft).then(
      (result) => {
        const acknowledged =
          typeof result === "object" && result !== null && "routing" in result
            ? (result as { routing: DecisionRouting }).routing
            : draft;
        // An edit made while the Host was saving stays in the draft and is not acknowledged;
        // only the baseline moves to what the Host now holds.
        const edited =
          retainedTransactionValue<DecisionRouting>(`decision:${identity}:routing:draft`) !== draft;
        setDraftSource(acknowledged);
        if (!edited) {
          setDraft(acknowledged);
          setThresholdText({});
        }
        setSaved(!edited);
        setRetainedPending(false);
        return !edited;
      },
      (error: unknown) => {
        setSaveError(error);
        setRetainedPending(false);
        return false;
      },
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
        {expanded &&
        (editingTask !== null || Object.values(draft).some((route) => route?.sourceIds.length)) ? (
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
                        disabled={busy || retainedPending || sources === null}
                        onChange={(next) => changeSources(task, next)}
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-1">
                      <TextField
                        label={t("Minimum confidence")}
                        inputMode="decimal"
                        hideLabel
                        value={text}
                        disabled={busy || retainedPending || !route?.sourceIds.length}
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
                        disabled={busy || retainedPending}
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
                      {t("Automatic")}
                    </Text>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || retainedPending}
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
        <div {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "px-4 py-2.5")}>
          <ErrorNotice title={t("Could not save the routing.")} error={saveError} onRetry={save} />
        </div>
      ) : null}
      <SettingsSaveBar
        id={`decision-routing:${identity}`}
        title={t("Task routing")}
        changes={pendingChanges}
        pending={busy || retainedPending}
        saved={saved && saveError === null}
        canSave={!invalid}
        saveLabel={t("Save routing")}
        onDiscard={() => {
          setDraft(draftSource);
          setThresholdText({});
          setSaveError(null);
          setSaved(false);
        }}
        onSave={save}
      />
    </>
  );
}
