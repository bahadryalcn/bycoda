import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { deleteTask, moveTask, startTask, type BoardTask } from "../model/taskClient";
import {
  bulkTaskKey,
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
  disabled,
}: {
  tasks: readonly BoardTask[];
  selected: ReadonlySet<string>;
  onSelect: (keys: Set<string>) => void;
  onUpdated: (task: BoardTask) => void;
  onDeleted: (task: BoardTask) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TaskBulkResult[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const [lastAction, setLastAction] = useState<TaskBulkAction>("delete");
  const chosen = tasks.filter((task) => selected.has(bulkTaskKey(task)));
  const failures = results.filter((row) => row.status === "failed");

  const run = async (action: TaskBulkAction, retry = false) => {
    if (pending.current || disabled) return;
    const current = new Map(tasks.map((task) => [bulkTaskKey(task), task]));
    const batch = retry
      ? failures
          .map((row) => current.get(bulkTaskKey(row.task)))
          .filter((task): task is BoardTask => Boolean(task))
      : [...chosen];
    if (!batch.length) return;
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
      setResults([]);
      setProgress({ completed: 0, total: batch.length });
      await runTaskBulkAction(
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
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <section className="task-bulk-tools" aria-label={t("Selected task actions")} aria-busy={busy}>
      <div className="task-bulk-actions">
        <label className="task-select-visible">
          <Checkbox
            checked={tasks.length > 0 && chosen.length === tasks.length}
            indeterminate={chosen.length > 0 && chosen.length < tasks.length}
            disabled={busy || disabled || !tasks.length}
            onChange={(event) =>
              onSelect(new Set(event.currentTarget.checked ? tasks.map(bulkTaskKey) : []))
            }
          />
          {t("Select all results")}
        </label>
        <span>{t("{p0} selected", { p0: chosen.length })}</span>
        <Button
          variant="ghost"
          disabled={busy || disabled || !chosen.length}
          onClick={() => onSelect(new Set())}
        >
          {t("Clear selection")}
        </Button>
        {(["start", "stop", "retry", "delete"] as const).map((action) => (
          <Button
            key={action}
            variant="ghost"
            tone={action === "delete" ? "danger" : "neutral"}
            disabled={busy || disabled || !chosen.length}
            onClick={() => void run(action)}
          >
            {t({ start: "Start", stop: "Stop", retry: "Retry", delete: "Delete" }[action])}
          </Button>
        ))}
      </div>
      {progress ? (
        <div role="status" aria-live="polite">
          {busy
            ? t("Processed {p0} of {p1}", { p0: progress.completed, p1: progress.total })
            : t("{p0} succeeded, {p1} skipped, {p2} failed", {
                p0: results.filter((row) => row.status === "succeeded").length,
                p1: results.filter((row) => row.status === "skipped").length,
                p2: failures.length,
              })}
        </div>
      ) : null}
      {results.some((row) => row.status !== "succeeded") ? (
        <details className="task-bulk-results">
          <summary>{t("Operation details")}</summary>
          <ul>
            {results
              .filter((row) => row.status !== "succeeded")
              .map((row) => (
                <li key={bulkTaskKey(row.task)}>
                  <strong>{row.task.title}</strong> · {row.task.machineName}:{" "}
                  {t(row.status === "failed" ? "Failed" : "Skipped")}.{" "}
                  {row.reason ? t(row.reason) : null}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      {failures.length ? (
        <Button
          variant="secondary"
          disabled={busy || disabled}
          onClick={() => void run(lastAction, true)}
        >
          {t("Retry failed tasks")}
        </Button>
      ) : null}
      {dialog}
    </section>
  );
}
