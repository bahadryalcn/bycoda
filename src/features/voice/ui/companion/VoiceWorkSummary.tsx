import {
  createLibrary,
  defineAction,
  defineComponent,
  Renderer,
  useTriggerAction,
} from "@openuidev/react-lang";
import { z } from "zod";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import styles from "../VoiceCompanion.module.css";

const labels = {
  all: "All",
  running: "Working",
  done: "Completed",
  failed: "Failed",
  stopped: "Cancelled",
  interrupted: "Unknown",
} as const;
export const voiceWorkStatuses = ["running", "done", "failed", "stopped", "interrupted"] as const;
const filterValues = ["all", ...voiceWorkStatuses] as const;
const filter = z.enum(filterValues);
export type VoiceWorkFilter = z.infer<typeof filter>;

export function voiceWorkFilterLabel(value: VoiceWorkFilter) {
  return t(labels[value]);
}

const SelectWorkFilter = defineAction({
  name: "SelectWorkFilter",
  description: "Filter the visible tool calls by the reported status.",
  params: z.object({ filter }),
});
const WorkStatusFilter = defineComponent({
  name: "WorkStatusFilter",
  description: "A status count that filters the displayed tool calls on click.",
  props: z.object({
    filter,
    count: z.number().int().nonnegative(),
    selected: z.boolean(),
    action: SelectWorkFilter.ref,
  }),
  component: function WorkStatusFilterButton({ props }) {
    const trigger = useTriggerAction();
    const label = `${voiceWorkFilterLabel(props.filter)} · ${props.count}`;
    return (
      <Button
        variant="ghost"
        selected={props.selected}
        pressed={props.selected}
        onClick={() => trigger(label, undefined, props.action)}
      >
        {label}
      </Button>
    );
  },
});
const WorkStatusCounts = defineComponent({
  name: "WorkStatusCounts",
  description: "The live counts reported for the displayed conversation's tool calls.",
  props: z.object({ options: z.array(WorkStatusFilter.ref) }),
  component: ({ props, renderNode }) => (
    <div className={styles.liveWorkCounts}>{renderNode(props.options)}</div>
  ),
});

const library = createLibrary({
  components: [WorkStatusCounts, WorkStatusFilter],
  actions: [SelectWorkFilter],
  root: "WorkStatusCounts",
});

export function VoiceWorkSummary({
  counts,
  selected,
  onSelect,
}: {
  counts: Readonly<Record<VoiceWorkFilter, number>>;
  selected: VoiceWorkFilter;
  onSelect: (filter: VoiceWorkFilter) => void;
}) {
  // Only status enums and integer counts enter the OpenUI program.
  const options = filterValues
    .filter((value) => value === "all" || value === selected || counts[value] > 0)
    .map(
      (value) =>
        `WorkStatusFilter("${value}", ${counts[value]}, ${value === selected}, @SelectWorkFilter("${value}"))`,
    );
  return (
    <Renderer
      library={library}
      response={`root = WorkStatusCounts([${options.join(", ")}])`}
      onAction={(event) => {
        if (event.type === SelectWorkFilter.name) onSelect(event.params.filter);
      }}
    />
  );
}
