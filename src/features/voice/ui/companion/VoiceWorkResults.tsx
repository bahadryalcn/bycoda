import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { createContext, useContext, useState } from "react";
import { z } from "zod";
import { formatNumber, useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { BarChart, DonutChart, type BarChartDatum } from "../../../../shared/ui/Charts";
import { SortableDataTable } from "../../../../shared/ui/SortableDataTable";
import { Text } from "../../../../shared/ui/Text";
import type { VoiceWorkLayout, VoiceWorkLayoutContext } from "../../model/voiceWorkLayout";
import { useVoiceWorkLayout } from "./useVoiceWorkLayout";
import { voiceWorkFilterLabel, voiceWorkStatuses, type VoiceWorkFilter } from "./VoiceWorkSummary";

type VoiceWorkStatus = Exclude<VoiceWorkFilter, "all">;

export type VoiceWorkResultRow = {
  id: string;
  title: string;
  status: VoiceWorkStatus;
  statusLabel: string;
  source: string;
};

type VoiceWorkResultsProps = {
  rows: readonly VoiceWorkResultRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
  modelLayout?: VoiceWorkLayoutContext;
};

type DistributionSegment = { key: VoiceWorkStatus; label: string; value: number; color: string };
const statusColors = {
  running: "var(--ui-tone-info-fg)",
  done: "var(--ui-tone-success-fg)",
  failed: "var(--ui-tone-danger-fg)",
  stopped: "var(--ui-text-muted)",
  interrupted: "var(--ui-tone-warning-fg)",
} satisfies Record<VoiceWorkStatus, string>;

const ResultsContext = createContext<
  | (VoiceWorkResultsProps & {
      distribution: DistributionSegment[];
      sourceDistribution: BarChartDatum[];
      activeStatus: VoiceWorkStatus | null;
      onStatusChange: (status: string | null) => void;
      initialSort: VoiceWorkLayout["sort"];
    })
  | null
>(null);

const WorkResultDistribution = defineComponent({
  name: "WorkResultDistribution",
  description: "Show the count of visible work records in each reported status.",
  props: z.object({}),
  component: function WorkResultDistributionView() {
    const t = useT();
    const results = useContext(ResultsContext);
    if (!results?.distribution.length) return null;
    return (
      <DonutChart
        data={results.distribution}
        label={t("Status")}
        size={120}
        groupBelow={0}
        legendAction="select"
        activeKey={results.activeStatus}
        onActiveChange={results.onStatusChange}
        formatValue={formatNumber}
      />
    );
  },
});

const WorkResultSourceComparison = defineComponent({
  name: "WorkResultSourceComparison",
  description: "Compare actual work counts by source.",
  props: z.object({}),
  component: function WorkResultSourceComparisonView() {
    const t = useT();
    const results = useContext(ResultsContext);
    if (!results || results.sourceDistribution.length < 2) return null;
    return (
      <BarChart
        data={results.sourceDistribution}
        label={t("Results")}
        period={t("Source")}
        categoryLabel={t("Source")}
        showAverage={false}
        height={120}
        formatValue={formatNumber}
      />
    );
  },
});

const sortKeys = { activity: undefined, status: "statusLabel", source: "source" } as const;

const WorkResultTable = defineComponent({
  name: "WorkResultTable",
  description: "Sort work records and open a record in the workspace.",
  props: z.object({}),
  component: function WorkResultTableView() {
    const t = useT();
    const results = useContext(ResultsContext);
    if (!results) return null;
    const rows = results.activeStatus
      ? results.rows.filter((row) => row.status === results.activeStatus)
      : [...results.rows];
    const sortKey = sortKeys[results.initialSort];
    return (
      <SortableDataTable
        key={sortKey ?? "activity"}
        rows={rows}
        defaultSort={sortKey ? { key: sortKey, direction: "asc" } : undefined}
        rowKey="id"
        caption={t("Results")}
        activeKey={results.selectedId}
        onRowActivate={results.onSelect}
        columns={[
          {
            key: "title",
            label: t("Name"),
            sizing: "flex",
            render: (_, row) => (
              <Text as="span" truncate>
                {row.title}
              </Text>
            ),
          },
          { key: "statusLabel", label: t("Status"), sizing: "content" },
          { key: "source", label: t("Source"), hideBelow: "sm", sizing: "content" },
        ]}
      />
    );
  },
});

const WorkResults = defineComponent({
  name: "WorkResults",
  description: "Show the work table with optional charts.",
  props: z.object({
    sections: z
      .array(
        z.union([WorkResultDistribution.ref, WorkResultSourceComparison.ref, WorkResultTable.ref]),
      )
      .min(1)
      .max(2),
  }),
  component: ({ props, renderNode }) => (
    <div className="grid min-w-0 gap-4">{renderNode(props.sections)}</div>
  ),
});

const library = createLibrary({
  components: [WorkResults, WorkResultDistribution, WorkResultSourceComparison, WorkResultTable],
  root: "WorkResults",
});

// Only a validated layout enum selects these programs. All work data stays in React.
const programs = {
  status_ring:
    "chart = WorkResultDistribution()\ntable = WorkResultTable()\nroot = WorkResults([chart, table])",
  table_first:
    "chart = WorkResultDistribution()\ntable = WorkResultTable()\nroot = WorkResults([table, chart])",
  source_bars:
    "chart = WorkResultSourceComparison()\ntable = WorkResultTable()\nroot = WorkResults([chart, table])",
  table_only: "table = WorkResultTable()\nroot = WorkResults([table])",
} satisfies Record<VoiceWorkLayout["layout"], string>;

export function VoiceWorkResults({
  rows,
  selectedId,
  onSelect,
  modelLayout,
}: VoiceWorkResultsProps) {
  const t = useT();
  const [status, setStatus] = useState<VoiceWorkStatus | null>(null);
  const counts = { running: 0, done: 0, failed: 0, stopped: 0, interrupted: 0 };
  const sources = new Map<string, number>();
  for (const row of rows) {
    counts[row.status]++;
    sources.set(row.source, (sources.get(row.source) ?? 0) + 1);
  }
  const sourceDistribution = Array.from(sources, ([label, value]) => ({
    key: label,
    label,
    axisLabel: label,
    value,
  }));
  const layout = useVoiceWorkLayout(modelLayout, {
    statuses: counts,
    sourceCounts: Array.from(sources.values()).sort((a, b) => b - a),
  });
  const distribution = voiceWorkStatuses
    .filter((key) => counts[key] > 0)
    .map((key) => ({
      key,
      label: voiceWorkFilterLabel(key),
      value: counts[key],
      color: statusColors[key],
    }));
  const chosen = layout.plan?.layout;
  const view =
    chosen === "source_bars" && sources.size < 2 ? "status_ring" : (chosen ?? "status_ring");
  const statusVisible = view === "status_ring" || view === "table_first";
  const activeStatus = statusVisible && status && counts[status] > 0 ? status : null;
  return (
    <ResultsContext.Provider
      value={{
        rows,
        selectedId,
        onSelect,
        distribution,
        sourceDistribution,
        activeStatus,
        initialSort: layout.plan?.sort ?? "activity",
        onStatusChange: (key) =>
          setStatus(distribution.find((segment) => segment.key === key)?.key ?? null),
      }}
    >
      {modelLayout && rows.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={layout.generate} loading={layout.loading}>
            {t("Generate with AI")}
          </Button>
          {layout.loading ? (
            <Button size="sm" variant="ghost" onClick={layout.stopWaiting}>
              {t("Stop waiting")}
            </Button>
          ) : null}
          {layout.plan ? (
            <Button size="sm" variant="ghost" onClick={layout.useDefault}>
              {t("Use default")}
            </Button>
          ) : null}
          {layout.error ? (
            <Text tone="muted" size="secondary">
              {t("Unavailable")}
            </Text>
          ) : null}
        </div>
      ) : null}
      <Renderer library={library} response={programs[view]} />
    </ResultsContext.Provider>
  );
}
