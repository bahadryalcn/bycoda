import { useRef, useState } from "react";
import { LiveText } from "../../../shared/ui/LiveText";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
      setActiveAction(retry ? "retry-failed" : action);
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
      setActiveAction(null);
      onBusy(false);
    }
  };

  return (
    <section className="task-bulk-tools" aria-label={t("Selected task actions")} aria-busy={busy}>
      <div className="task-bulk-actions">
        <Checkbox
          className="task-bulk-select"
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
          <Button
            key={action}
            variant="secondary"
            loading={activeAction === action}
            disabled={busy || disabled || !chosen.length}
            onClick={() => run(action).catch(report)}
          >
            {t({ start: "Start", stop: "Stop", retry: "Retry" }[action])}
          </Button>
        ))}
        <Button
          variant="secondary"
          tone="danger"
          loading={activeAction === "delete"}
          disabled={busy || disabled || !chosen.length}
          onClick={() => run("delete").catch(report)}
        >
          {t("Delete")}
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
          text={
            activeAction
              ? t("Processed {p0} of {p1}", { p0: progress.completed, p1: progress.total })
              : t("{p0} succeeded, {p1} skipped, {p2} failed", {
                  p0: results.filter((row) => row.status === "succeeded").length,
                  p1: results.filter((row) => row.status === "skipped").length,
                  p2: failures.length,
                })
          }
        />
      ) : null}
      {results.some((row) => row.status !== "succeeded") ? (
        <Disclosure className="task-bulk-results" summary={t("Operation details")}>
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
    </section>
  );
}
