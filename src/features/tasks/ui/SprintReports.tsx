import { useEffect, useState } from "react";
import { useLocale, useT } from "../../../shared/i18n";
import { BarChart, LineChart, type LineChartDatum } from "../../../shared/ui/Charts";
import { Button } from "../../../shared/ui/Button";
import { sprintProjectKey, type SprintReport, type SprintTotals } from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import "./sprints.css";

const sumTotals = (rows: readonly SprintTotals[]): SprintTotals =>
  rows.reduce(
    (total, row) => ({
      tasks: total.tasks + row.tasks,
      points: total.points + row.points,
      completedPoints: total.completedPoints + row.completedPoints,
      remainingPoints: total.remainingPoints + row.remainingPoints,
      unestimated: total.unestimated + row.unestimated,
      deleted: total.deleted + row.deleted,
    }),
    { tasks: 0, points: 0, completedPoints: 0, remainingPoints: 0, unestimated: 0, deleted: 0 },
  );

export function SprintReports({
  board,
  sprintId,
  projectKey,
}: {
  board: SprintBoardController;
  sprintId: string;
  projectKey?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [report, setReport] = useState<SprintReport | null>(null);
  const [history, setHistory] = useState<SprintReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const revision = board.sprints.map((sprint) => `${sprint.id}:${sprint.revision}`).join("|");
  const sourceRevision = board.sources
    .map((source) => `${source.environmentId}:${source.cursor}`)
    .join("|");
  const planningRevision = [...board.planning.values()].map((item) => item.revision).join(",");
  const allowed = new Set(
    board.allowedProjects?.map(sprintProjectKey) ??
      board.tasks.flatMap((task) => {
        const ref = board.taskRef(task);
        return ref ? [sprintProjectKey(ref)] : [];
      }),
  );
  const scopeKey = [...allowed].sort().join("|");
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setHistory([]);
    setError(null);
    if (!board.supported) return;
    setLoading(true);
    const completed = board.sprints
      .filter(
        (sprint) =>
          (sprint.state === "completed" || sprint.state === "archived") &&
          sprint.projects.some(
            (project) =>
              allowed.has(sprintProjectKey(project)) &&
              (!projectKey || sprintProjectKey(project) === projectKey),
          ),
      )
      .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt))
      .slice(-12);
    void Promise.all([
      sprintId ? board.report(sprintId) : Promise.resolve(null),
      Promise.all(completed.map((sprint) => board.report(sprint.id))),
    ])
      .then(
        ([selected, reports]) => {
          if (!cancelled) {
            setReport(selected);
            setHistory(reports);
          }
        },
        (reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The controller is refreshed by source/planning revisions; callback identity is intentionally excluded.
  }, [
    sprintId,
    revision,
    sourceRevision,
    planningRevision,
    board.supported,
    board.coordinatorEnvironmentId,
    projectKey,
    scopeKey,
    refresh,
  ]);
  const visibleKey = (key: string) => allowed.has(key) && (!projectKey || key === projectKey);
  const totalsFor = (value: SprintReport) =>
    sumTotals(
      Object.entries(value.projects)
        .filter(([key]) => visibleKey(key))
        .map(([, totals]) => totals),
    );
  const totals = report ? totalsFor(report) : null;
  const visibleTasks = report?.tasks.filter((task) => visibleKey(sprintProjectKey(task))) ?? [];
  const partial = !!report?.sprint.projects.some(
    (project) => !allowed.has(sprintProjectKey(project)),
  );
  const incompleteSources =
    !!report &&
    !report.frozen &&
    report.sprint.projects
      .filter((project) => visibleKey(sprintProjectKey(project)))
      .some((project) => {
        const source = report.sources.find(
          (entry) => entry.environmentId === project.environmentId,
        );
        return (
          !source ||
          source.caughtUp === false ||
          Date.now() - source.syncedAt > 60_000 ||
          !board.machines.some((machine) => machine.environmentId === project.environmentId) ||
          (source.visibleProjectIds && !source.visibleProjectIds.includes(project.projectId))
        );
      });
  const historyMissing = !!report?.sources.some(
    (source) =>
      source.historyAvailableFrom !== undefined &&
      source.historyAvailableFrom >
        (report.sprint.startedAt ?? report.sprint.startsAt ?? report.sprint.createdAt),
  );
  const scopedLedger =
    report?.ledger
      .map((entry) => ({
        ...entry,
        totals: entry.projects
          ? sumTotals(
              Object.entries(entry.projects)
                .filter(([key]) => visibleKey(key))
                .map(([, value]) => value),
            )
          : !partial && !projectKey
            ? entry.totals
            : null,
      }))
      .filter((entry) => entry.totals !== null) ?? [];
  const start = report?.sprint.startedAt ?? report?.sprint.startsAt;
  const end = report?.sprint.endsAt;
  const baseline = scopedLedger.find((entry) => entry.kind === "start")?.totals?.remainingPoints;
  const availableFrom = Math.max(
    0,
    ...(report?.sources.map((source) => source.historyAvailableFrom ?? 0) ?? []),
  );
  const chart: LineChartDatum[] =
    report?.sprint.startedAt === undefined
      ? []
      : scopedLedger
          .filter((entry) => entry.at >= Math.max(availableFrom, report.sprint.startedAt ?? 0))
          .map((entry) => ({
            key: String(entry.sequence),
            label: new Date(entry.at).toLocaleString(locale),
            axisLabel: new Date(entry.at).toLocaleDateString(locale, {
              month: "short",
              day: "numeric",
            }),
            values: {
              remaining: entry.totals!.remainingPoints,
              ...(start && end && end > start && baseline !== undefined && !historyMissing
                ? {
                    ideal:
                      baseline * Math.max(0, Math.min(1, 1 - (entry.at - start) / (end - start))),
                  }
                : {}),
            },
          }));
  const completedTasks = visibleTasks.filter(
    (task) => task.status === "done" && !task.deleted,
  ).length;
  const velocity = history.map((item) => ({
    key: item.sprint.id,
    label: item.sprint.name,
    axisLabel: item.sprint.name,
    value: totalsFor(item).completedPoints,
  }));
  return (
    <section className="sprint-report" aria-label={t("Sprint reports")} aria-busy={loading}>
      <div className="sprint-heading">
        <h2>{report?.sprint.name ?? t("Sprint reports")}</h2>
        <Button variant="ghost" loading={loading} onClick={() => setRefresh((value) => value + 1)}>
          {t("Refresh")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sprint-errors">
          {error}
        </p>
      ) : null}
      {!sprintId ? (
        <p className="sprint-muted">{t("Choose a sprint to inspect its progress and burndown.")}</p>
      ) : null}
      {totals ? (
        <>
          <dl className="sprint-summary">
            <div>
              <dt>{t("Completed tasks")}</dt>
              <dd>
                {completedTasks} / {totals.tasks}
              </dd>
            </div>
            <div>
              <dt>{t("Completed points")}</dt>
              <dd>
                {totals.completedPoints} / {totals.points}
              </dd>
            </div>
            <div>
              <dt>{t("Unestimated")}</dt>
              <dd>{totals.unestimated}</dd>
            </div>
          </dl>
          {partial ? (
            <p className="sprint-muted">
              {t("Partial report. Only accessible projects are included.")}
            </p>
          ) : null}
          {report?.frozen ? (
            <p className="sprint-muted">{t("This report was frozen when the sprint completed.")}</p>
          ) : null}
          {historyMissing ? (
            <p className="sprint-muted">
              {t(
                "Earlier task history is unavailable. Missing periods are not treated as zero work.",
              )}
            </p>
          ) : null}
          {(report &&
            !report.frozen &&
            report.sprint.projects.some((project) => board.syncFailures[project.environmentId])) ||
          incompleteSources ? (
            <p className="sprint-muted">
              {t(
                "Some source data is out of date. Reconnect the affected machines to complete this report.",
              )}
            </p>
          ) : null}
          {report && !partial && !projectKey && report.sprint.capacityPoints !== null ? (
            <p>
              {t("Sprint capacity")}: {totals.points} / {report.sprint.capacityPoints}{" "}
              {totals.points > report.sprint.capacityPoints ? t("Capacity exceeded") : ""}
            </p>
          ) : null}
          <h3>{t("Project capacity")}</h3>
          <div className="sprint-table-wrap">
            <table className="sprint-table">
              <thead>
                <tr>
                  <th>{t("Project")}</th>
                  <th>{t("Completed points")}</th>
                  <th>{t("Planned points")}</th>
                  <th>{t("Capacity")}</th>
                </tr>
              </thead>
              <tbody>
                {report?.sprint.projects
                  .filter((project) => visibleKey(sprintProjectKey(project)))
                  .map((project) => {
                    const key = sprintProjectKey(project);
                    const total = report.projects[key];
                    const capacity = report.sprint.projectCapacities[key];
                    return (
                      <tr key={key}>
                        <th scope="row">{project.name}</th>
                        <td>{total?.completedPoints ?? 0}</td>
                        <td>{total?.points ?? 0}</td>
                        <td>
                          {capacity ?? t("Not set")}
                          {capacity !== undefined && (total?.points ?? 0) > capacity
                            ? ` · ${t("Capacity exceeded")}`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <h3>{t("Burndown")}</h3>
          {report?.sprint.startedAt === undefined ? (
            <p className="sprint-muted">
              {t("Start the sprint to record its burndown. Planned scope is shown below.")}
            </p>
          ) : null}
          {!start || !end ? (
            <p className="sprint-muted">{t("Set sprint dates to show the ideal burndown line.")}</p>
          ) : null}
          {chart.length ? (
            <LineChart
              label={t("Sprint burndown")}
              data={chart}
              series={[
                { key: "remaining", label: t("Remaining points"), area: false },
                ...(start && end && !historyMissing
                  ? [
                      {
                        key: "ideal",
                        label: t("Ideal remaining points"),
                        dashed: true,
                        area: false,
                      },
                    ]
                  : []),
              ]}
              height={220}
              curve="linear"
            />
          ) : (
            <p className="sprint-muted">{t("No recorded sprint history yet.")}</p>
          )}
          <details>
            <summary>{t("Burndown data and scope changes")}</summary>
            <div className="sprint-table-wrap">
              <table className="sprint-table">
                <thead>
                  <tr>
                    <th>{t("Time")}</th>
                    <th>{t("Change")}</th>
                    <th>{t("Remaining points")}</th>
                    <th>{t("Planned points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedLedger.map((entry) => (
                    <tr key={entry.sequence}>
                      <td>{new Date(entry.at).toLocaleString(locale)}</td>
                      <td>
                        {t(
                          {
                            scope: "Scope changed",
                            estimate: "Estimate changed",
                            status: "Task status changed",
                            start: "Sprint started",
                            complete: "Sprint completed",
                            update: "Sprint updated",
                          }[entry.kind],
                        )}
                      </td>
                      <td>{entry.totals!.remainingPoints}</td>
                      <td>{entry.totals!.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
      <h3>{t("Sprint velocity")}</h3>
      {velocity.length ? (
        <>
          <BarChart
            label={t("Completed points by sprint")}
            data={velocity}
            period={t("Completed sprints")}
            unit={t("points")}
            height={200}
          />
          <details>
            <summary>{t("Velocity data")}</summary>
            <div className="sprint-table-wrap">
              <table className="sprint-table">
                <thead>
                  <tr>
                    <th>{t("Sprint")}</th>
                    <th>{t("Completed points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {velocity.map((item) => (
                    <tr key={item.key}>
                      <th scope="row">{item.label}</th>
                      <td>{item.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="sprint-muted">{t("Complete a sprint to see recorded velocity.")}</p>
      )}
    </section>
  );
}
