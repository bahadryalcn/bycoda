import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useRef, useState } from "react";
import { LiveText } from "../../../shared/ui/LiveText";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Text } from "../../../shared/ui/Text";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { deleteTask, moveTask, startTask, type BoardTask } from "../model/taskClient";
import {
  bulkTaskKey,
  groupTaskBulkResults,
  runTaskBulkAction,
  taskBulkUnavailable,
  type TaskBulkAction,
  type TaskBulkResult,
} from "../model/taskBulkActions";

export function TaskBulkToolbar({
  tasks,
  selected,
  onSelect,
  onUpdated,
  onDeleted,
  onBusy,
  onFinish,
  onError,
  disabled,
}: {
  tasks: readonly BoardTask[];
  selected: ReadonlySet<string>;
  onSelect: (keys: Set<string>) => void;
  onUpdated: (task: BoardTask) => void;
  onDeleted: (task: BoardTask) => void;
  onBusy: (busy: boolean) => void;
  /** Leaves selection mode. */
  onFinish: () => void;
  /** Reports a failure outside the per-task results (confirm or batch setup). */
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<TaskBulkAction | "retry-failed" | null>(null);
  const [results, setResults] = useState<TaskBulkResult[]>([]);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [lastAction, setLastAction] = useState<TaskBulkAction>("delete");
  const chosen = tasks.filter((task) => selected.has(bulkTaskKey(task)));
  const report = (reason: unknown) =>
    onError(reason instanceof Error ? reason.message : String(reason));
  const failures = results.filter((row) => row.status === "failed");
  const resultGroups = groupTaskBulkResults(results);
  const eligibility = (action: TaskBulkAction) => chosen.filter((task) => !taskBulkUnavailable(task, action));
  const unavailableReason = (action: TaskBulkAction) =>
    chosen.length && !eligibility(action).length
      ? t(taskBulkUnavailable(chosen[0], action) ?? "Unavailable")
      : undefined;

  const run = async (action: TaskBulkAction, retry = false) => {
    if (pending.current || disabled) return;
    const current = new Map(tasks.map((task) => [bulkTaskKey(task), task]));
    const batch = retry
      ? failures
          .map((row) => current.get(bulkTaskKey(row.task)))
          .filter((task): task is BoardTask => Boolean(task))
      : [...chosen];
    if (!batch.length || !batch.some((task) => !taskBulkUnavailable(task, action))) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const eligible = batch.filter((task) => !taskBulkUnavailable(task, action)).length;
      if (
        (action === "delete" || action === "stop") &&
        !(await confirm({
          title: action === "delete" ? t("Delete selected tasks") : t("Stop selected tasks"),
          message: t(
            "Apply to {p0} selected tasks in the current results? {p1} are eligible. Other tasks and unmerged work are preserved.",
            { p0: batch.length, p1: eligible },
          ),
          confirmLabel: action === "delete" ? t("Delete") : t("Stop"),
        }))
      )
        return;
      setLastAction(action);
      setActiveAction(retry ? "retry-failed" : action);
      setResults([]);
      setProgress({ completed: 0, total: batch.length });
      const completedResults = await runTaskBulkAction(
        batch,
        action,
        async (task, operation) => {
          if (operation === "delete") {
            await deleteTask(task, false);
            onDeleted(task);
          } else {
            const updated =
              operation === "start"
                ? await startTask(task)
                : await moveTask(task, operation === "stop" ? "blocked" : "queued");
            onUpdated(updated);
          }
        },
        (result, completed, total) => {
          setResults((rows) => [...rows, result]);
          setProgress({ completed, total });
        },
      );
      if (action === "delete") {
        const remaining = new Set(selected);
        for (const result of completedResults) {
          if (result.status === "succeeded") remaining.delete(bulkTaskKey(result.task));
        }
        onSelect(remaining);
      }
    } finally {
      pending.current = false;
      setBusy(false);
      setActiveAction(null);
      onBusy(false);
    }
  };

  return (
    <Text
      as="section"
      size="secondary"
      tone="inherit"
      leading="inherit"
      {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "task-bulk-tools")}
      aria-label={t("Selected task actions")}
      aria-busy={busy}
    >
      <div className="task-bulk-actions">
        <Checkbox
          className="task-bulk-select"
          tone="secondary"
          label={t("Select all results")}
          checked={tasks.length > 0 && chosen.length === tasks.length}
          indeterminate={chosen.length > 0 && chosen.length < tasks.length}
          disabled={busy || disabled || !tasks.length}
          onChange={(event) =>
            onSelect(new Set(event.currentTarget.checked ? tasks.map(bulkTaskKey) : []))
          }
        />
        <Badge size="sm" tone={chosen.length ? "accent" : "neutral"} className="tabular-nums">
          {t("{p0} selected", { p0: chosen.length })}
        </Badge>
        {(["start", "stop", "retry"] as const).map((action) => (
          <Tooltip key={action} label={eligibility(action).length ? t("Eligible tasks: {p0} of {p1}", { p0: eligibility(action).length, p1: chosen.length }) : undefined}>
          <Button
            key={action}
            aria-label={t({ start: "Start", stop: "Stop", retry: "Retry" }[action])}
            variant="secondary"
            loading={activeAction === action}
            disabled={busy || disabled || !eligibility(action).length}
            disabledReason={unavailableReason(action)}
            onClick={() => run(action).catch(report)}
          >
            {t({ start: "Start", stop: "Stop", retry: "Retry" }[action])}
            <Badge size="xs" variant="count" aria-hidden>{eligibility(action).length}</Badge>
          </Button>
          </Tooltip>
        ))}
        <Button
          variant="secondary"
          tone="danger"
          loading={activeAction === "delete"}
          disabled={busy || disabled || !eligibility("delete").length}
          disabledReason={unavailableReason("delete")}
          aria-label={t("Delete")}
          onClick={() => run("delete").catch(report)}
        >
          {t("Delete")}
          <Badge size="xs" variant="count" aria-hidden>{eligibility("delete").length}</Badge>
        </Button>
        <Button
          variant="ghost"
          disabled={busy || disabled || !chosen.length}
          onClick={() => onSelect(new Set())}
        >
          {t("Clear selection")}
        </Button>
        <span className="task-bulk-spacer" />
        <Button variant="ghost" disabled={busy} onClick={onFinish}>
          {t("Finish selection")}
        </Button>
      </div>
      {progress ? (
        <LiveText
          className="task-bulk-status"
          size="caption"
          tone="secondary"
          leading="inherit"
          text={
            activeAction
              ? t("Processed {p0} of {p1}", {
                  p0: progress.completed,
                  p1: progress.total,
                })
              : t("{p0} succeeded, {p1} skipped, {p2} failed", {
                  p0: results.filter((row) => row.status === "succeeded").length,
                  p1: results.filter((row) => row.status === "skipped").length,
                  p2: failures.length,
                })
          }
        />
      ) : null}
      {resultGroups.length ? (
        <Disclosure summary={t("Details")} defaultOpen={failures.length > 0} className="task-bulk-results">
          {resultGroups.map((group, index) => (
            <div key={index} className="task-bulk-result-group">
              <Text as="p" size="caption" tone={group.status === "failed" ? "danger" : "secondary"}>
                {t(group.status === "failed" ? "Failed" : "Skipped")}{": "}
                {group.reason ? t(group.reason) : null}
              </Text>
              <BadgeList label={t("Tasks")} max={3} items={group.tasks.map((task) => ({
                id: bulkTaskKey(task), label: task.title, title: `${task.title} / ${task.machineName}`,
              }))} />
            </div>
          ))}
        </Disclosure>
      ) : null}
      {failures.length || activeAction === "retry-failed" ? (
        <Button
          variant="secondary"
          loading={activeAction === "retry-failed"}
          disabled={busy || disabled}
          onClick={() => run(lastAction, true).catch(report)}
        >
          {t("Retry failed tasks")}
        </Button>
      ) : null}
      {dialog}
    </Text>
  );
}
