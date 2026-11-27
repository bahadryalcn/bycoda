import { formatNumber, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { BarChart, DonutChart } from "../../../../../shared/ui/Charts";
import { SortableDataTable } from "../../../../../shared/ui/SortableDataTable";
import { Text } from "../../../../../shared/ui/Text";
import {
  countWorkSources,
  countWorkStatuses,
  filterWorkRecords,
  isWorkStatus,
  toWorkTableRows,
  workFilterLabel,
  workFilters,
  workSourceComparisonVisible,
  workStatuses,
  workTableSort,
  type WorkFilter,
  type WorkRecord,
  type WorkResultSort,
  type WorkStatus,
  type WorkTableRow,
} from "../../../model/voiceWorkResultBlocks";

const statusColors = {
  running: "var(--ui-tone-info-fg)",
  done: "var(--ui-tone-success-fg)",
  failed: "var(--ui-tone-danger-fg)",
  stopped: "var(--ui-text-muted)",
  interrupted: "var(--ui-tone-warning-fg)",
} satisfies Record<WorkStatus, string>;

/** Presentational parts. Each receives its data and filter as props; the OpenUI entries supply them. */

/** Count per status plus "All". A status with no records is hidden unless it is the current filter. */
export function WorkStatusCounts({
  records,
  filter,
  onFilter,
}: {
  records: readonly WorkRecord[];
  filter: WorkFilter;
  onFilter: (filter: WorkFilter) => void;
}) {
  const counts = countWorkStatuses(records);
  const total = (value: WorkFilter) => (value === "all" ? records.length : counts[value]);
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {workFilters
        .filter((value) => value === "all" || value === filter || total(value) > 0)
        .map((value) => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            selected={value === filter}
            pressed={value === filter}
            onClick={() => onFilter(value)}
          >
            {`${workFilterLabel(value)} · ${formatNumber(total(value))}`}
          </Button>
        ))}
    </div>
  );
}

/** Status share of the records. Selecting a segment or its legend entry sets the same filter as the counts. */
export function WorkStatusDonut({
  records,
  filter,
  onFilter,
}: {
  records: readonly WorkRecord[];
  filter: WorkFilter;
  onFilter: (filter: WorkFilter) => void;
}) {
  const t = useT();
  const counts = countWorkStatuses(records);
  const data = workStatuses
    .filter((status) => counts[status] > 0)
    .map((status) => ({
      key: status,
      label: workFilterLabel(status),
      value: counts[status],
      color: statusColors[status],
    }));
  if (!data.length) return null;
  return (
    <DonutChart
      data={data}
      label={t("Status")}
      size={120}
      groupBelow={0}
      legendAction="select"
      activeKey={filter === "all" ? null : filter}
      onActiveChange={(key) => onFilter(isWorkStatus(key) ? key : "all")}
      formatValue={formatNumber}
    />
  );
}

/** Record count per source. Shown only when the records come from at least two sources. */
export function WorkSourceComparison({ records }: { records: readonly WorkRecord[] }) {
  const t = useT();
  if (!workSourceComparisonVisible(records)) return null;
  const data = countWorkSources(records).map(({ source, count }) => ({
    key: source,
    label: source,
    axisLabel: source,
    value: count,
  }));
  return (
    <BarChart
      data={data}
      label={t("Results")}
      period={t("Source")}
      categoryLabel={t("Source")}
      showAverage={false}
      height={120}
      formatValue={formatNumber}
    />
  );
}

/** Table of the given records. Sorting and row activation stay in the shared sortable table. */
export function WorkRecordTable({
  records,
  filter,
  sort,
  selectedId,
  onSelect,
}: {
  records: readonly WorkRecord[];
  filter: WorkFilter;
  sort: WorkResultSort;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const rows: WorkTableRow[] = toWorkTableRows(filterWorkRecords(records, filter));
  return (
    <SortableDataTable
      key={sort}
      rows={rows}
      defaultSort={workTableSort[sort]}
      rowKey="id"
      caption={t("Results")}
      emptyMessage={t("No records")}
      activeKey={selectedId}
      onRowActivate={(id) => onSelect(id)}
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
}
