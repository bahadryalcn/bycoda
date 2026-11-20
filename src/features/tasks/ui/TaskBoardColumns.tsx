import { LiveText } from "../../../shared/ui/LiveText";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { type BoardTask } from "../model/taskClient";
import { TASK_COLUMNS, type TaskColumn } from "../model/hostTasks";
import { t, useLocale } from "../../../shared/i18n";
import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { TaskCard } from "./TaskBoardCard";
import { COLUMN_LABELS, TaskBoardColumn } from "./TaskBoardColumn";
import { createTaskBoardDrag, taskCardKey, useTaskBoardDrag } from "./taskBoardDrag";
import "./task-board.css";

export { COLUMN_LABELS };

/** The board's columns: cards grouped by status, with drag and drop between and
 * within them. Which card is being dragged, and over which column, lives in a small
 * drag store the lanes and cards subscribe to; every move goes to the board owner
 * through `onTaskDrop`. */
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
  empty,
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
  taskContext: (task: BoardTask) => {
    project: string;
    goal?: string;
    waitingFor: string[];
  };
  planningLabel: (task: BoardTask) => string;
  actionsFor: ComponentProps<typeof TaskCard>["actionsFor"];
  onOpen: (key: string) => void;
  onTaskDrop: (task: BoardTask, column: TaskColumn, before?: BoardTask) => Promise<void>;
  /** Shown instead of the columns when no task is visible; the board owner knows why. */
  empty: ReactNode;
}) {
  useLocale();
  const [drag] = useState(createTaskBoardDrag);
  // Only drag start and end re-render the board; `dragover` cues stay in the lanes and cards.
  const draggedKey = useTaskBoardDrag(drag, (state) => state.draggedKey);
  // One index per task list change, so every drag event resolves its task without a scan.
  const tasksByKey = useMemo(
    () => new Map(visibleTasks.map((task) => [taskCardKey(task), task])),
    [visibleTasks],
  );
  const findTask = useStableCallback((key: string | null) =>
    key ? tasksByKey.get(key) : undefined,
  );
  const dropTask = useStableCallback((task: BoardTask, column: TaskColumn, before?: BoardTask) => {
    drag.end();
    void onTaskDrop(task, column, before);
  });
  const draggedTask = findTask(draggedKey);
  return (
    <>
      <LiveText
        className="sr-only"
        text={
          draggedTask
            ? t("Moving “{p0}”. Drop it on a column, or use the card's move actions.", {
                p0: draggedTask.title,
              })
            : ""
        }
      />
      {tasks.length > 0 ? (
        <div className="task-board-column-picker">
          <SearchableSelect
            hideLabel
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
      {tasks.length === 0 ? empty : null}
      {tasks.length > 0 ? (
        <div
          className="task-board-columns"
          data-single-column={compactColumn !== "all" || undefined}
          data-dragging={draggedKey !== null || undefined}
        >
          {TASK_COLUMNS.map((status) => (
            <TaskBoardColumn
              key={status}
              status={status}
              column={columns.get(status)!}
              showEmptyNote={visibleTasks.length > 0}
              compactSelected={compactColumn === "all" || compactColumn === status}
              drag={drag}
              findTask={findTask}
              onDropTask={dropTask}
              now={now}
              acting={acting}
              bulkBusy={bulkBusy}
              selectedKey={selectedKey}
              openingSessions={openingSessions}
              orders={orders}
              taskContext={taskContext}
              planningLabel={planningLabel}
              actionsFor={actionsFor}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
