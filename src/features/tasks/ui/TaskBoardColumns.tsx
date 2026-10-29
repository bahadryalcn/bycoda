import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import type { BoardTask } from "../model/taskClient";
import { canMoveTask, TASK_COLUMNS, taskColumn, type TaskColumn } from "../model/hostTasks";
import { t, useLocale } from "../../../shared/i18n";
import { type ComponentProps, useState } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { taskSessionIds } from "../model/backgroundSession";
import { TaskCard } from "./TaskBoardCard";

export const COLUMN_LABELS: Record<TaskColumn, string> = {
  todo: "To do",
  queued: "Queued",
  running: "Running",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

const COLUMN_EMPTY: Record<TaskColumn, string> = {
  todo: "Nothing to do yet",
  queued: "Nothing waiting",
  running: "Nothing running",
  review: "Nothing to review",
  done: "Nothing done yet",
  blocked: "Nothing blocked",
};

/** The board's columns: cards grouped by status, with drag and drop between and
 * within them. Which card is being dragged, and over which column, is this
 * view's own state; every move goes to the board owner through `onTaskDrop`. */
export function TaskBoardColumns({
  tasks,
  visibleTasks,
  columns,
  orders,
  compactColumn,
  onCompactColumnChange,
  now,
  acting,
  bulkBusy,
  selectedKey,
  openingSessions,
  taskContext,
  planningLabel,
  actionsFor,
  onOpen,
  onTaskDrop,
}: {
  tasks: BoardTask[];
  visibleTasks: BoardTask[];
  columns: ReadonlyMap<TaskColumn, BoardTask[]>;
  orders: ReadonlyMap<string, string>;
  compactColumn: TaskColumn | "all";
  onCompactColumnChange: (value: TaskColumn | "all") => void;
  now: number;
  acting: string | null;
  bulkBusy: boolean;
  selectedKey: string | null;
  openingSessions: ReadonlySet<string>;
  taskContext: (task: BoardTask) => { project: string; goal?: string; waitingFor: string[] };
  planningLabel: (task: BoardTask) => string;
  actionsFor: ComponentProps<typeof TaskCard>["actionsFor"];
  onOpen: (key: string) => void;
  onTaskDrop: (task: BoardTask, column: TaskColumn, before?: BoardTask) => Promise<void>;
}) {
  useLocale();
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<TaskColumn | null>(null);
  // The card a reorder would land before; cleared with every other drag cue.
  const [dropBeforeKey, setDropBeforeKey] = useState<string | null>(null);
  const endDrag = () => {
    setDraggedKey(null);
    setDropColumn(null);
    setDropBeforeKey(null);
  };
  const dropTask = (task: BoardTask, column: TaskColumn, before?: BoardTask) => {
    endDrag();
    void onTaskDrop(task, column, before);
  };
  const draggedTask = draggedKey
    ? visibleTasks.find((task) => `${task.machineId}:${task.id}` === draggedKey)
    : undefined;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {draggedTask
          ? t("Moving “{p0}”. Drop it on a column, or use the card's move actions.", {
              p0: draggedTask.title,
            })
          : ""}
      </p>
      {tasks.length > 0 ? (
        <div className="task-board-column-picker">
          <SearchableSelect
            label={t("Status")}
            searchable={false}
            value={compactColumn}
            options={[
              { value: "all", label: t("All") },
              ...TASK_COLUMNS.map((status) => ({
                value: status,
                label: `${t(COLUMN_LABELS[status])} · ${columns.get(status)!.length}`,
              })),
            ]}
            onChange={(value) => onCompactColumnChange(value as TaskColumn | "all")}
          />
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <EmptyState
          icon={null}
          description={t(
            visibleTasks.length ? "No tasks match your search or filters." : "Nothing to do yet",
          )}
        />
      ) : null}
      {tasks.length > 0 ? (
        <div className="task-board-columns">
          {TASK_COLUMNS.map((status) => {
            const column = columns.get(status)!;
            return (
              <section
                key={status}
                aria-label={t(COLUMN_LABELS[status])}
                data-task-column={status}
                data-empty={column.length === 0 || undefined}
                data-compact-selected={
                  compactColumn === "all" || compactColumn === status || undefined
                }
                data-drop-active={dropColumn === status || undefined}
                onDragOver={(event) => {
                  const dragged = visibleTasks.find(
                    (task) => `${task.machineId}:${task.id}` === draggedKey,
                  );
                  if (
                    dragged &&
                    ((taskColumn(dragged.status) === status &&
                      dragged.workspaceControlsSupported &&
                      (status === "todo" || status === "queued")) ||
                      canMoveTask(
                        dragged.status,
                        status,
                        dragged.crewRunId ?? dragged.crewDefinitionId,
                      ))
                  ) {
                    event.preventDefault();
                    setDropColumn(status);
                    setDropBeforeKey(null);
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDropColumn(null);
                    setDropBeforeKey(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const dragged = visibleTasks.find(
                    (task) => `${task.machineId}:${task.id}` === draggedKey,
                  );
                  if (dragged) dropTask(dragged, status);
                }}
                className="bycoda-task-column flex min-h-0 min-w-0 flex-col rounded-md bg-(--ui-surface-raised)"
              >
                <h2 className="flex h-9 shrink-0 items-center gap-2 px-3 text-ui-caption font-medium text-(--ui-text-secondary)">
                  <span className="min-w-0 flex-1 truncate">{t(COLUMN_LABELS[status])}</span>
                  <Badge className="shrink-0 tabular-nums">{column.length}</Badge>
                </h2>
                <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
                  {column.map((task) => (
                    <li
                      key={`${task.machineId}:${task.id}`}
                      draggable={
                        !acting &&
                        !task.stale &&
                        (task.status === "todo" ||
                          task.status === "queued" ||
                          TASK_COLUMNS.some((column) =>
                            canMoveTask(
                              task.status,
                              column,
                              task.crewRunId ?? task.crewDefinitionId,
                            ),
                          ))
                      }
                      data-dragging={draggedKey === `${task.machineId}:${task.id}` || undefined}
                      data-drop-before={
                        dropBeforeKey === `${task.machineId}:${task.id}` ? true : undefined
                      }
                      onDragOver={(event) => {
                        // A reorder inside the column marks the card it would land before.
                        const key = `${task.machineId}:${task.id}`;
                        if (
                          draggedTask &&
                          key !== draggedKey &&
                          taskColumn(draggedTask.status) === status &&
                          draggedTask.workspaceControlsSupported &&
                          (status === "todo" || status === "queued")
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          setDropColumn(status);
                          setDropBeforeKey(key);
                        }
                      }}
                      onDragStart={(event) => {
                        if ((event.target as Element).closest("button,input,textarea,select")) {
                          event.preventDefault();
                          return;
                        }
                        const key = `${task.machineId}:${task.id}`;
                        event.dataTransfer.setData("application/x-bycoda-task", key);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedKey(key);
                      }}
                      onDragEnd={endDrag}
                      onDrop={(event) => {
                        const dragged = visibleTasks.find(
                          (item) => `${item.machineId}:${item.id}` === draggedKey,
                        );
                        if (dragged && taskColumn(dragged.status) === status) {
                          event.preventDefault();
                          event.stopPropagation();
                          dropTask(dragged, status, task);
                        }
                      }}
                    >
                      <TaskCard
                        task={task}
                        now={now}
                        project={taskContext(task).project}
                        goal={taskContext(task).goal}
                        planning={planningLabel(task)}
                        waitingForText={JSON.stringify(taskContext(task).waitingFor)}
                        actionsFor={actionsFor}
                        busy={acting != null || bulkBusy}
                        openingState={JSON.stringify(
                          [taskSessionIds(task).worker, taskSessionIds(task).review].map(
                            (id) =>
                              !!id && openingSessions.has(JSON.stringify([task.machineId, id])),
                          ),
                        )}
                        orderKey={orders.get(task.machineId + ":" + task.id) ?? ""}
                        selected={task.machineId + ":" + task.id === selectedKey}
                        onOpen={onOpen}
                      />
                    </li>
                  ))}
                  {column.length === 0 && visibleTasks.length > 0 ? (
                    <li>
                      <EmptyState
                        className="task-column-empty"
                        icon={null}
                        description={t(COLUMN_EMPTY[status])}
                      />
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
