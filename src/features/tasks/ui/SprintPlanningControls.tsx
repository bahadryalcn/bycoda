import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { sprintTaskKey } from "../model/hostSprints";
import { STORY_POINTS, type SprintBoardController } from "../model/sprintClient";
import type { BoardTask } from "../model/taskClient";
import "./sprints.css";
import { presentRemoteError } from "../../connections/public/remoteFailure";

/** Move tasks to a sprint or the backlog and set their story points. */
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
  const [batchTotal, setBatchTotal] = useState(0);
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
  const single = tasks.length === 1;
  const run = async (nextTarget: string, nextPoints: string) => {
    if (pending.current || disabled || !tasks.length) return;
    pending.current = true;
    setBusy(true);
    setResults([]);
    setBatchTotal(tasks.length);
    try {
      for (const task of tasks) {
        try {
          const ref = board.taskRef(task);
          const prior = ref ? board.planning.get(sprintTaskKey(ref)) : undefined;
          await board.plan(
            task,
            nextTarget === "keep" || !nextTarget
              ? (prior?.sprintId ?? null)
              : nextTarget === "backlog"
                ? null
                : nextTarget,
            nextPoints === "keep" ? undefined : nextPoints === "none" ? null : Number(nextPoints),
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
              error: presentRemoteError(reason, { explicit: true }),
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
  // One task: the selects show its real sprint and points and save on change. Several tasks keep
  // "keep current" choices and one Apply button that only appears once something differs.
  const currentSprint = board.sprints.find((sprint) => sprint.id === current?.sprintId);
  const sprintOptions = [
    ...(single
      ? [{ value: "backlog", label: t("Backlog") }]
      : [
          { value: "", label: t("Keep current sprint") },
          { value: "backlog", label: t("Move to backlog") },
        ]),
    ...(single && currentSprint && !eligible.includes(currentSprint) ? [currentSprint] : []),
    ...eligible,
  ].map((entry) => ("name" in entry ? { value: entry.id, label: entry.name } : entry));
  const pointOptions = [
    ...(single ? [] : [{ value: "keep", label: t("Keep current points") }]),
    { value: "none", label: t("Unestimated") },
    ...STORY_POINTS.map((value) => ({ value: String(value), label: String(value) })),
  ];
  const sprintValue = single ? (current?.sprintId ?? "backlog") : target;
  const pointsValue = single
    ? current?.storyPoints != null
      ? String(current.storyPoints)
      : "none"
    : points;
  const changed = Boolean(target) || points !== "keep";
  return (
    <Text
      as="section"
      size="secondary"
      leading="inherit"
      {...surfaceAttributes(
        layout === "bar" ? { frame: "pane", edge: "bottom" } : {},
        "sprint-planning",
      )}
      data-layout={layout}
      aria-label={t("Planning")}
    >
      <div className="sprint-planning-fields">
        <div className="sprint-planning-field">
          <SearchableSelect
            hideLabel={!single}
            label={t("Sprint")}
            value={sprintValue}
            options={sprintOptions}
            onChange={(value) => (single ? void run(value, "keep") : setTarget(value))}
            disabled={busy || disabled || !board.supported}
          />
        </div>
        <div className="sprint-planning-field">
          <SearchableSelect
            hideLabel={!single}
            label={single ? t("Points") : t("Story points")}
            searchable={false}
            value={pointsValue}
            options={pointOptions}
            onChange={(value) => (single ? void run("", value) : setPoints(value))}
            disabled={busy || disabled || !board.supported}
          />
        </div>
        {!single && changed ? (
          <Button
            variant="secondary"
            onClick={() => void run(target, points)}
            loading={busy}
            disabled={disabled || !board.supported || !tasks.length}
            disabledReason={
              board.supported ? undefined : t("Reconnect or update the selected planning Host.")
            }
          >
            {t("Apply to {p0} tasks", { p0: tasks.length })}
          </Button>
        ) : null}
      </div>
      {results.length ? (
        <LiveText
          text={t("Updated {p0} of {p1} tasks", {
            p0: results.length - failures.length,
            p1: batchTotal,
          })}
          size="caption"
          tone="secondary"
          leading="inherit"
          className="sprint-planning-note"
        />
      ) : null}
      {failures.length ? (
        <Text
          as="ul"
          size="caption"
          tone="danger"
          leading="inherit"
          className="sprint-planning-errors"
          aria-label={t("Tasks that could not be updated")}
        >
          {failures.map((row) => (
            <li key={row.id}>
              {row.title}: {row.error}
            </li>
          ))}
        </Text>
      ) : null}
    </Text>
  );
}
