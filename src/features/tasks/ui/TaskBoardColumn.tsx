import { actionDragAttributes } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { BadgeTone } from "../../../shared/ui/Badge";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { type BoardTask, taskTimeLabel } from "../model/taskClient";
import { taskColumn, type TaskColumn } from "../model/hostTasks";
import { t } from "../../../shared/i18n";
import { type ComponentProps, memo, useEffect, useRef, useState } from "react";
import { taskSessionIds } from "../model/backgroundSession";
import { TaskCard } from "./TaskBoardCard";
import {
  canDropOnColumn,
  canReorderInColumn,
  taskCardKey,
  taskDraggable,
  useTaskBoardDrag,
  type TaskBoardDrag,
} from "./taskBoardDrag";
import { COLUMN_WINDOW, columnWindowSize } from "./taskBoardWindow";
import "./task-board.css";

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
const COLUMN_TONES: Partial<Record<TaskColumn, BadgeTone>> = {
  queued: "info",
  running: "accent",
  review: "warning",
  done: "success",
  blocked: "danger",
};

type TaskContext = {
  project: string;
  goal?: string;
  waitingFor: string[];
  helperFailure?: string;
};

/** One status lane. It renders a window of its cards (`COLUMN_WINDOW`, then "Load more"),
 * resolves each card's context once, and subscribes only to whether it is the drop target. */
export const TaskBoardColumn = memo(function TaskBoardColumn({
  status,
  column,
  showEmptyNote,
  compactSelected,
  drag,
  findTask,
  onDropTask,
  now,
  acting,
  bulkBusy,
  selectedKey,
  openingSessions,
  orders,
  taskContext,
  planningLabel,
  actionsFor,
  onOpen,
}: {
  status: TaskColumn;
  column: readonly BoardTask[];
  /** Another lane has cards, so this empty one explains itself. */
  showEmptyNote: boolean;
  compactSelected: boolean;
  drag: TaskBoardDrag;
  findTask: (key: string | null) => BoardTask | undefined;
  onDropTask: (task: BoardTask, column: TaskColumn, before?: BoardTask) => void;
  now: number;
  acting: string | null;
  bulkBusy: boolean;
  selectedKey: string | null;
  openingSessions: ReadonlySet<string>;
  orders: ReadonlyMap<string, string>;
  taskContext: (task: BoardTask) => TaskContext;
  planningLabel: (task: BoardTask) => string;
  actionsFor: ComponentProps<typeof TaskCard>["actionsFor"];
  onOpen: (key: string) => void;
}) {
  const dropActive = useTaskBoardDrag(drag, (state) => state.dropColumn === status);
  const [limit, setLimit] = useState(COLUMN_WINDOW);
  const list = useRef<HTMLUListElement>(null);
  // Written by focus events, read only while sizing the window.
  const focusedKey = useRef<string | null>(null);
  const revealFrom = useRef<number | null>(null);
  const size = columnWindowSize(column, limit, [selectedKey, focusedKey.current]);
  const shown = size < column.length ? column.slice(0, size) : column;
  const loadMore = () => {
    revealFrom.current = size;
    setLimit(size + COLUMN_WINDOW);
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Focus the first newly mounted card after the load-more window grows.
  useEffect(() => {
    const from = revealFrom.current;
    if (from === null) return;
    revealFrom.current = null;
    list.current?.querySelectorAll<HTMLElement>(":scope > li > article")[from]?.focus();
  }, [size]);
  const frame = surfaceAttributes(
    { variant: "card", frame: "card", radius: "card" },
    "bycoda-task-column flex min-h-0 min-w-0 flex-col",
  );
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The section is a drop target and cards expose move actions independently.
    <section
      aria-label={t(COLUMN_LABELS[status])}
      data-task-column={status}
      data-empty={column.length === 0 || undefined}
      data-compact-selected={compactSelected || undefined}
      data-drop-active={dropActive || undefined}
      onDragOver={(event) => {
        const dragged = findTask(drag.get().draggedKey);
        if (dragged && canDropOnColumn(dragged, status)) {
          event.preventDefault();
          drag.set({ dropColumn: status, dropBeforeKey: null });
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          drag.set({ dropColumn: null, dropBeforeKey: null });
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const dragged = findTask(drag.get().draggedKey);
        if (dragged) onDropTask(dragged, status);
      }}
      {...frame}
      {...actionDragAttributes({ target: dropActive }, frame.className)}
    >
      <SectionLabel
        as="h2"
        {...surfaceAttributes({ frame: "none" }, "shrink-0 px-3")}
        count={column.length}
        icon={
          COLUMN_TONES[status] ? (
            <StatusDot tone={COLUMN_TONES[status]} label={t(COLUMN_LABELS[status])} aria-hidden />
          ) : undefined
        }
      >
        {t(COLUMN_LABELS[status])}
      </SectionLabel>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Observe bubbled focus to keep the focused card in the window. */}
      <ul
        ref={list}
        onFocus={(event) => {
          focusedKey.current =
            (event.target as Element).closest("li[data-task-key]")?.getAttribute("data-task-key") ??
            null;
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) focusedKey.current = null;
        }}
      >
        {shown.map((task) => {
          const key = taskCardKey(task);
          const context = taskContext(task);
          const sessions = taskSessionIds(task);
          return (
            <TaskBoardItem
              key={key}
              task={task}
              status={status}
              draggable={taskDraggable(task, acting)}
              drag={drag}
              findTask={findTask}
              onDropTask={onDropTask}
              timeLabel={taskTimeLabel(task, now)}
              project={context.project}
              goal={context.goal}
              helperFailure={context.helperFailure}
              planning={planningLabel(task)}
              waitingForText={context.waitingFor.length ? JSON.stringify(context.waitingFor) : ""}
              actionsFor={actionsFor}
              busy={acting != null || bulkBusy}
              openingState={[sessions.worker, sessions.review]
                .map((id) => !!id && openingSessions.has(JSON.stringify([task.machineId, id])))
                .join(",")}
              orderKey={orders.get(key) ?? ""}
              selected={key === selectedKey}
              onOpen={onOpen}
            />
          );
        })}
        {size < column.length ? (
          <li>
            <CollectionFooter standalone hasMore onLoadMore={loadMore} />
          </li>
        ) : null}
        {column.length === 0 && showEmptyNote ? (
          <li>
            <Text
              as="p"
              size="caption"
              tone="muted"
              leading="inherit"
              className="task-column-empty"
            >
              {t(COLUMN_EMPTY[status])}
            </Text>
          </li>
        ) : null}
      </ul>
    </section>
  );
});

