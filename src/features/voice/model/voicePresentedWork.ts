import { z } from "zod";
import { workFilters, workResultSortKinds } from "./voiceWorkResultBlocks";
import { defineSpec, type PresentedNode, type PresentedSpec } from "./voicePresentedSpec";

const strict = z.strictObject;

const fullExample: PresentedNode = {
  type: "WorkResults",
  children: [
    {
      type: "WorkStatusCounts",
      children: [
        { type: "WorkStatusFilter", filter: "all" },
        { type: "WorkStatusFilter", filter: "failed" },
      ],
    },
    { type: "WorkResultDistribution" },
    { type: "WorkResultSourceComparison" },
    { type: "WorkResultTable", sort: "activity" },
  ],
};

/**
 * The live work records of this voice turn (tool calls and observed results), with a status filter
 * shared by every part. They carry no records: the app supplies them, so nothing here can be invented.
 */
export const presentedWorkSpecs = [
  defineSpec({
    name: "WorkResults",
    group: "observed",
    description:
      "Root of the live work results. Counts, the status donut, the source chart and the table inside it share one status filter.",
    source: "WorkResultParts",
    props: strict({}),
    children: "nodes",
    example: fullExample,
  }),
  defineSpec({
    name: "WorkStatusCounts",
    group: "observed",
    description: "A row of status filter buttons with live counts. Holds WorkStatusFilter nodes.",
    source: "WorkResultParts",
    props: strict({}),
    children: "nodes",
    within: "WorkResults",
    example: fullExample,
  }),
  defineSpec({
    name: "WorkStatusFilter",
    group: "observed",
    description:
      "One status filter button with its count; hidden when its status has no records and it is not selected.",
    source: "Button",
    props: strict({ filter: z.enum(workFilters) }),
    parent: "WorkStatusCounts",
    within: "WorkResults",
    example: fullExample,
  }),
  defineSpec({
    name: "WorkResultDistribution",
    group: "observed",
    description: "A donut of the work records by status; choosing a status filters the table.",
    source: "DonutChart",
    props: strict({}),
    within: "WorkResults",
    example: fullExample,
  }),
  defineSpec({
    name: "WorkResultSourceComparison",
    group: "observed",
    description: "A bar chart of record counts per source; shown only with two or more sources.",
    source: "BarChart",
    props: strict({}),
    within: "WorkResults",
    example: fullExample,
  }),
  defineSpec({
    name: "WorkResultTable",
    group: "observed",
    description: "A sortable table of the records the current filter leaves; a row can be opened.",
    source: "SortableDataTable",
    props: strict({ sort: z.enum(workResultSortKinds) }),
    within: "WorkResults",
    example: fullExample,
  }),
] satisfies PresentedSpec[];
