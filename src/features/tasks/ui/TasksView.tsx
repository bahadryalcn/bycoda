import "./tasks.css";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Popover } from "../../../shared/ui/Popover";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { useTaskBoardQueries } from "../model/useTaskBoardQueries";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { projectDisplayName } from "../../projects/model/projectNames";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { WorkspaceReview } from "../../workspaces/ui/WorkspaceReview";
import { workspaceOperationKey, workspaceRequest } from "../../workspaces/model/workspaceClient";
import { taskWorkspaceState } from "../../workspaces/model/taskWorkspaceState";
import type { ManagedWorkspace } from "../../workspaces/model/contracts";
import { TextField } from "../../../shared/ui/TextField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { isWorkspaceValid, TaskWorkspacePicker, useWorkspaceChecks } from "./TaskWorkspacePicker";
import { TaskBulkToolbar } from "./TaskBulkToolbar";
import { TaskList } from "./TaskList";
import { useSprintBoard } from "../model/sprintClient";
import { sprintProjectKey, sprintTaskKey } from "../model/hostSprints";
import {
  initialTaskProjectScope,
  taskMatchesProject,
  taskProjectIdentity,
  type TaskProjectScope,
} from "../model/taskBoardScope";
import { SprintManagement } from "./SprintManagement";
import { SprintPlanningControls } from "./SprintPlanningControls";
import { SprintReports } from "./SprintReports";
import { bulkTaskKey } from "../model/taskBulkActions";
import { HostModelSource } from "../../connections/ui/HostModelSource";
import {
  type BoardTask,
  deleteTask,
  draftFromTask,
  moveTask,
  newTaskDraft,
  readTaskNotes,
  recheckTaskReview,
  recordTaskEvaluation,
  reorderTasks,
  resolveTaskNote,
  retargetTask,
  saveTask,
  startTask,
  TASK_MACHINE_ERROR,
  type TaskDraft,
  tasksInColumn,
  todoUnsupportedMessage,
} from "../model/taskClient";
import type { TaskWorkspace } from "../model/taskWorkspace";
import {
  canMoveTask,
  EMPTY_PROMPT_ERROR,
  hasUnmergedBranch,
  TASK_COLUMNS,
  taskColumn,
  type TaskColumn,
  type TaskStatus,
  unfinishedDependencies,
} from "../model/hostTasks";
import { getLocale, t, useLocale, useT } from "../../../shared/i18n";
import { machineProjects } from "../../automations/model/machineSnapshot";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleHelp,
  DashboardSquare,
  Gauge,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
} from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TaskMetricsComparison } from "./TaskRunInsights";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { backgroundMachineFor, hostProjectCwd } from "../../automations/model/hostAutomationClient";
import { LAYER } from "../../../shared/lib/layers";
import { TaskSessionSheet } from "./TaskSessionSheet";
import { LocalHostStartButton } from "../../connections/ui/LocalHostDownNotice";
import { useLocalHostState } from "../../connections/model/localHostService";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/model/models";
import { projectKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";
import { goalKey } from "../model/goalClient";
import { declineProposal } from "../model/stewardClient";
import { dailyLimitNotice } from "../model/settingsClient";
import {
  type BackgroundSessionTarget,
  taskBackgroundSessionTarget,
  taskSessionIds,
} from "../model/backgroundSession";
import {
  type PlanningRecovery,
  useBoardDataState,
  useTaskBoardOperations,
} from "./useTaskBoardOperations";
import { COLUMN_LABELS, TaskBoardColumns } from "./TaskBoardColumns";
import { TaskDetail } from "./TaskDetail";
import { TaskForm } from "./TaskForm";
import { resolveTaskMachineId } from "./useTaskTargetMachine";
import { machineName } from "./TaskFormFields";
import {
  ALL_GOALS,
  GoalList,
  GoalSessionsDialog,
  GoalSettingsDialog,
  NewGoalDialog,
  useTaskGoals,
} from "./TaskGoals";
import { LimitsPanel, useMachineLimitSave } from "./TaskLimits";
import { StewardsSection, useTaskStewards } from "./TaskStewards";
import { SummaryPanel, useDailySummaryPanel } from "./TaskSummaryPanel";

type Props = {
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  recents: RecentProject[];
  onClose: () => void;
  onToggleSidebar?: () => void;
  /** Opens the session a task ran in, on whichever machine ran it. */
  onOpenBackgroundSession: (target: BackgroundSessionTarget) => void | Promise<void>;
};

export function TasksView({
  besideRail = false,
  compactRail = false,
  cwd,
  recents,
  onClose,
  onToggleSidebar,
  onOpenBackgroundSession,
}: Props) {
  "use memo";
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t("Tasks")}
      data-app-tasks
      className="flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-(--ui-tone-neutral-border)"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-secondary">
            <DashboardSquare
              className="icon-sm shrink-0 text-(--ui-text-secondary)"
              strokeWidth={1.75}
            />
            <span className="min-w-0 truncate text-(--ui-tone-neutral-fg)">{t("Tasks")}</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <TasksContent cwd={cwd} recents={recents} onOpenBackgroundSession={onOpenBackgroundSession} />
    </div>
  );
}

