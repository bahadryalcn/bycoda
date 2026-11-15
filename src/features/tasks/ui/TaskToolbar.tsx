import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { useState } from "react";
import { LiveText } from "../../../shared/ui/LiveText";
import { useT } from "../../../shared/i18n";
import { projectDisplayName } from "../../projects/public/projectNames";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TabStrip } from "../../../shared/ui/Tabs";
import { TextField } from "../../../shared/ui/TextField";
import {
  Bot,
  CheckList,
  TriangleAlert,
  ChartBreakoutSquare,
  DashboardSquare,
  Gauge,
  LayoutGrid,
  ListBullet,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
} from "../../../shared/ui/icons";
import { sprintProjectKey } from "../model/hostSprints";
import { TaskToolbarFilters, type TaskFilterValues } from "./TaskToolbarFilters";

export type TaskSection = "backlog" | "sprints" | "reports";

type ProjectScope = { key: string; name: string; machineName: string; cwd: string };

/** Options of the project picker: all projects, the scoped path, then each known project. */
export function projectScopeOptions({
  t,
  projectFilter,
  selectedProject,
  projectScopes,
  currentSprint,
  cwd,
}: {
  t: (key: string) => string;
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
      ? [{ value: projectFilter, label: projectDisplayName(cwd || "") }]
      : []),
    ...projectScopes
      .filter(
        (project) =>
          !currentSprint ||
          currentSprint.projects.some((member) => sprintProjectKey(member) === project.key),
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

export type TaskToolbarProps = {
  section: TaskSection;
  showReports: boolean;
  onSection: (value: TaskSection) => void;
  projectOptions: { value: string; label: string; description?: string; pinned?: boolean }[];
  projectFilter: string;
  onProject: (value: string) => void;
  search: { visible: boolean; value: string; onChange: (value: string) => void };
  machineNotice: string | null;
  view: { visible: boolean; list: boolean; onList: (list: boolean) => void };
  newReviewNotes: number;
  filters: {
    visible: boolean;
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
  };
  select: { visible: boolean; active: boolean; disabled: boolean; onToggle: () => void };
  menu: {
    summaryOpen: boolean;
    stewardsOpen: boolean;
    limitsOpen: boolean;
    showStewards: boolean;
    showLimits: boolean;
    newGoalDisabled: boolean;
    onPick: (id: string) => void;
  };
  status: {
    phase: string;
    problem: boolean;
    refreshing: boolean;
    retryable: boolean;
    failed: boolean;
    connectionIssue: boolean;
    onDetails: () => void;
    onRefresh: () => void;
  };
  create: { visible: boolean; disabled: boolean; onCreate: () => void };
};

export function TaskToolbar(props: TaskToolbarProps) {
  const t = useT();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [scopeAnchor, setScopeAnchor] = useState<HTMLElement | null>(null);
  const { section, filters, menu, status } = props;
  return (
    <header {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "task-board-toolbar")}>
      <Heading size="page" className="sr-only">
        {t("Tasks")}
      </Heading>
      <TabStrip
        label={t("Task sections")}
        value={section}
        items={[
          {
            value: "backlog",
            label: t("Backlog"),
            count: props.newReviewNotes || undefined,
            countLabel: t(
              props.newReviewNotes === 1 ? "{p0} new review note" : "{p0} new review notes",
              { p0: props.newReviewNotes },
            ),
          },
          { value: "sprints", label: t("Sprints") },
          // Reports have nothing to show before the first sprint.
          ...(props.showReports ? [{ value: "reports" as const, label: t("Reports") }] : []),
        ]}
        onValueChange={props.onSection}
      />
      <Button
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={!!scopeAnchor}
        onClick={(event) => setScopeAnchor(scopeAnchor ? null : event.currentTarget)}
      >
        {t("Scope")}
      </Button>
      {scopeAnchor ? (
        <Popover
          anchor={scopeAnchor}
          kind="dialog"
          aria-label={t("Scope")}
          flow="scroll"
          onDismiss={() => setScopeAnchor(null)}
          className="grid gap-2 p-3"
        >
          <div className="task-project-scope">
            <SearchableSelect
              label={t("Server")}
              value={filters.values.machine}
              onChange={filters.onMachine}
              options={[
                { value: "all", label: t("All servers"), pinned: true },
                ...filters.machines.map((machine) => ({ value: machine.id, label: machine.name })),
              ]}
            />
          </div>
          <div className="task-project-scope">
            <SearchableSelect
              label={t("Project")}
              value={props.projectFilter}
              options={props.projectOptions}
              onChange={props.onProject}
            />
          </div>
        </Popover>
      ) : null}
      {props.search.visible ? (
        <TextField
          fieldClassName="task-search-field"
          label={t("Search tasks")}
          hideLabel
          placeholder={t("Search tasks")}
          type="search"
          value={props.search.value}
          onChange={(event) => props.search.onChange(event.currentTarget.value)}
        />
      ) : null}
      {props.machineNotice ? (
        <Text size="caption" tone="secondary" leading="inherit" className="task-board-notice">
          {props.machineNotice}
        </Text>
      ) : null}
      <div className="task-board-actions">
        {props.view.visible ? (
          <SegmentedControl
            label={t("Task view")}
            value={props.view.list ? "list" : "board"}
            options={[
              {
                value: "board",
                label: t("Board view"),
                icon: <LayoutGrid className="icon-sm" strokeWidth={1.75} />,
                iconOnly: true,
              },
              {
                value: "list",
                label: t("List view"),
                icon: <ListBullet className="icon-sm" strokeWidth={1.75} />,
                iconOnly: true,
              },
            ]}
            onValueChange={(value) => props.view.onList(value === "list")}
          />
        ) : null}
        {filters.visible ? (
          <TaskToolbarFilters
            values={filters.values}
            activeCount={filters.activeCount}
            goals={filters.goals}
            sprints={filters.sprints}
            onStatus={filters.onStatus}
            onGoal={filters.onGoal}
            onSprint={filters.onSprint}
            onReset={filters.onReset}
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
              ...(props.select.visible
                ? [
                    {
                      kind: "item" as const,
                      id: "select",
                      label: t("Select tasks"),
                      checked: props.select.active,
                      disabled: props.select.disabled,
                      icon: <CheckList className="icon-sm" />,
                    },
                  ]
                : []),
              {
                kind: "item",
                id: "summary",
                label: t("Summary"),
                checked: menu.summaryOpen,
                icon: <DashboardSquare className="icon-sm" strokeWidth={1.75} />,
              },
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
              ...(menu.showLimits
                ? [
                    {
                      kind: "item" as const,
                      id: "limits",
                      label: t("Limits"),
                      checked: menu.limitsOpen,
                      icon: <Gauge className="icon-sm" />,
                    },
                  ]
                : []),
              {
                kind: "item",
                id: "goal",
                label: t("New epic"),
                disabled: menu.newGoalDisabled,
                icon: <Sparkles className="icon-sm" />,
              },
            ]}
            onClose={() => setMenuAnchor(null)}
            onPick={(id) => (id === "select" ? props.select.onToggle() : menu.onPick(id))}
          />
        ) : null}
        <div className="task-board-status" data-remote-data-state={status.phase}>
          {status.problem ? (
            <Button
              variant="ghost"
              onClick={status.onDetails}
              tone={status.problem ? "warning" : "neutral"}
            >
              <TriangleAlert className="icon-sm" strokeWidth={1.75} />
              <LiveText
                text={
                  status.failed
                    ? t("Task action failed")
                    : status.connectionIssue
                      ? t("Connection issue")
                      : t("Refreshing…")
                }
              />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            iconOnly
            label={status.retryable ? t("Retry") : t("Refresh")}
            loading={status.refreshing}
            onClick={status.onRefresh}
          >
            <RefreshCw className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
        {props.create.visible ? (
          <Button
            variant="primary"
            type="button"
            aria-label={t("New task")}
            startIcon={<Plus className="icon-sm" strokeWidth={1.75} />}
            onClick={props.create.onCreate}
            disabled={props.create.disabled}
          >
            <span className="task-toolbar-label">{t("New task")}</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
