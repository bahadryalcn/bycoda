import {
  createLibrary,
  defineComponent,
  Renderer,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import { createContext, useContext, useState, type ReactNode } from "react";
import { z } from "zod";
import { formatNumber } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import {
  countWorkStatuses,
  workFilterLabel,
  workFilters,
  workResultSortKinds,
  type WorkFilter,
  type WorkRecord,
} from "../../../model/voiceWorkResultBlocks";
import { WorkRecordTable, WorkSourceComparison, WorkStatusDonut } from "./WorkResultParts";

/** One presented-answer entry: the OpenUI spec the program is validated against, and its renderer. */
export type WorkResultEntry = {
  spec: { name: string; group: "observed"; description: string; props: z.ZodObject };
  render: ComponentRenderer<any>;
};

type WorkRecordsValue = {
  records: readonly WorkRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
};
const RecordsContext = createContext<WorkRecordsValue | null>(null);
type FilterValue = { filter: WorkFilter; setFilter: (filter: WorkFilter) => void };
const FilterContext = createContext<FilterValue | null>(null);

/** Live work the entries read. The parent wraps the answer's Renderer with it; the program never carries records. */
export function WorkRecordsProvider({
  value,
  children,
}: {
  value: WorkRecordsValue;
  children: ReactNode;
}) {
  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

function useWorkRecords() {
  const value = useContext(RecordsContext);
  if (!value) throw new Error("Work result blocks need WorkRecordsProvider.");
  return value;
}

function useWorkFilter() {
  const value = useContext(FilterContext);
  if (!value) throw new Error("Work result blocks need the WorkResults root.");
  return value;
}

/** Defines the OpenUI component and its presented entry from one config, so the two cannot drift. */
function presentedWork<T extends z.ZodObject>(config: {
  name: string;
  description: string;
  props: T;
  component: ComponentRenderer<z.infer<T>>;
}) {
  const component = defineComponent(config);
  const entry: WorkResultEntry = {
    spec: {
      name: config.name,
      group: "observed",
      description: config.description,
      props: config.props,
    },
    render: config.component,
  };
  return { component, entry };
}

const WorkStatusFilter = presentedWork({
  name: "WorkStatusFilter",
  description:
    "One status filter button with its live record count. Hidden when empty and not selected.",
  props: z.strictObject({ filter: z.enum(workFilters) }),
  component: function WorkStatusFilterView({ props }) {
    const { records } = useWorkRecords();
    const { filter, setFilter } = useWorkFilter();
    const counts = countWorkStatuses(records);
    const count = props.filter === "all" ? records.length : counts[props.filter];
    if (props.filter !== "all" && props.filter !== filter && count === 0) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        selected={props.filter === filter}
        pressed={props.filter === filter}
        onClick={() => setFilter(props.filter)}
      >
        {`${workFilterLabel(props.filter)} · ${formatNumber(count)}`}
      </Button>
    );
  },
});

const WorkStatusCounts = presentedWork({
  name: "WorkStatusCounts",
  description: "Row of status filter buttons with live counts.",
  props: z.strictObject({
    options: z.array(WorkStatusFilter.component.ref).min(1).max(workFilters.length),
  }),
  component: function WorkStatusCountsView({ props, renderNode }) {
    return <div className="flex min-w-0 flex-wrap gap-2">{renderNode(props.options)}</div>;
  },
});

const WorkResultDistribution = presentedWork({
  name: "WorkResultDistribution",
  description: "Donut of visible work records by status. Selecting a status filters the table.",
  props: z.strictObject({}),
  component: function WorkResultDistributionView() {
    const { records } = useWorkRecords();
    const { filter, setFilter } = useWorkFilter();
    return <WorkStatusDonut records={records} filter={filter} onFilter={setFilter} />;
  },
});

const WorkResultSourceComparison = presentedWork({
  name: "WorkResultSourceComparison",
  description: "Bar chart of record counts per source. Shown only with at least two sources.",
  props: z.strictObject({}),
  component: function WorkResultSourceComparisonView() {
    const { records } = useWorkRecords();
    return <WorkSourceComparison records={records} />;
  },
});

const WorkResultTable = presentedWork({
  name: "WorkResultTable",
  description:
    "Sortable table of the work records the current filter leaves visible. Activating a row opens it.",
  props: z.strictObject({ sort: z.enum(workResultSortKinds) }),
  component: function WorkResultTableView({ props }) {
    const { records, selectedId, onSelect } = useWorkRecords();
    const { filter } = useWorkFilter();
    return (
      <WorkRecordTable
        records={records}
        filter={filter}
        sort={props.sort}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  },
});

const WorkResults = presentedWork({
  name: "WorkResults",
  description:
    "Root of the work results: counts, donut, source chart and table, sharing one status filter.",
  props: z.object({
    sections: z
      .array(
        z.union([
          WorkStatusCounts.component.ref,
          WorkResultDistribution.component.ref,
          WorkResultSourceComparison.component.ref,
          WorkResultTable.component.ref,
        ]),
      )
      .min(1)
      .max(4),
  }),
  component: function WorkResultsView({ props, renderNode }) {
    const [filter, setFilter] = useState<WorkFilter>("all");
    return (
      <FilterContext.Provider value={{ filter, setFilter }}>
        <div className="grid min-w-0 gap-4">{renderNode(props.sections)}</div>
      </FilterContext.Provider>
    );
  },
});

/** Entries for the presented-answer catalog. The root WorkResults is the only entry a program needs to name. */
export const workResultEntries: readonly WorkResultEntry[] = [
  WorkResults.entry,
  WorkStatusCounts.entry,
  WorkStatusFilter.entry,
  WorkResultDistribution.entry,
  WorkResultSourceComparison.entry,
  WorkResultTable.entry,
];

/** Standalone library for rendering work results without the rest of the catalog (used by tests). */
export const workResultLibrary = createLibrary({
  components: [
    WorkResults.component,
    WorkStatusCounts.component,
    WorkStatusFilter.component,
    WorkResultDistribution.component,
    WorkResultSourceComparison.component,
    WorkResultTable.component,
  ],
  root: "WorkResults",
});

export function WorkResultsRenderer({ program }: { program: string }) {
  return <Renderer library={workResultLibrary} response={program} />;
}
