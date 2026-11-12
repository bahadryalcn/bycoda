import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { sprintTaskKey } from "../model/hostSprints";
import { STORY_POINTS, type SprintBoardController } from "../model/sprintClient";
import type { BoardTask } from "../model/taskClient";
import "./tasks-shell.css";

export function SprintPlanningControls({
  board,
  tasks,
  disabled = false,
  layout = "panel",
}: {
  board: SprintBoardController;
  tasks: readonly BoardTask[];
  disabled?: boolean;
  /** `bar` is the slim row under the toolbar in selection mode; `panel` sits inside the detail. */
  layout?: "bar" | "panel";
}) {
  const t = useT();
  const [target, setTarget] = useState("");
  const [points, setPoints] = useState("keep");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [results, setResults] = useState<{ id: string; title: string; error?: string }[]>([]);
  const eligible = board.sprints.filter(
    (sprint) =>
      (sprint.state === "planned" || sprint.state === "active") &&
      tasks.every((task) => {
        const ref = board.taskRef(task);
        return (
          ref &&
          sprint.projects.some(
            (project) =>
              project.environmentId === ref.environmentId && project.projectId === ref.projectId,
          )
        );
      }),
  );
  const run = async () => {
    if (pending.current || disabled || !tasks.length) return;
    pending.current = true;
    setBusy(true);
    setResults([]);
    try {
      for (const task of tasks) {
        try {
          const ref = board.taskRef(task);
          const prior = ref ? board.planning.get(sprintTaskKey(ref)) : undefined;
          await board.plan(
            task,
            target === "keep" || !target
              ? (prior?.sprintId ?? null)
              : target === "backlog"
                ? null
                : target,
            points === "keep" ? undefined : points === "none" ? null : Number(points),
          );
          setResults((rows) => [
            ...rows,
            { id: JSON.stringify([task.machineId, task.projectId, task.id]), title: task.title },
          ]);
        } catch (reason) {
          setResults((rows) => [
            ...rows,
            {
              id: JSON.stringify([task.machineId, task.projectId, task.id]),
              title: task.title,
              error: reason instanceof Error ? reason.message : String(reason),
            },
          ]);
        }
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const failures = results.filter((row) => row.error);
  const firstRef = tasks.length === 1 ? board.taskRef(tasks[0]) : undefined;
  const current = firstRef ? board.planning.get(sprintTaskKey(firstRef)) : undefined;
  return (
    <Text
      as="section"
      size="secondary"
      leading="inherit"
      className="task-planning"
      data-layout={layout}
      aria-label={t("Planning")}
    >
      {tasks.length === 1 ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="inherit"
          className="task-planning-current"
        >
          {t("Sprint")}:{" "}
          {board.sprints.find((sprint) => sprint.id === current?.sprintId)?.name ?? t("Backlog")} ·{" "}
          {t("Story points")}: {current?.storyPoints ?? t("Unestimated")}
        </Text>
      ) : null}
      <div className="task-planning-fields">
        <div className="task-planning-field">
          <SearchableSelect
            hideLabel
            label={t("Sprint")}
            value={target}
            options={[
              { value: "", label: t("Keep current sprint") },
              { value: "backlog", label: t("Move to backlog") },
              ...eligible.map((sprint) => ({ value: sprint.id, label: sprint.name })),
            ]}
            onChange={setTarget}
            disabled={busy || disabled || !board.supported}
          />
        </div>
        <div className="task-planning-field">
          <SearchableSelect
            hideLabel
            label={t("Story points")}
            searchable={false}
            value={points}
            options={[
              { value: "keep", label: t("Keep current points") },
              { value: "none", label: t("Unestimated") },
              ...STORY_POINTS.map((value) => ({ value: String(value), label: String(value) })),
            ]}
            onChange={setPoints}
            disabled={busy || disabled || !board.supported}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => void run()}
          loading={busy}
          disabled={disabled || !board.supported || !tasks.length || (!target && points === "keep")}
        >
          {tasks.length > 1 ? t("Apply to {p0} tasks", { p0: tasks.length }) : t("Save planning")}
        </Button>
      </div>
      {results.length ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="inherit"
          role="status"
          className="task-planning-note"
        >
          {t("Updated {p0} of {p1} tasks", {
            p0: results.length - failures.length,
            p1: tasks.length,
          })}
        </Text>
      ) : null}
      {failures.length ? (
        <Text
          as="ul"
          size="caption"
          tone="danger"
          leading="inherit"
          className="task-planning-errors"
          aria-label={t("Tasks that could not be updated")}
        >
          {failures.map((row) => (
            <li key={row.id}>
              {row.title}: {row.error}
            </li>
          ))}
        </Text>
      ) : null}
      {!board.supported ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="inherit"
          className="task-planning-note"
        >
          {t("Reconnect or update the selected planning Host.")}
        </Text>
      ) : null}
    </Text>
  );
}
