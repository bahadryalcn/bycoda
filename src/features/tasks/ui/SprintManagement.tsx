import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { Calendar, Plus } from "../../../shared/ui/icons";
import { Meter } from "../../../shared/ui/Meter";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import {
  sprintProjectKey,
  type HostSprint,
  type SprintProjectRef,
  type SprintReport,
} from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import { dateNumber, dateValue, displayDate } from "../model/sprintDates";
import { SprintCompletion } from "./SprintCompletion";
import { SprintEditor } from "./SprintEditor";
import { SprintGoalDescription } from "./SprintGoalDescription";
import { SprintHostBar } from "./SprintHostBar";
import { SprintList } from "./SprintList";
import { SprintStatusBadge } from "./SprintStatusBadge";
import "./sprints.css";

export { dateValue as sprintDateValue, dateNumber as sprintDateNumber };
export { SprintGoalDescription };

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
  // The summary belongs to the inputs it was read for; any other key shows none.
  const [answer, setAnswer] = useState<{
    key: string;
    summary: {
      tasks: number;
      completedTasks: number;
      points: number;
      completedPoints: number;
    } | null;
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
  const summaryKey = JSON.stringify([
    selected?.id,
    selectedRevision,
    board.supported,
    board.coordinatorEnvironmentId,
    projectKey,
    visibleProjectKeys,
  ]);
  const summary = answer?.key === summaryKey ? answer.summary : null;
  useEffect(() => {
    if (!selected || !board.supported) return;
    let cancelled = false;
    void board.report(selected.id).then(
      (report) => {
        if (cancelled) return;
        const visibleKey = (key: string) =>
          accessible.has(key) && (!projectKey || key === projectKey);
        const totals = Object.entries(report.projects)
          .filter(([key]) => visibleKey(key))
          .map(([, value]) => value);
        setAnswer({
          key: summaryKey,
          summary: {
            tasks: totals.reduce((sum, row) => sum + row.tasks, 0),
            completedTasks: report.tasks.filter(
              (task) =>
                !task.deleted && task.status === "done" && visibleKey(sprintProjectKey(task)),
            ).length,
            points: totals.reduce((sum, row) => sum + row.points, 0),
            completedPoints: totals.reduce((sum, row) => sum + row.completedPoints, 0),
          },
        });
      },
      () => {
        if (!cancelled) setAnswer({ key: summaryKey, summary: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [summaryKey]);
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
  const nothing = !selected && !rows.length && !board.loading;
  const newSprint = (
    <Button
      variant="primary"
      startIcon={<Plus className="icon-xs" />}
      disabled={!board.supported || !!busy || !projects.length}
      onClick={() => setEditing("new")}
    >
      {t("New sprint")}
    </Button>
  );
  const hostBar = (
    <SprintHostBar board={board} busy={!!busy} error={error} showRefresh={!nothing} />
  );
  return (
    <section className="sprint-management" aria-label={t("Sprints")}>
      {nothing ? (
        <>
          <EmptyState
            context="list"
            kind="empty"
            icon={<Calendar className="icon-lg" />}
            title={t("Plan several tasks together as a sprint")}
            description={t(
              "Choose the projects and the tasks to work on together, then follow the progress.",
            )}
            action={newSprint}
          />
          {hostBar}
        </>
      ) : (
        <>
          <div className="sprint-heading">
            <div className="sprint-title">
              <OverflowTooltip label={selected?.name}>
                <Heading size="section">{selected?.name ?? t("Sprints")}</Heading>
              </OverflowTooltip>
              {selected ? <SprintStatusBadge state={selected.state} /> : null}
              {selected && (selected.startsAt !== undefined || selected.endsAt !== undefined) ? (
                <span className="sprint-dates">
                  {displayDate(selected.startsAt, t("No start date"))} ·{" "}
                  {displayDate(selected.endsAt, t("No end date"))}
                </span>
              ) : null}
            </div>
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
                        void act("complete", async () =>
                          setCompleting(await board.report(selected.id)),
                        )
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
              {newSprint}
            </div>
          </div>
          {hostBar}
        </>
      )}
      {selected?.goal ? <SprintGoalDescription goal={selected.goal} /> : null}
      {selected && summary ? (
        <div className="sprint-progress">
          <DescriptionList columns="auto" size="sm" className="sprint-summary">
            <DescriptionItem term={t("Completed tasks")}>
              {summary.completedTasks} / {summary.tasks}
            </DescriptionItem>
            <DescriptionItem term={t("Completed points")}>
              {summary.completedPoints} / {summary.points}
            </DescriptionItem>
          </DescriptionList>
          {summary.points > 0 ? (
            <Meter
              tone="accent"
              label={t("Completed points")}
              value={summary.completedPoints}
              max={summary.points}
              valueText={`${summary.completedPoints} / ${summary.points}`}
            />
          ) : null}
        </div>
      ) : null}
      {selected && !fullyAccessible(selected) ? (
        <p className="sprint-muted">
          {t(
            "Only accessible projects are shown. Unlock all sprint projects to manage this sprint.",
          )}
        </p>
      ) : null}
      {!selected && !nothing ? (
        <SprintList rows={rows} accessible={accessible} onSelect={onSelect} />
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
