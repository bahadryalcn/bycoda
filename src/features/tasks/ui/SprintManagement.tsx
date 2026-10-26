import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import {
  sprintProjectKey,
  sprintTaskKey,
  type HostSprint,
  type SprintFields,
  type SprintProjectRef,
  type SprintReport,
} from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

const dateValue = (value?: number) =>
  value === undefined ? "" : new Date(value).toISOString().slice(0, 10);
const dateNumber = (value: string) =>
  value ? new Date(`${value}T00:00:00Z`).getTime() : undefined;
export { dateValue as sprintDateValue, dateNumber as sprintDateNumber };

export function SprintManagement({
  board,
  projects,
  selectedId,
  onSelect,
  projectKey,
}: {
  board: SprintBoardController;
  projects: readonly SprintProjectRef[];
  selectedId: string;
  onSelect: (id: string) => void;
  projectKey?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState<HostSprint | "new" | null>(null);
  const [completing, setCompleting] = useState<SprintReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("all");
  const [summary, setSummary] = useState<{
    tasks: number;
    completedTasks: number;
    points: number;
    completedPoints: number;
  } | null>(null);
  const pending = useRef(false);
  const accessible = new Set(projects.map(sprintProjectKey));
  const rows = board.sprints.filter(
    (sprint) =>
      sprint.projects.some((project) => accessible.has(sprintProjectKey(project))) &&
      (!projectKey || sprint.projects.some((project) => sprintProjectKey(project) === projectKey)),
  );
  const selected = rows.find((sprint) => sprint.id === selectedId);
  const selectedRevision = `${selected?.revision ?? 0}:${board.sources.map((source) => `${source.environmentId}:${source.cursor}`).join("|")}:${[...board.planning.values()].map((item) => item.revision).join(",")}`;
  const visibleProjectKeys = [...accessible].sort().join("|");
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    if (!selected || !board.supported) return;
    void board.report(selected.id).then(
      (report) => {
        if (cancelled) return;
        const visibleKey = (key: string) =>
          accessible.has(key) && (!projectKey || key === projectKey);
        const totals = Object.entries(report.projects)
          .filter(([key]) => visibleKey(key))
          .map(([, value]) => value);
        setSummary({
          tasks: totals.reduce((sum, row) => sum + row.tasks, 0),
          completedTasks: report.tasks.filter(
            (task) => !task.deleted && task.status === "done" && visibleKey(sprintProjectKey(task)),
          ).length,
          points: totals.reduce((sum, row) => sum + row.points, 0),
          completedPoints: totals.reduce((sum, row) => sum + row.completedPoints, 0),
        });
      },
      () => {
        if (!cancelled) setSummary(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    selected?.id,
    selectedRevision,
    board.supported,
    board.coordinatorEnvironmentId,
    projectKey,
    visibleProjectKeys,
  ]);
  const fullyAccessible = (sprint: HostSprint) =>
    sprint.projects.every((project) => accessible.has(sprintProjectKey(project)));
  const act = async (id: string, operation: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(id);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  return (
    <section className="sprint-management" aria-label={t("Sprints")}>
      <div className="sprint-heading">
        <h2 title={selected?.name}>{selected?.name ?? t("Sprints")}</h2>
        <div className="sprint-actions">
          {selected && fullyAccessible(selected) ? (
            <>
              {selected.state === "planned" || selected.state === "active" ? (
                <Button disabled={!!busy} onClick={() => setEditing(selected)}>
                  {t("Edit sprint")}
                </Button>
              ) : null}
              {selected.state === "planned" ? (
                <Button
                  loading={busy === "start"}
                  disabled={!!busy || !!board.lifecycleIssue(selected)}
                  onClick={() => void act("start", () => board.command(selected, "start"))}
                >
                  {t("Start sprint")}
                </Button>
              ) : null}
              {selected.state === "active" ? (
                <Button
                  loading={busy === "complete"}
                  disabled={!!busy || !!board.lifecycleIssue(selected)}
                  onClick={() =>
                    void act("complete", async () => setCompleting(await board.report(selected.id)))
                  }
                >
                  {t("Complete sprint")}
                </Button>
              ) : null}
              {selected.state === "completed" ? (
                <Button
                  loading={busy === "archive"}
                  disabled={!!busy}
                  onClick={() => void act("archive", () => board.command(selected, "archive"))}
                >
                  {t("Archive sprint")}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            variant="primary"
            disabled={!board.supported || !!busy || !projects.length}
            onClick={() => setEditing("new")}
          >
            {t("New sprint")}
          </Button>
        </div>
      </div>
      <div className="sprint-context">
        <span>{t("Planning Host")}</span>
        <div className="sprint-source">
          <SearchableSelect
            label={t("Planning Host")}
            value={board.coordinatorEnvironmentId}
            options={[
              ...(!board.coordinator && board.coordinatorEnvironmentId
                ? [
                    {
                      value: board.coordinatorEnvironmentId,
                      label: t("Selected Host is unavailable"),
                      disabled: true,
                    },
                  ]
                : []),
              ...[
                ...new Map(
                  board.machines.map((machine) => [machine.environmentId, machine]),
                ).values(),
              ].map((machine) => ({ value: machine.environmentId, label: machine.name })),
            ]}
            onChange={board.setCoordinatorEnvironmentId}
            disabled={!!busy}
          />
        </div>
        <Button variant="ghost" loading={board.loading} onClick={() => void board.refresh()}>
          {t("Refresh")}
        </Button>
        {selected ? (
          <>
            <span>
              {t(
                {
                  planned: "Planned",
                  active: "Active",
                  completed: "Completed",
                  archived: "Archived",
                }[selected.state],
              )}
            </span>
            {selected.startsAt || selected.endsAt ? (
              <span>
                {dateValue(selected.startsAt) || t("No start date")} ·{" "}
                {dateValue(selected.endsAt) || t("No end date")}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {selected?.goal ? <SprintGoalDescription goal={selected.goal} /> : null}
      {selected && summary ? (
        <dl className="sprint-summary">
          <div>
            <dt>{t("Completed tasks")}</dt>
            <dd>
              {summary.completedTasks} / {summary.tasks}
            </dd>
          </div>
          <div>
            <dt>{t("Completed points")}</dt>
            <dd>
              {summary.completedPoints} / {summary.points}
            </dd>
          </div>
        </dl>
      ) : null}
      {selected && !fullyAccessible(selected) ? (
        <p className="sprint-muted">
          {t(
            "Only accessible projects are shown. Unlock all sprint projects to manage this sprint.",
          )}
        </p>
      ) : null}
      {error || board.error ? (
        <p role="alert" className="sprint-errors">
          {error || board.error}
        </p>
      ) : null}
      {board.syncErrors.length ? (
        <details>
          <summary>{t("Some machines need synchronization")}</summary>
          <ul className="sprint-errors">
            {board.syncErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {!selected ? (
        <>
          <div className="sprint-context">
            <SearchableSelect
              label={t("Sprint status")}
              searchable={false}
              value={stateFilter}
              onChange={setStateFilter}
              options={[
                { value: "all", label: t("All") },
                { value: "planned", label: t("Planned") },
                { value: "active", label: t("Active") },
                { value: "completed", label: t("Completed") },
                { value: "archived", label: t("Archived") },
              ]}
            />
          </div>
          <ul className="sprint-collection">
            {rows
              .filter((sprint) => stateFilter === "all" || sprint.state === stateFilter)
              .map((sprint) => (
                <li className="sprint-row" key={sprint.id}>
                  <div>
                    <Button variant="link" align="start" onClick={() => onSelect(sprint.id)}>
                      {sprint.name}
                    </Button>
                    <p>
                      {sprint.projects
                        .filter((project) => accessible.has(sprintProjectKey(project)))
                        .map((project) => project.name)
                        .join(" · ")}
                    </p>
                  </div>
                  <span>
                    {t(
                      {
                        planned: "Planned",
                        active: "Active",
                        completed: "Completed",
                        archived: "Archived",
                      }[sprint.state],
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </>
      ) : null}
      {!selected && !rows.length && !board.loading ? (
        <p className="sprint-muted">
          {t("Create a sprint and choose the projects you want to plan together.")}
        </p>
      ) : null}
      {editing ? (
        <SprintEditor
          key={editing === "new" ? "new" : editing.id}
          sprint={editing === "new" ? undefined : editing}
          projects={projects}
          defaultProjectKey={projectKey}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            const saved =
              editing === "new"
                ? await board.create(fields)
                : await board.update(editing, {
                    ...fields,
                    goal: fields.goal ?? null,
                    startsAt: fields.startsAt ?? null,
                    endsAt: fields.endsAt ?? null,
                  });
            setEditing(null);
            onSelect(saved.id);
          }}
        />
      ) : null}
      {completing ? (
        <SprintCompletion
          board={board}
          report={completing}
          onClose={() => setCompleting(null)}
          onComplete={async (options) => {
            await board.command(completing.sprint, "complete", options);
            setCompleting(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function SprintGoalDescription({ goal }: { goal: string }) {
  const t = useT();
  if (goal.length <= 180 && !/\n\s*\n/.test(goal))
    return <p className="sprint-goal-copy">{goal}</p>;
  return (
    <details className="sprint-goal-disclosure">
      <summary>{t("Sprint goal")}</summary>
      <p className="sprint-goal-copy sprint-goal-scroll" tabIndex={0} aria-label={t("Sprint goal")}>
        {goal}
      </p>
    </details>
  );
}

function SprintEditor({
  sprint,
  projects,
  defaultProjectKey,
  onClose,
  onSave,
}: {
  sprint?: HostSprint;
  projects: readonly SprintProjectRef[];
  defaultProjectKey?: string;
  onClose: () => void;
  onSave: (fields: SprintFields) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [selected, setSelected] = useState(
    sprint?.projects.map(sprintProjectKey) ?? (defaultProjectKey ? [defaultProjectKey] : []),
  );
  const [startsAt, setStartsAt] = useState(dateValue(sprint?.startsAt));
  const [endsAt, setEndsAt] = useState(dateValue(sprint?.endsAt));
  const [capacity, setCapacity] = useState(sprint?.capacityPoints?.toString() ?? "");
  const [budgets, setBudgets] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(sprint?.projectCapacities ?? {}).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={sprint ? t("Edit sprint") : t("New sprint")}
      onClose={() => {
        if (!busy) onClose();
      }}
      fitViewport
    >
      <form
        className="sprint-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
            if (!selected.length) throw new Error(t("Choose at least one project."));
            if (startsAt && endsAt && endsAt <= startsAt)
              throw new Error(t("The end date must follow the start date."));
            await onSave({
              name: name.trim(),
              goal: goal.trim() || undefined,
              projects: projects.filter((project) => selected.includes(sprintProjectKey(project))),
              startsAt: dateNumber(startsAt),
              endsAt: dateNumber(endsAt),
              capacityPoints: capacity ? Number(capacity) : null,
              projectCapacities: Object.fromEntries(
                selected
                  .filter((key) => budgets[key]?.trim())
                  .map((key) => [key, Number(budgets[key])]),
              ),
            });
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <TextField
          label={t("Sprint name")}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
          maxLength={160}
          disabled={busy}
          autoFocus
        />
        <TextareaField
          label={t("Sprint goal")}
          value={goal}
          onChange={(event) => setGoal(event.currentTarget.value)}
          disabled={busy}
          rows={2}
        />
        <label>
          <span>{t("Projects")}</span>
          <SearchableSelect
            multiple
            label={t("Projects")}
            value={selected}
            onChange={setSelected}
            options={projects.map((project) => ({
              value: sprintProjectKey(project),
              label: project.name,
              description: project.cwd,
              keywords: `${project.environmentId} ${project.cwd}`,
            }))}
            disabled={busy}
          />
        </label>
        <div className="sprint-form-grid">
          <TextField
            type="date"
            label={t("Start date")}
            value={startsAt}
            onChange={(event) => setStartsAt(event.currentTarget.value)}
            disabled={busy}
          />
          <TextField
            type="date"
            label={t("End date")}
            value={endsAt}
            min={startsAt || undefined}
            onChange={(event) => setEndsAt(event.currentTarget.value)}
            disabled={busy}
          />
        </div>
        <NumberField
          label={t("Sprint capacity (points)")}
          value={capacity}
          min={0}
          step={1}
          onChange={(event) => setCapacity(event.currentTarget.value)}
          disabled={busy}
        />
        {selected.length ? (
          <details>
            <summary>{t("Project capacity budgets")}</summary>
            {projects
              .filter((project) => selected.includes(sprintProjectKey(project)))
              .map((project) => {
                const key = sprintProjectKey(project);
                return (
                  <div className="sprint-project-budget" key={key}>
                    <span>{project.name}</span>
                    <NumberField
                      label={t("Capacity for {p0}", { p0: project.name })}
                      hideLabel
                      min={0}
                      step={1}
                      value={budgets[key] ?? ""}
                      onChange={(event) =>
                        setBudgets((value) => ({ ...value, [key]: event.currentTarget.value }))
                      }
                      disabled={busy}
                    />
                  </div>
                );
              })}
          </details>
        ) : null}
        {error ? (
          <p role="alert" className="sprint-errors">
            {error}
          </p>
        ) : null}
        <footer>
          <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={busy}
            disabled={!name.trim() || !selected.length}
          >
            {t("Save sprint")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function SprintCompletion({
  board,
  report,
  onClose,
  onComplete,
}: {
  board: SprintBoardController;
  report: SprintReport;
  onClose: () => void;
  onComplete: (options: {
    rollover?: { taskKeys: string[]; targetSprintId: string | null };
  }) => Promise<void>;
}) {
  const t = useT();
  const unfinished = report.tasks.filter((task) => task.status !== "done" && !task.deleted);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("backlog");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const targets = board.sprints.filter(
    (sprint) =>
      sprint.id !== report.sprint.id &&
      (sprint.state === "planned" || sprint.state === "active") &&
      unfinished
        .filter((task) => selected.includes(sprintTaskKey(task)))
        .every((task) =>
          sprint.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(task)),
        ),
  );
  useEffect(() => {
    if (target !== "backlog" && !targets.some((sprint) => sprint.id === target))
      setTarget("backlog");
  }, [target, targets]);
  return (
    <Modal
      title={t("Complete sprint")}
      onClose={() => {
        if (!busy) onClose();
      }}
      fitViewport
    >
      <form
        className="sprint-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
            await onComplete(
              selected.length
                ? {
                    rollover: {
                      taskKeys: selected,
                      targetSprintId: target === "backlog" ? null : target,
                    },
                  }
                : {},
            );
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <p>
          {t(
            "The sprint report will be frozen. Select unfinished tasks to move; other tasks keep their sprint history.",
          )}
        </p>
        <ul className="sprint-complete-tasks">
          {unfinished.map((task) => {
            const key = sprintTaskKey(task);
            return (
              <li key={key}>
                <label>
                  <Checkbox
                    checked={selected.includes(key)}
                    onChange={(event) =>
                      setSelected((value) =>
                        event.currentTarget.checked
                          ? [...value, key]
                          : value.filter((item) => item !== key),
                      )
                    }
                    disabled={busy}
                  />
                  <span>{task.title}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {selected.length ? (
          <SearchableSelect
            label={t("Move selected tasks to")}
            value={target}
            onChange={setTarget}
            options={[
              { value: "backlog", label: t("Backlog") },
              ...targets.map((sprint) => ({ value: sprint.id, label: sprint.name })),
            ]}
            disabled={busy}
          />
        ) : null}
        {error ? (
          <p role="alert" className="sprint-errors">
            {error}
          </p>
        ) : null}
        <footer>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t("Complete sprint")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
