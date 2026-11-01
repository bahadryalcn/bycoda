import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";
import { taskStatusLine } from "../model/taskStatusLine";
import { useId, useState } from "react";

const TASK_PAGE_SIZE = 50;

export function TaskList({
  tasks,
  selection,
  selected,
  activeKey,
  onToggle,
  onOpen,
  disabled,
  planningLabel,
}: {
  tasks: readonly BoardTask[];
  selection: boolean;
  selected: ReadonlySet<string>;
  /** The task whose detail panel is open. */
  activeKey?: string | null;
  onToggle: (task: BoardTask, checked: boolean) => void;
  onOpen: (task: BoardTask) => void;
  disabled?: boolean;
  planningLabel?: (task: BoardTask) => string;
}) {
  const t = useT();
  const listId = useId();
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(tasks.length / TASK_PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * TASK_PAGE_SIZE;
  const pageTasks = tasks.slice(start, start + TASK_PAGE_SIZE);
  return (
    <>
      <ul id={listId} className="task-management-list" aria-label={t("Tasks")}>
        {pageTasks.map((task, index) => {
          const status = taskStatusLine(task);
          return (
          <li
            key={bulkTaskKey(task)}
            aria-setsize={tasks.length}
            aria-posinset={start + index + 1}
            className="task-management-row"
            data-selected={selected.has(bulkTaskKey(task)) || undefined}
            data-active={activeKey === `${task.machineId}:${task.id}` || undefined}
          >
            {selection ? (
              <label className="task-row-select">
                <Checkbox
                  aria-label={t("Select task: {p0}", { p0: task.title })}
                  disabled={disabled}
                  checked={selected.has(bulkTaskKey(task))}
                  onChange={(event) => onToggle(task, event.currentTarget.checked)}
                />
              </label>
            ) : null}
            <div className="task-management-identity">
              <Button
                variant="link"
                layout="text"
                align="start"
                className="task-list-open"
                onClick={() => onOpen(task)}
              >
                {task.title}
              </Button>
              <span>
                {task.machineName} · {task.cwd}
                {task.stale ? ` · ${t("Offline")}` : ""}
              </span>
              {planningLabel?.(task) ? (
                <span className="task-planning-caption">{planningLabel(task)}</span>
              ) : null}
              {status.detail ? (
                <p
                  data-task-status-detail
                  title={task.error ?? task.mergeError ?? status.detail}
                  className="task-list-error line-clamp-1"
                  data-tone={status.tone}
                >
                  {status.detail}
                </p>
              ) : null}
            </div>
            <Badge
              tone={status.tone}
              data-task-status={status.kind}
              className="task-list-status"
            >
              {status.label}
            </Badge>
          </li>
          );
        })}
      </ul>
      {tasks.length > TASK_PAGE_SIZE ? (
        <nav aria-label={t("Tasks")} className="flex flex-wrap items-center justify-end gap-2 py-2">
          <Button
            variant="ghost"
            motion="none"
            disabled={currentPage === 0}
            aria-controls={listId}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("Previous")}
          </Button>
          <span
            role="status"
            className="min-w-24 text-center text-ui-caption tabular-nums text-(--ui-text-secondary)"
          >
            {start + 1}–{Math.min(start + TASK_PAGE_SIZE, tasks.length)} / {tasks.length}
          </span>
          <Button
            variant="ghost"
            motion="none"
            disabled={currentPage === lastPage}
            aria-controls={listId}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("Next")}
          </Button>
        </nav>
      ) : null}
    </>
  );
}