/** A card and its drag cues. It reads its own cue from the drag store and every event's
 * dragged task at event time, so a `dragover` elsewhere never re-renders it. */
const TaskBoardItem = memo(function TaskBoardItem({
  task,
  status,
  draggable,
  drag,
  findTask,
  onDropTask,
  ...card
}: {
  task: BoardTask;
  status: TaskColumn;
  draggable: boolean;
  drag: TaskBoardDrag;
  findTask: (key: string | null) => BoardTask | undefined;
  onDropTask: (task: BoardTask, column: TaskColumn, before?: BoardTask) => void;
} & Omit<ComponentProps<typeof TaskCard>, "task">) {
  const key = taskCardKey(task);
  const dragging = useTaskBoardDrag(drag, (state) => state.draggedKey === key);
  const before = useTaskBoardDrag(drag, (state) => state.dropBeforeKey === key);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The list item carries native drag events while the card owns keyboard actions.
    <li
      data-task-key={key}
      draggable={draggable}
      {...actionDragAttributes({ dragging, before })}
      data-dragging={dragging || undefined}
      data-drop-before={before ? true : undefined}
      onDragOver={(event) => {
        // A reorder inside the column marks the card it would land before.
        const dragged = findTask(drag.get().draggedKey);
        if (dragged && key !== taskCardKey(dragged) && canReorderInColumn(dragged, status)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          drag.set({ dropColumn: status, dropBeforeKey: key });
        }
      }}
      onDragStart={(event) => {
        if ((event.target as Element).closest("button,input,textarea,select")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("application/x-bycoda-task", key);
        event.dataTransfer.effectAllowed = "move";
        drag.set({ draggedKey: key });
      }}
      onDragEnd={() => drag.end()}
      onDrop={(event) => {
        const dragged = findTask(drag.get().draggedKey);
        if (dragged && taskColumn(dragged.status) === status) {
          event.preventDefault();
          event.stopPropagation();
          onDropTask(dragged, status, task);
        }
      }}
    >
      <TaskCard task={task} {...card} />
    </li>
  );
});