function TasksContent({
  cwd,
  recents,
  onOpenBackgroundSession,
}: Pick<Props, "cwd" | "recents" | "onOpenBackgroundSession">) {
  useLocale();
  // Tasks for a project in a locked group are not shown.
  const viewStateKey = `tasks:${cwd ? projectKey(cwd) : "global"}`;
  const lock = useLockSnapshot();
  // The board query owns every confirmed collection. A mutation writes the
  // host's answer back through the put/remove functions, so a later poll cannot
  // roll it back; only drafts and selections below are local state.
  const {
    board,
    refresh: refreshQueries,
    putTask,
    putTasks,
    removeTask,
    putGoal,
    removeGoal,
    putSteward,
    removeSteward,
    putLimits,
  } = useTaskBoardQueries();
  const ops = useTaskBoardOperations(refreshQueries);
  const { error, setError, saving, setSaving, acting, act, refresh, confirm, confirmDialog } = ops;
  const retryBoard = () => void refreshQueries(true);
  const { boardDataState, now } = useBoardDataState(board);
  // Machines whose host keeps a task board, this computer's included.
  const machines = board.machines;
  // Machines whose tasks are missing: offline, or with an older host.
  const missingNotice = board.notice;
  const localHost = useLocalHostState();
  // The ones whose host also keeps manual to-do items.
  const todoCapable = board.todoCapable;
  // Machines whose host carries out goals, runs project stewards, keeps work limits.
  const goalCapable = board.goalCapable;
  const stewardCapable = board.stewardCapable;
  const limitCapable = board.limitCapable;
  const storedTasks = board.tasks;
  const limits = board.limits;
  const loading = board.pending && !board.hasTaskAnswer;
  const [sessionPreview, setSessionPreview] = useState<BackgroundSessionTarget | null>(null);
  const [statusDetails, setStatusDetails] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(new Set<string>());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [listView, setListView] = useRetainedState(`${viewStateKey}:list`, false);
  const [searchQuery, setSearchQuery] = useRetainedState(`${viewStateKey}:search`, "");
  const [statusFilter, setStatusFilter] = useRetainedState(`${viewStateKey}:status`, "all");
  const [machineFilter, setMachineFilter] = useRetainedState(`${viewStateKey}:machine`, "all");
  const [projectFilter, setProjectFilter] = useState(() => initialTaskProjectScope(cwd));
  // A new project folder resets the scope, adjusted during render from the previous one.
  const [scopeCwd, setScopeCwd] = useState(cwd);
  if (scopeCwd !== cwd) {
    setScopeCwd(cwd);
    setProjectFilter(initialTaskProjectScope(cwd));
  }
  const [section, setSection] = useRetainedState<"backlog" | "sprints" | "reports">(
    `${viewStateKey}:section`,
    "backlog",
  );
  const [sprintFilter, setSprintFilter] = useRetainedState(`${viewStateKey}:sprint`, "");
  const [discoveredProjects, setDiscoveredProjects] = useState<TaskProjectScope[]>([]);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [deliveryTask, setDeliveryTask] = useState<BoardTask | null>(null);
  const [workspaceReview, setWorkspaceReview] = useState<{
    workspace: ManagedWorkspace;
    cwd: string;
  } | null>(null);
  const [deliveryWorkspace, setDeliveryWorkspace] = useState<TaskWorkspace>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryChecks, patchDeliveryChecks] = useWorkspaceChecks();
  const deliveryValid = isWorkspaceValid(deliveryWorkspace, deliveryChecks);
  const [compactColumn, setCompactColumn] = useRetainedState<TaskColumn | "all">(
    `${viewStateKey}:column`,
    "all",
  );
  const [planningRecovery, setPlanningRecovery] = useState<PlanningRecovery[]>([]);
  const [retryingPlanning, setRetryingPlanning] = useState<string | null>(null);
  const openingSessionRequests = useRef(new Set<string>());
  const [openingSessions, setOpeningSessions] = useState(new Set<string>());
  const [groupLabels] = useState(loadTabGroupLabels);
  const boardLock = useLockOverscroll<HTMLDivElement>();
  const [goalFilter, setGoalFilter] = useRetainedState(`${viewStateKey}:goal`, ALL_GOALS);
  const boardScroll = useRetainedScroll<HTMLDivElement>(
    `${viewStateKey}:${goalFilter}:${compactColumn}`,
    { ready: !loading },
  );
  const boardRef = useCallback(
    (node: HTMLDivElement | null) => {
      boardLock(node);
      boardScroll(node);
    },
    [boardLock, boardScroll],
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [boardActionMenu, setBoardActionMenu] = useState<HTMLElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);

  const visibleTasks = useMemo(
    () => storedTasks.filter((task) => !isProjectLockedIn(lock, task.cwd)),
    [lock, storedTasks],
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(
      machines.map(async (machine) => {
        const projects = await machineProjects(machine);
        return projects.map((project): TaskProjectScope => ({
          key: taskProjectIdentity(machine.environmentId, project.id),
          environmentId: machine.environmentId,
          projectId: project.id,
          machineId: machine.id,
          machineName: machine.name,
          cwd: hostProjectCwd(machine, project),
          name: project.name || projectDisplayName(project.cwd),
        }));
      }),
    ).then((results) => {
      if (!cancelled)
        setDiscoveredProjects(
          results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [machines]);
  const projectScopes = useMemo(() => {
    const entries = new Map(
      discoveredProjects
        .filter((project) => !isProjectLockedIn(lock, project.cwd))
        .map((project) => [project.key, project]),
    );
    for (const task of visibleTasks) {
      const machine = machines.find((entry) => entry.id === task.machineId);
      if (!machine?.environmentId) continue;
      const key = taskProjectIdentity(machine.environmentId, task.projectId);
      if (!entries.has(key))
        entries.set(key, {
          key,
          environmentId: machine.environmentId,
          projectId: task.projectId,
          machineId: machine.id,
          machineName: task.machineName,
          cwd: task.cwd,
          name: projectDisplayName(task.cwd),
        });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [discoveredProjects, visibleTasks, machines, lock]);
  const sprintProjects = useMemo(
    () =>
      projectScopes.map(({ environmentId, projectId, cwd, name }) => ({
        environmentId,
        projectId,
        cwd,
        name,
      })),
    [projectScopes],
  );
  const sprintBoard = useSprintBoard(machines, visibleTasks, sprintProjects);
  const accessibleSprints = useMemo(
    () =>
      sprintBoard.sprints.filter((sprint) =>
        sprint.projects.every((project) =>
          sprintProjects.some((allowed) => sprintProjectKey(allowed) === sprintProjectKey(project)),
        ),
      ),
    [sprintBoard.sprints, sprintProjects],
  );
  const accessibleSprintBoard = { ...sprintBoard, sprints: accessibleSprints };
  const currentSprint = accessibleSprints.find((sprint) => sprint.id === sprintFilter);
  const selectedProject = projectScopes.find(
    (project) =>
      project.key === projectFilter ||
      (projectFilter.startsWith("path:") && projectKey(project.cwd) === projectFilter.slice(5)),
  );
  const scopedCwd =
    selectedProject?.cwd ??
    (cwd && projectFilter === initialTaskProjectScope(cwd) ? cwd : undefined);
  useEffect(() => {
    // Reopening a project starts in that project, even if its previous sprint scope was broader.
    if (
      currentSprint &&
      selectedProject &&
      !currentSprint.projects.some((project) => sprintProjectKey(project) === selectedProject.key)
    )
      setSprintFilter("");
  }, [currentSprint, selectedProject?.key, setSprintFilter]);
  const addPlanningRecovery = (item: PlanningRecovery) =>
    setPlanningRecovery((items) => [...items, item]);
  const goals = useTaskGoals({
    ops,
    scope: {
      cwd,
      recents,
      projectFilter,
      lock,
      machines,
      selectedProject,
      scopedCwd,
      currentSprint,
      sprintBoard,
    },
    stored: board.goals,
    capable: goalCapable,
    putGoal,
    removeGoal,
    filter: goalFilter,
    setFilter: setGoalFilter,
    addRecovery: addPlanningRecovery,
    openSession: setSessionPreview,
  });
  const goalList = goals.goals;
  const stewards = useTaskStewards({
    ops,
    scope: { cwd, recents, projectFilter, lock, machines, selectedProject },
    stored: board.stewards,
    capable: stewardCapable,
    putSteward,
    removeSteward,
  });
  const onChangeLimits = useMachineLimitSave(limitCapable, putLimits, setError);
  const summary = useDailySummaryPanel();
  const planningFor = (task: BoardTask) => {
    const ref = sprintBoard.taskRef(task);
    return ref ? sprintBoard.planning.get(sprintTaskKey(ref)) : undefined;
  };
  const planningLabel = (task: BoardTask) => {
    const plan = planningFor(task);
    const sprint = accessibleSprints.find((entry) => entry.id === plan?.sprintId);
    return [
      sprint?.name,
      plan?.storyPoints != null ? t("{p0} points", { p0: plan.storyPoints }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const selectSprint = (id: string) => {
    const sprint = accessibleSprints.find((entry) => entry.id === id);
    setSprintFilter(id);
    if (
      sprint &&
      (!selectedProject ||
        !sprint.projects.some((project) => sprintProjectKey(project) === selectedProject.key))
    )
      setProjectFilter("all");
    if (section !== "reports") setSection("sprints");
  };
  const dailyNotice = useMemo(() => dailyLimitNotice(limits), [limits]);
  const goalTitles = useMemo(
    () => new Map(goalList.map((goal) => [goalKey(goal.machineId, goal.id), goal.title])),
    [goalList],
  );
  const tasks = useMemo(
    () =>
      visibleTasks.filter(
        (task) =>
          (goalFilter === ALL_GOALS ||
            (task.goalId && goalKey(task.machineId, task.goalId) === goalFilter)) &&
          (statusFilter === "all" || taskColumn(task.status) === statusFilter) &&
          (machineFilter === "all" || task.machineId === machineFilter) &&
          taskMatchesProject(task, projectFilter, machines) &&
          (() => {
            const ref = sprintBoard.taskRef(task);
            const plan = ref ? sprintBoard.planning.get(sprintTaskKey(ref)) : undefined;
            if (section === "backlog")
              return (
                !plan?.sprintId ||
                !accessibleSprints.some(
                  (sprint) =>
                    sprint.id === plan.sprintId &&
                    (sprint.state === "active" || sprint.state === "planned"),
                )
              );
            return !sprintFilter || plan?.sprintId === sprintFilter;
          })() &&
          (!searchQuery.trim() ||
            `${task.title}\n${task.prompt}\n${task.id}`
              .toLocaleLowerCase()
              .includes(searchQuery.trim().toLocaleLowerCase())),
      ),
    [
      goalFilter,
      visibleTasks,
      statusFilter,
      machineFilter,
      projectFilter,
      searchQuery,
      machines,
      sprintBoard.planning,
      sprintBoard.taskRef,
      accessibleSprints,
      section,
      sprintFilter,
    ],
  );
  const activeFilterCount =
    Number(goalFilter !== ALL_GOALS) +
    Number(statusFilter !== "all") +
    Number(machineFilter !== "all");
  // Changing scope drops hidden selections; select-all never means hidden tasks.
  // Adjusted during render when the visible set changes (the list itself is rebuilt often).
  const visibleSignature = JSON.stringify(tasks.map(bulkTaskKey));
  const [bulkScope, setBulkScope] = useState(visibleSignature);
  if (bulkScope !== visibleSignature) {
    setBulkScope(visibleSignature);
    const visible = new Set(tasks.map(bulkTaskKey));
    const next = new Set([...bulkSelection].filter((key) => visible.has(key)));
    if (next.size !== bulkSelection.size) setBulkSelection(next);
  }
  const newReviewNotes = tasks.reduce(
    (count, task) => count + unreadReviewNotes(task.reviewNotes),
    0,
  );

  const beginCreate = () => {
    if (projectFilter !== "all" && (!scopedCwd || isProjectLockedIn(lock, scopedCwd))) {
      setError(TASK_MACHINE_ERROR);
      return;
    }
    const project =
      scopedCwd ??
      (currentSprint
        ? ""
        : cwd && looksLikeProject(cwd) && !parseRemotePath(cwd) && !isProjectLockedIn(lock, cwd)
          ? cwd
          : (recents.find(
              (entry) =>
                looksLikeProject(entry.path) &&
                !parseRemotePath(entry.path) &&
                !isProjectLockedIn(lock, entry.path),
            )?.path ?? "~"));
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    setDraft({
      ...newTaskDraft(project, harness, model),
      machineId: selectedProject?.machineId ?? backgroundMachineFor(machines, project)?.id,
    });
  };

  const actOnTask = (task: BoardTask, action: () => Promise<BoardTask>) =>
    act(task, action, putTask);

  const onOpenSession = async (task: BoardTask, sessionId: string) => {
    const key = JSON.stringify([task.machineId, sessionId]);
    if (openingSessionRequests.current.has(key)) return;
    openingSessionRequests.current.add(key);
    setOpeningSessions(new Set(openingSessionRequests.current));
    try {
      setSessionPreview(taskBackgroundSessionTarget(task, sessionId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      openingSessionRequests.current.delete(key);
      setOpeningSessions(new Set(openingSessionRequests.current));
    }
  };

  const onMove = (task: BoardTask, to: TaskStatus) => {
    if (to === "done" && hasUnmergedBranch(task)) {
      const workspaceId = taskWorkspaceState(task).workspaceId;
      if (!workspaceId) {
        setError(
          t(
            "Update bycoda Host to mark this work finished without merging. Review changes separately to approve delivery.",
          ),
        );
        return;
      }
      void act(task, async () => {
        const workspace = await workspaceRequest(
          "workspaces.get",
          { workspaceId },
          { cwd: task.cwd },
        );
        if (!workspace) throw new Error(t("Workspace not found"));
        return workspaceRequest(
          "workspaces.finish",
          {
            workspaceId,
            expectedRevision: workspace.revision,
            idempotencyKey: workspaceOperationKey(),
          },
          { cwd: task.cwd },
        );
      });
      return;
    }
    if (to === "queued" && !task.prompt.trim()) {
      setError(EMPTY_PROMPT_ERROR);
      return;
    }
    void actOnTask(task, () =>
      to === "queued" && task.workspaceControlsSupported ? startTask(task) : moveTask(task, to),
    );
  };
  const onTaskDrop = async (task: BoardTask, column: TaskColumn, before?: BoardTask) => {
    if (acting || task.stale) return;
    if (taskColumn(task.status) !== column) {
      if (!canMoveTask(task.status, column, task.crewRunId ?? task.crewDefinitionId)) return;
      if (
        (column === "blocked" ||
          (column === "done" && hasUnmergedBranch(task)) ||
          (task.status === "review" && column === "queued")) &&
        !(await confirm({
          title: t("Move task"),
          message: t("Move this task to {p0}?", { p0: t(COLUMN_LABELS[column]) }),
          confirmLabel: t("Move"),
          danger: false,
        }))
      )
        return;
      onMove(task, column);
      return;
    }
    if (!task.workspaceControlsSupported) return;
    if (column !== "todo" && column !== "queued") return;
    const ordered = tasksInColumn(visibleTasks, column).filter(
      (item) => item.machineId === task.machineId && item.id !== task.id,
    );
    const index = before ? ordered.findIndex((item) => item.id === before.id) : ordered.length;
    if (
      before &&
      (before.machineId !== task.machineId ||
        before.status !== task.status ||
        before.id === task.id)
    )
      return;
    ordered.splice(index < 0 ? ordered.length : index, 0, task);
    await act(task, () => reorderTasks(ordered), putTasks);
  };

  /** `queued` starts a new task right away; `save` keeps an edited task's status. */
  const onSave = async (mode: "todo" | "queued" | "save") => {
    if (saving || !draft) return;
    setSaving(true);
    try {
      let saved = await saveTask(machines, draft, mode === "todo" ? "todo" : "queued");
      // Creation already succeeded. Publish that identity and retire the creation
      // draft before the separate start request, whose transport may fail even
      // after the host accepted it. Recovery uses this task's board controls.
      putTask(saved);
      setDraft(null);
      if (!draft.id && currentSprint && sprintBoard.supported) {
        try {
          await sprintBoard.plan(saved, currentSprint.id);
        } catch (reason) {
          setPlanningRecovery((items) => [
            ...items,
            {
              id: `task:${saved.machineId}:${saved.id}`,
              title: saved.title,
              sprintId: currentSprint.id,
              task: saved,
            },
          ]);
          setError(
            t("Task created. Sprint assignment failed: {p0}", {
              p0: reason instanceof Error ? reason.message : String(reason),
            }),
          );
          void refresh();
          return;
        }
      }
      if (mode === "queued" && saved.workspaceControlsSupported) {
        saved = await startTask(saved);
        putTask(saved);
      }
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (task: BoardTask) => {
    const discard = hasUnmergedBranch(task);
    if (
      !(await confirm({
        title: t("Delete task"),
        message: discard
          ? t(
              "Delete “{p0}”? Its work on {p1} was never merged, and the branch will be discarded.",
              { p0: task.title, p1: task.branch },
            )
          : t("Delete “{p0}”?", { p0: task.title }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    void act(
      task,
      () => deleteTask(task, discard),
      () => removeTask(task),
    );
  };

  const onEdit = (task: BoardTask) => {
    setError(null);
    setDraft(draftFromTask(task));
  };

  /** Saves a new title and description from the detail panel; true when saved. */
  const onSaveDetails = async (
    task: BoardTask,
    title: string,
    prompt: string,
  ): Promise<boolean> => {
    try {
      const saved = await saveTask(machines, { ...draftFromTask(task), title, prompt });
      putTask(saved);
      setError(null);
      void refresh();
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const boardIndexes = useMemo(() => {
    const machineTasks = new Map<string, BoardTask[]>();
    const peers = new Map<string, BoardTask[]>();
    for (const task of storedTasks) {
      const list = machineTasks.get(task.machineId) ?? [];
      list.push(task);
      machineTasks.set(task.machineId, list);
    }
    const columns = new Map(TASK_COLUMNS.map((column) => [column, tasksInColumn(tasks, column)]));
    for (const column of TASK_COLUMNS)
      for (const task of tasksInColumn(visibleTasks, column)) {
        const key = task.machineId + ":" + column,
          list = peers.get(key) ?? [];
        list.push(task);
        peers.set(key, list);
      }
    const orders = new Map<string, string>();
    for (const list of peers.values())
      list.forEach((task, index) =>
        orders.set(
          task.machineId + ":" + task.id,
          JSON.stringify([list[index - 1]?.id, list[index + 1]?.id]),
        ),
      );
    return { machineTasks, peers, columns, orders };
  }, [storedTasks, tasks, visibleTasks]);
  const taskContexts = useMemo(
    () =>
      new Map(
        storedTasks.map((task) => [
          task.machineId + ":" + task.id,
          {
            project: resolveTabGroupLabel(
              projectKey(task.cwd),
              groupLabels,
              projectDisplayName(task.cwd),
            ),
            goal: task.goalId ? goalTitles.get(goalKey(task.machineId, task.goalId)) : undefined,
            waitingFor:
              task.status === "queued"
                ? unfinishedDependencies(
                    task,
                    boardIndexes.machineTasks.get(task.machineId) ?? [],
                  ).map((other) => other.title)
                : [],
          },
        ]),
      ),
    [storedTasks, boardIndexes.machineTasks, groupLabels, goalTitles],
  );
  const taskContext = (task: BoardTask) => taskContexts.get(task.machineId + ":" + task.id)!;
  const actionsFor = (task: BoardTask) => {
    const sessions = taskSessionIds(task);
    const peers =
      task.workspaceControlsSupported && ["todo", "queued"].includes(task.status)
        ? (boardIndexes.peers.get(task.machineId + ":" + taskColumn(task.status)) ?? [])
        : [];
    const index = peers.findIndex((item) => item.id === task.id);
    const isOpeningSession = (sessionId: string) =>
      openingSessions.has(JSON.stringify([task.machineId, sessionId]));
    return {
      busy: acting != null,
      pending: acting === JSON.stringify([task.machineId, task.id]),
      onSaveEvaluation:
        task.evaluationSupported === false
          ? undefined
          : async (evaluation: {
              accepted: boolean;
              reviewMinutes: number;
              corrections: number;
            }) => {
              const saved = await recordTaskEvaluation(task, evaluation);
              putTask(saved);
            },
      onRecheckReview: () => void actOnTask(task, () => recheckTaskReview(task)),
      onMove: (to: TaskStatus) => onMove(task, to),
      onReviewWorkspace: async () => {
        const workspaceId = taskWorkspaceState(task).workspaceId;
        if (!workspaceId)
          throw new Error(t("Update bycoda Host to review and approve this task's delivery."));
        const workspace = await workspaceRequest(
          "workspaces.get",
          { workspaceId },
          { cwd: task.cwd },
        );
        if (!workspace) throw new Error(t("Workspace not found"));
        setWorkspaceReview({ workspace, cwd: task.cwd });
      },
      onStart: () => void actOnTask(task, () => startTask(task)),
      onEarlier:
        index > 0
          ? () => void onTaskDrop(task, taskColumn(task.status), peers[index - 1])
          : undefined,
      onLater:
        index >= 0 && index < peers.length - 1
          ? () => void onTaskDrop(task, taskColumn(task.status), peers[index + 2])
          : undefined,
      onDelivery: () => {
        setDeliveryTask(task);
        setDeliveryWorkspace({ checkoutCwd: task.deliveryCwd, baseBranch: task.baseBranch });
      },
      onPauseMerge: () => void actOnTask(task, () => retargetTask(task, undefined, false)),
      onEdit: () => onEdit(task),
      onDelete: () => onDelete(task),
      onDecline: () =>
        void act(
          task,
          () => declineProposal(task),
          () => removeTask(task),
        ),
      onOpenSession: sessions.worker ? () => void onOpenSession(task, sessions.worker!) : undefined,
      openingWorkerSession: Boolean(sessions.worker && isOpeningSession(sessions.worker)),
      onOpenReviewSession: sessions.review
        ? () => void onOpenSession(task, sessions.review!)
        : undefined,
      openingReviewSession: Boolean(sessions.review && isOpeningSession(sessions.review)),
      isOpeningSession,
      onReadNotes: (ids: string[]) => void actOnTask(task, () => readTaskNotes(task, ids)),
      onResolveNote: (id: string, resolved: boolean) =>
        void actOnTask(task, () => resolveTaskNote(task, id, resolved)),
      onOpenReview: (sessionId: string) => void onOpenSession(task, sessionId),
    };
  };
  const cardActions = useStableCallback(actionsFor);
  const openCard = useCallback((key: string) => setSelectedKey(key), []);
  const selected = selectedKey
    ? tasks.find((task) => `${task.machineId}:${task.id}` === selectedKey)
    : undefined;
  // A task that is gone from the board takes its panel with it.
  if (selectedKey && !loading && !selected) setSelectedKey(null);

  return (
    <div className="bycoda-tasks flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)">
      <header className="task-board-toolbar">
        <h1 className="sr-only">{t("Tasks")}</h1>
        <SegmentedControl
          label={t("Task sections")}
          value={section}
          options={[
            { value: "backlog", label: t("Backlog") },
            { value: "sprints", label: t("Sprints") },
            { value: "reports", label: t("Reports") },
          ]}
          onValueChange={(value) => {
            setSection(value as typeof section);
            if (value === "backlog") setSprintFilter("");
          }}
        />
        <SearchableSelect
          label={t("Project")}
          value={projectFilter}
          options={[
            { value: "all", label: t("All projects") },
            ...(projectFilter.startsWith("path:") && !selectedProject
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
            ...(selectedProject && projectFilter.startsWith("path:")
              ? [
                  {
                    value: projectFilter,
                    label: `${selectedProject.name} · ${selectedProject.machineName}`,
                  },
                ]
              : []),
          ]}
          onChange={setProjectFilter}
        />
        <SearchableSelect
          label={t("Sprint")}
          value={sprintFilter}
          options={[
            { value: "", label: t("All sprints") },
            ...accessibleSprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
          ]}
          onChange={selectSprint}
        />
        <TextField
          fieldClassName="task-search-field"
          label={t("Search tasks")}
          hideLabel
          placeholder={t("Search tasks")}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
        />
        {machines.length === 0 ? (
          <span className="task-board-notice">
            {loading
              ? t("Looking for machines…")
              : t("No connected machine has a task board. Connect one, or update its {p0} Host.", {
                  p0: PRODUCT_IDENTITY.displayName,
                })}
          </span>
        ) : null}
        <div className="task-board-actions">
          {section === "sprints" ? (
            <SegmentedControl
              label={t("Task view")}
              value={listView ? "list" : "board"}
              options={[
                { value: "board", label: t("Board view") },
                { value: "list", label: t("List view") },
              ]}
              onValueChange={(value) => setListView(value === "list")}
            />
          ) : null}
          {newReviewNotes > 0 ? (
            <span
              data-new-review-notes
              className="shrink-0 text-ui-micro text-(--ui-tone-warning-fg)"
            >
              {newReviewNotes}
              {t(" new review ")}
              {newReviewNotes === 1 ? t("note") : t("notes")}
            </span>
          ) : null}
          {section !== "reports" ? (
            <span className="task-scope-summary">{t("{p0} tasks", { p0: tasks.length })}</span>
          ) : null}
          {goalList.length > 0 || visibleTasks.length > 0 ? (
            <>
              <Button
                ref={filterTrigger}
                variant="ghost"
                iconOnly
                label={t("Filters")}
                tooltip={t("Filters")}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                selected={activeFilterCount > 0}
                aria-pressed={activeFilterCount > 0}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <ListFilter className="icon-sm" />
                {activeFilterCount > 0 ? (
                  <span className="task-filter-active" aria-hidden="true" />
                ) : null}
              </Button>
              {filtersOpen ? (
                <Popover
                  anchor={filterTrigger}
                  align="end"
                  width={280}
                  onDismiss={(reason) => {
                    setFiltersOpen(false);
                    if (reason === "escape") filterTrigger.current?.focus();
                  }}
                >
                  <div className="task-filter-popover" role="dialog" aria-label={t("Filters")}>
                    <label className="task-filter-field">
                      <span>{t("Status")}</span>
                      <SearchableSelect
                        label={t("Status")}
                        value={statusFilter}
                        options={[
                          { value: "all", label: t("All") },
                          ...TASK_COLUMNS.map((status) => ({
                            value: status,
                            label: t(COLUMN_LABELS[status]),
                          })),
                        ]}
                        onChange={setStatusFilter}
                      />
                    </label>
                    <label className="task-filter-field">
                      <span>{t("Machine")}</span>
                      <SearchableSelect
                        label={t("Machine")}
                        value={machineFilter}
                        options={[
                          { value: "all", label: t("All") },
                          ...machines.map((machine) => ({
                            value: machine.id,
                            label: machine.name,
                          })),
                        ]}
                        onChange={setMachineFilter}
                      />
                    </label>
                    <label className="task-filter-field">
                      <span>{t("Show goal")}</span>
                      <SearchableSelect
                        variant="pill"
                        align="end"
                        label={t("Show goal")}
                        layer={LAYER.submenu}
                        value={goalFilter}
                        options={[
                          {
                            value: ALL_GOALS,
                            get label() {
                              return t("All tasks");
                            },
                          },
                          ...goalList.map((goal) => ({
                            value: goalKey(goal.machineId, goal.id),
                            label: goal.title,
                          })),
                        ]}
                        onChange={setGoalFilter}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      disabled={activeFilterCount === 0}
                      onClick={() => {
                        setGoalFilter(ALL_GOALS);
                        setStatusFilter("all");
                        setMachineFilter("all");
                      }}
                    >
                      {t("Reset")}
                    </Button>
                  </div>
                </Popover>
              ) : null}
            </>
          ) : null}
          <Button
            variant="ghost"
            aria-pressed={selectMode}
            disabled={bulkBusy}
            onClick={() => {
              setSelectMode((value) => !value);
              setBulkSelection(new Set());
            }}
          >
            {t(selectMode ? "Finish selection" : "Select tasks")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("More actions")}
            aria-haspopup="menu"
            aria-expanded={!!boardActionMenu}
            onClick={(event) => setBoardActionMenu(event.currentTarget)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {boardActionMenu ? (
            <DropdownMenu
              anchor={boardActionMenu}
              label={t("More actions")}
              items={[
                {
                  kind: "item",
                  id: "summary",
                  label: t("Summary"),
                  checked: summary.open,
                  icon: <DashboardSquare className="icon-sm" strokeWidth={1.75} />,
                },
                {
                  kind: "item",
                  id: "metrics",
                  label: t("Compare accepted results"),
                  icon: <Gauge className="icon-sm" />,
                },
                ...(stewardCapable.length > 0
                  ? [
                      {
                        kind: "item" as const,
                        id: "stewards",
                        label: t("Stewards"),
                        checked: stewards.open,
                        icon: <Bot className="icon-sm" />,
                      },
                    ]
                  : []),
                ...(limits.length > 0
                  ? [
                      {
                        kind: "item" as const,
                        id: "limits",
                        label: t("Limits"),
                        checked: limitsOpen,
                        icon: <Gauge className="icon-sm" />,
                      },
                    ]
                  : []),
                {
                  kind: "item",
                  id: "goal",
                  label: t("New goal"),
                  disabled: goals.draft != null || draft != null,
                  icon: <Sparkles className="icon-sm" />,
                },
              ]}
              onClose={() => setBoardActionMenu(null)}
              onPick={(id) => {
                if (id === "metrics") setMetricsOpen(true);
                if (id === "summary") summary.toggle();
                if (id === "stewards") stewards.toggle();
                if (id === "limits") setLimitsOpen((open) => !open);
                if (id === "goal") goals.begin();
              }}
            />
          ) : null}
          <div className="task-board-status" data-remote-data-state={boardDataState.phase}>
            {error || missingNotice || boardDataState.error || board.pending ? (
              <Button
                variant="ghost"
                onClick={() => setStatusDetails(true)}
                tone={error || missingNotice || boardDataState.error ? "warning" : "neutral"}
              >
                {board.pending ? (
                  <LoaderCircle className="icon-xs animate-spin" strokeWidth={1.75} />
                ) : (
                  <CircleHelp className="icon-sm" strokeWidth={1.75} />
                )}
                <span aria-live="polite">
                  {error
                    ? t("Task action failed")
                    : missingNotice || boardDataState.error
                      ? t("Connection issue")
                      : t("Refreshing…")}
                </span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              iconOnly
              label={boardDataState.error ? t("Retry") : t("Refresh")}
              tooltip={boardDataState.error ? t("Retry") : t("Refresh")}
              loading={board.pending}
              onClick={retryBoard}
            >
              <RefreshCw className="icon-sm" strokeWidth={1.75} />
            </Button>
          </div>
          <Button
            variant="primary"
            type="button"
            onClick={beginCreate}
            disabled={draft != null || goals.draft != null}
          >
            <Plus className="icon-sm" strokeWidth={1.75} />
            {t("New task")}
          </Button>
        </div>
      </header>
      {planningRecovery.length ? (
        <ul className="task-planning-recovery" aria-label={t("Pending sprint assignments")}>
          {planningRecovery.map((item) => (
            <li key={item.id}>
              <span>{item.title}</span>
              <Button
                variant="secondary"
                loading={retryingPlanning === item.id}
                disabled={retryingPlanning !== null && retryingPlanning !== item.id}
                onClick={async () => {
                  if (retryingPlanning) return;
                  setRetryingPlanning(item.id);
                  try {
                    if (item.task) await sprintBoard.plan(item.task, item.sprintId);
                    else if (item.goal)
                      await sprintBoard.setGoalContext(
                        item.goal.environmentId,
                        item.goal.goalId,
                        item.sprintId,
                      );
                    setPlanningRecovery((items) => items.filter((entry) => entry.id !== item.id));
                    setError(null);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  } finally {
                    setRetryingPlanning(null);
                  }
                }}
              >
                {t("Retry sprint assignment")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {section === "sprints" ? (
        <SprintManagement
          board={accessibleSprintBoard}
          projects={sprintProjects}
          selectedId={sprintFilter}
          onSelect={selectSprint}
          projectKey={selectedProject?.key}
        />
      ) : null}
      {section === "reports" ? (
        <div className="task-reports-scroll">
          <SprintReports
            board={accessibleSprintBoard}
            sprintId={sprintFilter}
            projectKey={selectedProject?.key}
            onChooseSprint={selectSprint}
            onOpenSprints={() => setSection("sprints")}
            onOpenBacklog={() => setSection("backlog")}
          />
        </div>
      ) : null}
      {selectMode ? (
        <>
          <SprintPlanningControls
            board={accessibleSprintBoard}
            tasks={tasks.filter((task) => bulkSelection.has(bulkTaskKey(task)))}
            disabled={bulkBusy || acting !== null}
          />
          <TaskBulkToolbar
            tasks={tasks}
            selected={bulkSelection}
            onSelect={setBulkSelection}
            disabled={acting !== null}
            onBusy={setBulkBusy}
            onUpdated={putTask}
            onDeleted={removeTask}
          />
        </>
      ) : null}
      {confirmDialog}
      {metricsOpen ? (
        <Modal
          title={t("Compare accepted results")}
          size="lg"
          onClose={() => setMetricsOpen(false)}
        >
          <div className="min-w-0 p-4">
            <TaskMetricsComparison tasks={tasks.filter((task) => !task.stale)} />
          </div>
        </Modal>
      ) : null}
      {statusDetails ? (
        <Modal title={t("Task board status")} onClose={() => setStatusDetails(false)}>
          <div className="task-status-details">
            {missingNotice ? <p>{missingNotice}</p> : null}
            {error || boardDataState.error ? (
              <p>{error || boardDataState.error}</p>
            ) : (
              <p>{t("Up to date")}</p>
            )}
            {boardDataState.updatedAt ? (
              <p>
                {t("Last verified {p0}", {
                  p0: new Date(boardDataState.updatedAt).toLocaleString(getLocale()),
                })}
              </p>
            ) : null}
            {localHost === "stopped" ? (
              <LocalHostStartButton
                onStarted={retryBoard}
                onError={(message) => setError(message ?? null)}
              />
            ) : null}
          </div>
        </Modal>
      ) : null}
      {sessionPreview ? (
        <TaskSessionSheet
          key={`${sessionPreview.machineId}:${sessionPreview.sessionId}`}
          target={sessionPreview}
          onClose={() => setSessionPreview(null)}
          onOpen={onOpenBackgroundSession}
        />
      ) : null}
      {dailyNotice ? (
        <Alert tone="warning" role="status" className="mx-3 mt-3 shrink-0">
          {dailyNotice}
        </Alert>
      ) : null}
      {summary.open ? (
        <SummaryPanel
          summary={summary.summary}
          busy={summary.busy}
          error={summary.error}
          onRefresh={() => void summary.refresh()}
          onOpenTask={setSelectedKey}
        />
      ) : null}
      {limitsOpen && limits.length > 0 ? (
        <LimitsPanel limits={limits} onChange={onChangeLimits} />
      ) : null}
      {draft ? (
        <Modal
          title={draft.id ? t("Edit task") : t("New task")}
          context={!draft.id && currentSprint ? `${t("Sprint")}: ${currentSprint.name}` : undefined}
          size="lg"
          scroll="none"
          onClose={() => {
            if (!saving) setDraft(null);
          }}
        >
          {error ? (
            <Alert tone="danger" role="alert" className="mx-4 mt-3 shrink-0">
              {error}
            </Alert>
          ) : null}
          <HostModelSource
            machine={machines.find(
              (entry) => entry.id === resolveTaskMachineId(machines, draft.cwd, draft.machineId),
            )}
            cwd={draft.cwd}
            model={draft.model}
            values={draft.modelSettings}
          >
            <TaskForm
              key={draft.id ?? "new"}
              draft={draft}
              recents={recents}
              machines={machines}
              machine={machineName(machines, draft.cwd, draft.machineId)}
              todoUnsupported={todoUnsupportedMessage(machines, todoCapable, draft.cwd)}
              saving={saving}
              onChange={(next) => {
                if (!saving) setDraft(next);
              }}
              onCancel={() => {
                if (!saving) setDraft(null);
              }}
              onSubmit={(mode) => void onSave(mode)}
              limits={limits}
              onChangeLimits={onChangeLimits}
            />
          </HostModelSource>
        </Modal>
      ) : null}
      <GoalSettingsDialog goals={goals} saving={saving} />
      <NewGoalDialog
        goals={goals}
        saving={saving}
        error={error}
        recents={recents}
        capable={goalCapable}
        currentSprintName={currentSprint?.name}
        limits={limits}
        onChangeLimits={onChangeLimits}
      />
      {workspaceReview ? (
        <WorkspaceReview
          workspace={workspaceReview.workspace}
          context={{ cwd: workspaceReview.cwd }}
          onClose={() => setWorkspaceReview(null)}
          onWorkspaceChange={(workspace) => {
            setWorkspaceReview((current) => (current ? { ...current, workspace } : null));
            void refresh();
          }}
        />
      ) : null}
      {deliveryTask ? (
        <Modal
          title={t("Choose delivery target")}
          size="lg"
          onClose={() => {
            if (!acting) setDeliveryTask(null);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                type="button"
                disabled={Boolean(acting)}
                onClick={() => setDeliveryTask(null)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                type="button"
                loading={Boolean(acting)}
                disabled={Boolean(acting) || deliveryBusy || !deliveryValid}
                onClick={() =>
                  void act(
                    deliveryTask,
                    () => retargetTask(deliveryTask, deliveryWorkspace),
                    (saved) => {
                      putTask(saved);
                      setDeliveryTask(null);
                    },
                  )
                }
              >
                {t("Save delivery target")}
              </Button>
            </>
          }
        >
          <div className="p-4">
            <p>
              {t(
                "The completed task stays on its branch. Pending tasks in this goal and project will use the selected integration worktree.",
              )}
            </p>
            {error ? (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            ) : null}
            <TaskWorkspacePicker
              machine={machines.find((machine) => machine.id === deliveryTask.machineId)}
              cwd={deliveryTask.cwd}
              value={deliveryWorkspace}
              onChange={setDeliveryWorkspace}
              disabled={Boolean(acting)}
              onBusyChange={setDeliveryBusy}
              onChecksChange={patchDeliveryChecks}
            />
          </div>
        </Modal>
      ) : null}
      <StewardsSection
        stewards={stewards}
        capable={stewardCapable}
        recents={recents}
        saving={saving}
        acting={acting}
        now={now}
      />
      {section !== "reports" && goalList.length > 0 ? (
        <GoalList goals={goals} filter={goalFilter} tasks={storedTasks} acting={acting} />
      ) : null}
      <div
        className={`@container/task-area min-h-0 min-w-0 flex-1 ${section === "reports" ? "hidden" : "flex"}`}
      >
        <GoalSessionsDialog goals={goals} tasks={visibleTasks} onOpenSession={onOpenSession} />
        <div
          ref={boardRef}
          className="min-h-0 min-w-0 flex-1 overflow-x-scroll overflow-y-auto overscroll-none p-3 [scrollbar-gutter:stable] @max-[640px]/task-area:has-[+aside]:hidden"
        >
          {loading ? (
            <div className="grid h-full place-items-center text-(--ui-text-secondary)">
              <LoaderCircle className="icon-md animate-spin" />
            </div>
          ) : listView || selectMode || section === "backlog" ? (
            tasks.length ? (
              <TaskList
                key={`${projectFilter}:${sprintFilter}:${section}:${statusFilter}:${searchQuery}`}
                tasks={tasks}
                selection={selectMode}
                selected={bulkSelection}
                activeKey={selectedKey}
                disabled={bulkBusy}
                planningLabel={(task) => {
                  const state = taskWorkspaceState(task);
                  return [
                    planningLabel(task),
                    task.branch || state.workspaceId
                      ? `${t(state.completion)} · ${t(state.delivery)}`
                      : "",
                    state.needsRenewedApproval
                      ? t("Automatic merge is suspended. Review changes to renew approval.")
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                }}
                onToggle={(task, checked) =>
                  setBulkSelection((current) => {
                    const next = new Set(current);
                    if (checked) next.add(bulkTaskKey(task));
                    else next.delete(bulkTaskKey(task));
                    return next;
                  })
                }
                onOpen={(task) => openCard(`${task.machineId}:${task.id}`)}
              />
            ) : (
              <EmptyState description={t("No tasks match your search or filters.")} />
            )
          ) : (
            <TaskBoardColumns
              tasks={tasks}
              visibleTasks={visibleTasks}
              columns={boardIndexes.columns}
              orders={boardIndexes.orders}
              compactColumn={compactColumn}
              onCompactColumnChange={setCompactColumn}
              now={now}
              acting={acting}
              bulkBusy={bulkBusy}
              selectedKey={selectedKey}
              openingSessions={openingSessions}
              taskContext={taskContext}
              planningLabel={planningLabel}
              actionsFor={cardActions}
              onOpen={openCard}
              onTaskDrop={onTaskDrop}
            />
          )}
        </div>
        {selected ? (
          <TaskDetail
            key={`${selected.machineId}:${selected.id}`}
            task={selected}
            now={now}
            {...taskContext(selected)}
            {...actionsFor(selected)}
            onClose={() => setSelectedKey(null)}
            onSaveDetails={(title, prompt) => onSaveDetails(selected, title, prompt)}
            planning={<SprintPlanningControls board={accessibleSprintBoard} tasks={[selected]} />}
          />
        ) : null}
      </div>
    </div>
  );
}
