import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Heading } from "../../../shared/ui/Heading";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SplitButton } from "../../../shared/ui/SplitButton";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { TabStrip } from "../../../shared/ui/Tabs";
import { TextField } from "../../../shared/ui/TextField";
import {
  Bot,
  ChartBreakoutSquare,
  CheckList,
  LayoutGrid,
  ListBullet,
  MoreHorizontal,
  Plus,
  Sparkles,
} from "../../../shared/ui/icons";
import { projectDisplayName } from "../../projects/public/projectNames";
import { sprintProjectKey } from "../model/hostSprints";
import { TaskToolbarFilters, type TaskToolbarFilterProps } from "./TaskToolbarFilters";
import { TaskBoardProblem, type TaskBoardProblemProps } from "./TasksViewDialogs";

export type TaskSection = "backlog" | "sprints";

export function normalizeTaskSection(section: TaskSection | "reports"): TaskSection {
  return section === "reports" ? "sprints" : section;
}

type ProjectScope = { key: string; name: string; machineName: string; cwd: string };

/** Options of the project picker: all projects, the scoped path, then each known project. */
export function projectScopeOptions({
  t,
  projectLabels,
  projectFilter,
  selectedProject,
  projectScopes,
  currentSprint,
  cwd,
}: {
  t: (key: string) => string;
  projectLabels?: Record<string, string>;
  projectFilter: string;
  selectedProject: ProjectScope | undefined;
  projectScopes: readonly ProjectScope[];
  currentSprint: { projects: readonly { environmentId: string; projectId: string }[] } | undefined;
  cwd: string | undefined;
}) {
  const pathScope = projectFilter.startsWith("path:");
  return [
    { value: "all", label: t("All projects"), pinned: true },
    ...(pathScope && !selectedProject
      ? [{ value: projectFilter, label: projectDisplayName(cwd || "", projectLabels) }]
      : []),
    ...projectScopes
      .filter(
        (project) =>
          !currentSprint ||
          currentSprint.projects.some((member) => sprintProjectKey(member) === project.key) ||
          project.key === projectFilter,
      )
      .map((project) => ({
        value: project.key,
        label: `${project.name} · ${project.machineName}`,
        description: project.cwd,
      })),
    ...(selectedProject && pathScope
      ? [
          {
            value: projectFilter,
            label: `${selectedProject.name} · ${selectedProject.machineName}`,
          },
        ]
      : []),
  ];
}

type TaskToolbarProps = {
  section: TaskSection;
  onSection: (value: TaskSection) => void;
  search: { visible: boolean; value: string; onChange: (value: string) => void };
  view: { visible: boolean; list: boolean; onList: (list: boolean) => void };
  newReviewNotes: number;
  filters: TaskToolbarFilterProps & { visible: boolean };
  select: { visible: boolean; active: boolean; disabled: boolean; onToggle: () => void };
  menu: { stewardsOpen: boolean; showStewards: boolean; onPick: (id: string) => void };
  phase: string;
  problem: TaskBoardProblemProps | null;
  create: { visible: boolean; disabled: boolean; onCreate: () => void };
  epic: { disabled: boolean; onCreate: () => void };
};

export function TaskCreationSplit({ create, epic }: Pick<TaskToolbarProps, "create" | "epic">) {
  const t = useT();
  return (
    <SplitButton
      variant="primary"
      size="sm"
      type="button"
      label={t("New task")}
      menuLabel={t("More creation options")}
      startIcon={<Plus className="icon-sm" />}
      onClick={create.onCreate}
      disabled={create.disabled}
      menuDisabled={epic.disabled}
      actions={[
        {
          id: "epic",
          label: t("New epic"),
          icon: <Sparkles className="icon-sm" />,
          onSelect: epic.onCreate,
        },
      ]}
    />
  );
}

export function TaskToolbar({
  section,
  onSection,
  search,
  view,
  newReviewNotes,
  filters,
  select,
  menu,
  phase,
  problem,
  create,
  epic,
}: TaskToolbarProps) {
  const t = useT();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  return (
    <header
      {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "task-board-toolbar")}
      data-remote-data-state={phase}
    >
      <Heading size="page" className="sr-only">
        {t("Tasks")}
      </Heading>
      <TabStrip
        label={t("Task sections")}
        value={section}
        items={[
          {
            value: "backlog",
            label: t("Tasks"),
            count: newReviewNotes || undefined,
            countLabel:
              newReviewNotes === 1
                ? t("{p0} new review note", { p0: newReviewNotes })
                : t("{p0} new review notes", { p0: newReviewNotes }),
          },
          { value: "sprints", label: t("Sprints") },
        ]}
        onValueChange={onSection}
      />
      <div className="task-board-actions">
        {problem ? <TaskBoardProblem {...problem} /> : null}
        {search.visible ? (
          <TextField
            fieldClassName="task-search-field"
            label={t("Search tasks")}
            hideLabel
            placeholder={t("Search tasks")}
            type="search"
            value={search.value}
            onChange={(event) => search.onChange(event.currentTarget.value)}
          />
        ) : null}
        {filters.visible ? <TaskToolbarFilters {...filters} /> : null}
        {view.visible ? (
          <SegmentedControl
            label={t("Task view")}
            value={view.list ? "list" : "board"}
            options={[
              {
                value: "list",
                label: t("List view"),
                icon: <ListBullet className="icon-sm" />,
                iconOnly: true,
              },
              {
                value: "board",
                label: t("Board view"),
                icon: <LayoutGrid className="icon-sm" />,
                iconOnly: true,
              },
            ]}
            onValueChange={(value) => view.onList(value === "list")}
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("More actions")}
          aria-haspopup="menu"
          aria-expanded={!!menuAnchor}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
        {menuAnchor ? (
          <DropdownMenu
            anchor={menuAnchor}
            label={t("More actions")}
            items={[
              ...(select.visible
                ? [
                    {
                      kind: "item" as const,
                      id: "select",
                      label: t("Select tasks"),
                      checked: select.active,
                      disabled: select.disabled,
                      icon: <CheckList className="icon-sm" />,
                    },
                  ]
                : []),
              {
                kind: "item",
                id: "metrics",
                label: t("Compare accepted results"),
                icon: <ChartBreakoutSquare className="icon-sm" />,
              },
              ...(menu.showStewards
                ? [
                    {
                      kind: "item" as const,
                      id: "stewards",
                      label: t("Stewards"),
                      checked: menu.stewardsOpen,
                      icon: <Bot className="icon-sm" />,
                    },
                  ]
                : []),
            ]}
            onClose={() => setMenuAnchor(null)}
            onPick={(id) => (id === "select" ? select.onToggle() : menu.onPick(id))}
          />
        ) : null}
        {create.visible ? <TaskCreationSplit create={create} epic={epic} /> : null}
      </div>
    </header>
  );
}
