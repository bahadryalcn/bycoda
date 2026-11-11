import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { LAYER } from "../../../shared/lib/layers";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { Heading } from "../../../shared/ui/Heading";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { goalKey } from "../model/goalClient";
import { TASK_COLUMNS } from "../model/hostTasks";
import { ALL_GOALS } from "./TaskGoals";
import { COLUMN_LABELS } from "./TaskBoardColumns";

type Option = { value: string; label: string };

export type TaskFilterValues = {
  status: string;
  machine: string;
  goal: string;
  sprint: string;
};

/** The Filters trigger (count and inline reset while active) and its popover. */
export function TaskToolbarFilters({
  values,
  activeCount,
  machines,
  goals,
  sprints,
  onStatus,
  onMachine,
  onGoal,
  onSprint,
  onReset,
}: {
  values: TaskFilterValues;
  activeCount: number;
  machines: readonly { id: string; name: string }[];
  goals: readonly { machineId: string; id: string; title: string }[];
  sprints: readonly { id: string; name: string }[];
  onStatus: (value: string) => void;
  onMachine: (value: string) => void;
  onGoal: (value: string) => void;
  onSprint: (value: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = (
    label: string,
    options: Option[],
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="task-filter-field">
      <span>{label}</span>
      <SearchableSelect
        label={label}
        layer={LAYER.submenu}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
  return (
    <>
      <FilterTrigger
        ref={trigger}
        label={t("Filters")}
        activeCount={activeCount}
        onReset={onReset}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={activeCount > 0}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <Popover
          kind="dialog"
          aria-label={t("Filters")}
          anchor={trigger}
          align="end"
          width={288}
          onDismiss={(reason) => {
            setOpen(false);
            // The trigger re-renders with its count while a filter changes.
            if (reason === "escape") trigger.current?.focus();
          }}
        >
          <div className="task-filter-popover">
            <div className="task-filter-header">
              <Heading size="item" level={4} className="task-filter-title">
                {t("Filters")}
                {activeCount > 0 ? (
                  <Badge size="xs" variant="count">
                    {activeCount}
                  </Badge>
                ) : null}
              </Heading>
              <Button variant="ghost" disabled={activeCount === 0} onClick={onReset}>
                {t("Reset")}
              </Button>
            </div>
            {field(
              t("Status"),
              [
                { value: "all", label: t("All") },
                ...TASK_COLUMNS.map((status) => ({
                  value: status,
                  label: t(COLUMN_LABELS[status]),
                })),
              ],
              values.status,
              onStatus,
            )}
            {field(
              t("Machine"),
              [
                { value: "all", label: t("All") },
                ...machines.map((machine) => ({ value: machine.id, label: machine.name })),
              ],
              values.machine,
              onMachine,
            )}
            {field(
              t("Show goal"),
              [
                { value: ALL_GOALS, label: t("All tasks") },
                ...goals.map((goal) => ({
                  value: goalKey(goal.machineId, goal.id),
                  label: goal.title,
                })),
              ],
              values.goal,
              onGoal,
            )}
            {sprints.length > 0
              ? field(
                  t("Sprint"),
                  [
                    { value: "", label: t("All sprints") },
                    ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
                  ],
                  values.sprint,
                  onSprint,
                )
              : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
