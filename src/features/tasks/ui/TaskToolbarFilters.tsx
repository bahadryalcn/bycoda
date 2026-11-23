import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { LAYER } from "../../../shared/lib/layers";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { goalKey } from "../model/goalClient";
import { TASK_COLUMNS } from "../model/hostTasks";
import { ALL_GOALS } from "./TaskGoals";
import { COLUMN_LABELS } from "./TaskBoardColumns";

type Option = { value: string; label: string; description?: string; pinned?: boolean };

export type TaskToolbarFilterProps = {
  values: { project: string; status: string; machine: string; goal: string; sprint: string };
  activeCount: number;
  machines: readonly { id: string; name: string }[];
  projects: Option[];
  goals: readonly { machineId: string; id: string; title: string }[];
  sprints: readonly { id: string; name: string }[];
  onProject: (value: string) => void;
  onMachine: (value: string) => void;
  onStatus: (value: string) => void;
  onGoal: (value: string) => void;
  onSprint: (value: string) => void;
  onReset: () => void;
};

/** A single scope and status filter, with one count and reset. */
export function TaskToolbarFilters({
  values,
  activeCount,
  machines,
  projects,
  goals,
  sprints,
  onProject,
  onMachine,
  onStatus,
  onGoal,
  onSprint,
  onReset,
}: TaskToolbarFilterProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <FilterTrigger
        ref={trigger}
        label={t("Filter")}
        activeCount={activeCount}
        onReset={onReset}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <Popover
          kind="dialog"
          aria-label={t("Filter")}
          anchor={trigger}
          align="end"
          width={288}
          flow="scroll"
          variant="panel"
          onDismiss={() => setOpen(false)}
        >
          <div className="task-filter-popover">
            {machines.length > 1 ? (
              <SearchableSelect
                label={t("Server")}
                layer={LAYER.submenu}
                value={values.machine}
                options={[
                  { value: "all", label: t("All servers"), pinned: true },
                  ...machines.map((machine) => ({ value: machine.id, label: machine.name })),
                ]}
                onChange={onMachine}
              />
            ) : null}
            <SearchableSelect
              label={t("Project")}
              layer={LAYER.submenu}
              value={values.project}
              options={projects}
              onChange={onProject}
            />
            <SearchableSelect
              label={t("Status")}
              layer={LAYER.submenu}
              value={values.status}
              options={[
                { value: "all", label: t("All") },
                ...TASK_COLUMNS.map((status) => ({
                  value: status,
                  label: t(COLUMN_LABELS[status]),
                })),
                ...(values.status === "verifying"
                  ? [{ value: "verifying", label: t("Verifying") }]
                  : []),
              ]}
              onChange={onStatus}
            />
            {sprints.length > 0 || values.sprint ? (
              <SearchableSelect
                label={t("Sprint")}
                layer={LAYER.submenu}
                value={values.sprint}
                options={[
                  { value: "", label: t("All sprints") },
                  ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
                ]}
                onChange={onSprint}
              />
            ) : null}
            <SearchableSelect
              label={t("Show epic")}
              layer={LAYER.submenu}
              value={values.goal}
              options={[
                { value: ALL_GOALS, label: t("All tasks") },
                ...goals.map((goal) => ({
                  value: goalKey(goal.machineId, goal.id),
                  label: goal.title,
                })),
              ]}
              onChange={onGoal}
            />
          </div>
        </Popover>
      ) : null}
    </>
  );
}
