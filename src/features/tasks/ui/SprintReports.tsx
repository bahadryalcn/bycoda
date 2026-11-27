import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { t as translate, useLocale, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { BarChart, LineChart, type LineChartDatum } from "../../../shared/ui/Charts";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Gauge, RefreshCw } from "../../../shared/ui/icons";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { StatRow } from "../../../shared/ui/StatTile";
import {
  sprintProjectKey,
  type SprintLedgerEntry,
  type SprintReport,
  type SprintTotals,
} from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import { SprintDataTable, SprintKpi } from "./SprintReportParts";
import { SprintStatusBadge } from "./SprintStatusBadge";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { presentRemoteError } from "../../connections/public/remoteFailure";
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

const NO_REPORTS: SprintReport[] = [];

/**
 * The report of one sprint. `embedded` is the section of the sprint page: no heading, sprint
 * choice or Refresh, because the page owns the sprint and the data follows the board by itself.
 */
export function SprintReports({
  board,
  sprintId,
  projectKey,
  environmentId,
  embedded = false,
  onChooseSprint,
  onOpenSprints,
}: {
  board: SprintBoardController;
  sprintId: string;
  projectKey?: string;
  environmentId?: string;
  embedded?: boolean;
  /** Selects the sprint to report on (standalone only). */
  onChooseSprint?: (sprintId: string) => void;
  /** Goes to the sprint list, where a sprint is created or started (standalone only). */
  onOpenSprints?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [refresh, setRefresh] = useState(0);
  // The Refresh button is an explicit action: its failure is always shown, while a
  // passing disconnect during an automatic read stays with the shared connection notice.
  const manualRead = useRef(false);
  // The answer belongs to the inputs it was read for; any other key starts empty
  // and loading, with no reset pass after render.
  const [answer, setAnswer] = useState<{
    key: string;
    report: SprintReport | null;
    history: SprintReport[];
    error: string | null;
  } | null>(null);
  // Source freshness is measured against the shared minute clock, which pauses while hidden.
  const now = useMinuteNow();
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
  const matchesEnvironment = (key: string) =>
    !environmentId ||
    board.allowedProjects?.some(
      (project) => sprintProjectKey(project) === key && project.environmentId === environmentId,
    ) ||
    board.tasks.some((task) => {
      const ref = board.taskRef(task);
      return ref?.environmentId === environmentId && sprintProjectKey(ref) === key;
    });
  const readKey = JSON.stringify([
    sprintId,
    revision,
    sourceRevision,
    planningRevision,
    board.supported,
    board.coordinatorEnvironmentId,
    projectKey,
    environmentId,
    scopeKey,
    refresh,
  ]);
  useEffect(() => {
    if (!board.supported) return;
    let cancelled = false;
    const completed = board.sprints
      .filter(
        (sprint) =>
          (sprint.state === "completed" || sprint.state === "archived") &&
          sprint.projects.some(
            (project) =>
              allowed.has(sprintProjectKey(project)) &&
              (!projectKey || sprintProjectKey(project) === projectKey) &&
              (!environmentId || project.environmentId === environmentId),
          ),
      )
      .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt))
      .slice(-12);
    void Promise.all([
      sprintId ? board.report(sprintId) : Promise.resolve(null),
      Promise.all(completed.map((sprint) => board.report(sprint.id))),
    ]).then(
      ([selected, reports]) => {
        if (cancelled) return;
        manualRead.current = false;
        setAnswer({ key: readKey, report: selected, history: reports, error: null });
      },
      (reason) => {
        if (cancelled) return;
        const explicit = manualRead.current;
        manualRead.current = false;
        setAnswer({
          key: readKey,
          report: null,
          history: [],
          error: explicit
            ? presentRemoteError(reason, { explicit: true })
            : (presentRemoteError(reason) ?? null),
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // The controller is refreshed by source/planning revisions; callback identity is intentionally excluded.
  }, [readKey]);
  const current = answer?.key === readKey ? answer : null;
  const report = current?.report ?? null;
  const history = current?.history ?? NO_REPORTS;
  const error = current?.error ?? null;
  const loading = board.supported && !current;
  const visibleKey = (key: string) =>
    allowed.has(key) && (!projectKey || key === projectKey) && matchesEnvironment(key);
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
          now - source.syncedAt > 60_000 ||
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
          : !partial && !projectKey && !environmentId
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
  const axisDay = (at: number) =>
    new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" });
  const chart: LineChartDatum[] =
    report?.sprint.startedAt === undefined
      ? []
      : scopedLedger
          .filter((entry) => entry.at >= Math.max(availableFrom, report.sprint.startedAt ?? 0))
          .map((entry, index, entries) => ({
            key: String(entry.sequence),
            label: new Date(entry.at).toLocaleString(locale),
            // Several changes on one day name that day once; the axis stays quiet after it.
            axisLabel:
              index > 0 && axisDay(entries[index - 1].at) === axisDay(entry.at)
                ? undefined
                : axisDay(entry.at),
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
  // One project repeats the totals above; the table appears for several projects or a budget.
  const projectRows = (report?.sprint.projects ?? [])
    .filter((project) => visibleKey(sprintProjectKey(project)))
    .map((project) => {
      const key = sprintProjectKey(project);
      const total = report!.projects[key];
      const budget = report!.sprint.projectCapacities[key];
      return {
        key,
        name: project.name,
        completed: total?.completedPoints ?? 0,
        planned: total?.points ?? 0,
        capacity:
          (budget ?? t("Not set")) +
          (budget !== undefined && (total?.points ?? 0) > budget
            ? ` · ${t("Capacity exceeded")}`
            : ""),
      };
    });
  const hasProjectBudget = projectRows.some(
    (row) => report!.sprint.projectCapacities[row.key] !== undefined,
  );
  const velocity = history.map((item) => ({
    key: item.sprint.id,
    label: item.sprint.name,
    axisLabel: item.sprint.name,
    value: totalsFor(item).completedPoints,
  }));
  // Nothing to report yet: one sentence and one action, no heading or refresh.
  if (!embedded && !sprintId && board.sprints.length === 0)
    return (
      <Text
        as="section"
        size="secondary"
        tone="primary"
        leading="inherit"
        className="sprint-report"
        aria-label={t("Sprint reports")}
      >
        <EmptyState
          context="list"
          kind="empty"
          icon={<Gauge className="icon-lg" />}
          description={t("No sprints yet. Create and start a sprint to see its progress here.")}
          action={onOpenSprints ? { label: t("Go to Sprints"), onClick: onOpenSprints } : undefined}
        />
        {error ? <InlineError details={error} /> : null}
      </Text>
    );
  const capacityPoints =
    report && !partial && !projectKey && !environmentId ? report.sprint.capacityPoints : null;
  const staleSources =
    (!!report &&
      !report.frozen &&
      report.sprint.projects.some((project) => board.syncFailures[project.environmentId])) ||
    incompleteSources;
  return (
    <Text
      as="section"
      size="secondary"
      tone="primary"
      leading="inherit"
      className="sprint-report"
      data-embedded={embedded || undefined}
      aria-label={t("Sprint reports")}
      aria-busy={loading}
    >
      {embedded ? null : (
        <div className="sprint-heading">
          <div className="sprint-title">
            <Heading size="section" lines={2}>
              {report?.sprint.name ?? t("Sprint reports")}
            </Heading>
            {report ? <SprintStatusBadge state={report.sprint.state} /> : null}
          </div>
          <div className="sprint-actions">
            {onChooseSprint && board.sprints.length ? (
              <div className="sprint-source">
                <SearchableSelect
                  hideLabel
                  label={t("Sprint")}
                  placeholder={t("Choose sprint")}
                  value={sprintId}
                  options={board.sprints.map((sprint) => ({
                    value: sprint.id,
                    label: sprint.name,
                  }))}
                  onChange={onChooseSprint}
                />
              </div>
            ) : null}
            {!sprintId && onOpenSprints ? (
              <Button variant="secondary" onClick={onOpenSprints}>
                {t("Open sprints")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              startIcon={<RefreshCw className="icon-xs" />}
              loading={loading}
              onClick={() => {
                manualRead.current = true;
                setRefresh((value) => value + 1);
              }}
            >
              {t("Refresh")}
            </Button>
          </div>
        </div>
      )}
      {error ? <InlineError details={error} /> : null}
      {totals ? (
        <>
          <StatRow label={t("Sprint progress")}>
            <SprintKpi
              label={t("Completed tasks")}
              value={`${completedTasks} / ${totals.tasks}`}
              meter={{
                value: completedTasks,
                max: totals.tasks,
                tone: "success",
                valueText: `${completedTasks} / ${totals.tasks}`,
              }}
            />
            <SprintKpi
              label={t("Completed points")}
              value={`${totals.completedPoints} / ${totals.points}`}
              meter={{
                value: totals.completedPoints,
                max: totals.points,
                tone: "success",
                valueText: `${totals.completedPoints} / ${totals.points}`,
              }}
            />
            {totals.unestimated > 0 ? (
              <SprintKpi label={t("Unestimated")} value={totals.unestimated} />
            ) : null}
            {capacityPoints !== null && capacityPoints !== undefined ? (
              <SprintKpi
                label={t("Sprint capacity")}
                value={`${totals.points} / ${capacityPoints}`}
                detail={totals.points > capacityPoints ? t("Capacity exceeded") : undefined}
                meter={{
                  kind: "capacity",
                  value: totals.points,
                  max: capacityPoints,
                  tone: totals.points > capacityPoints ? "danger" : "accent",
                  valueText: `${totals.points} / ${capacityPoints}`,
                }}
              />
            ) : null}
          </StatRow>
          <div className="sprint-notes">
            {partial ? (
              <InlineMessage tone="info">
                {t("Partial report. Only accessible projects are included.")}
              </InlineMessage>
            ) : null}
            {report?.frozen ? (
              <InlineMessage tone="neutral">
                {t("This report was frozen when the sprint completed.")}
              </InlineMessage>
            ) : null}
            {historyMissing ? (
              <InlineMessage tone="warning">
                {t(
                  "Earlier task history is unavailable. Missing periods are not treated as zero work.",
                )}
              </InlineMessage>
            ) : null}
            {staleSources ? (
              <InlineMessage tone="warning">
                {t(
                  "Some source data is out of date. Reconnect the affected machines to complete this report.",
                )}
              </InlineMessage>
            ) : null}
          </div>
          <section className="sprint-section">
            <SectionLabel>{t("Burndown")}</SectionLabel>
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
              <EmptyState size="inline" description={t("No recorded sprint history yet.")} />
            )}
            <Disclosure summary={t("Burndown data and scope changes")} variant="row">
              <SprintDataTable
                caption={t("Burndown data and scope changes")}
                rowKey="key"
                rows={scopedLedger.map((entry) => ({
                  key: String(entry.sequence),
                  time: new Date(entry.at).toLocaleString(locale),
                  change: burndownChangeLabel(entry.kind),
                  remaining: entry.totals!.remainingPoints,
                  planned: entry.totals!.points,
                }))}
                columns={[
                  { key: "time", label: t("Time") },
                  { key: "change", label: t("Change") },
                  { key: "remaining", label: t("Remaining points") },
                  { key: "planned", label: t("Planned points") },
                ]}
              />
            </Disclosure>
          </section>
          {projectRows.length > 1 || hasProjectBudget ? (
            <section className="sprint-section">
              <SectionLabel>{t("Project capacity")}</SectionLabel>
              <SprintDataTable
                caption={t("Project capacity")}
                rowKey="key"
                rows={projectRows}
                columns={[
                  { key: "name", label: t("Project") },
                  { key: "completed", label: t("Completed points") },
                  { key: "planned", label: t("Planned points") },
                  { key: "capacity", label: t("Capacity") },
                ]}
              />
            </section>
          ) : null}
        </>
      ) : null}
      {velocity.length ? (
        <Disclosure summary={t("Sprint velocity")} variant="row">
          <BarChart
            label={t("Completed points by sprint")}
            data={velocity}
            period={t("Completed sprints")}
            unit={t("points")}
            height={200}
          />
          <SprintDataTable
            caption={t("Velocity data")}
            rowKey="key"
            rows={velocity.map((item) => ({
              key: item.key,
              sprint: item.label,
              value: item.value,
            }))}
            columns={[
              { key: "sprint", label: t("Sprint") },
              { key: "value", label: t("Completed points") },
            ]}
          />
        </Disclosure>
      ) : null}
    </Text>
  );
}

function burndownChangeLabel(kind: SprintLedgerEntry["kind"]) {
  switch (kind) {
    case "scope":
      return translate("Scope changed");
    case "estimate":
      return translate("Estimate changed");
    case "status":
      return translate("Task status changed");
    case "start":
      return translate("Sprint started");
    case "complete":
      return translate("Sprint completed");
    case "update":
      return translate("Sprint updated");
  }
}
