import { errorText } from "../../../shared/lib/errors";
import { findRevealedTask } from "../model/taskReveal";
import { useQueryClient } from "@tanstack/react-query";
import { SPRINT_CATALOG_QUERY_KEY } from "../model/useSprintCatalog";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { Text } from "../../../shared/ui/Text";
import "./tasks.css";
import "./tasks-shell.css";
import { Alert } from "../../../shared/ui/Alert";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { useTaskBoardQueries } from "../model/useTaskBoardQueries";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { WorkspaceReview } from "../../workspaces/ui/WorkspaceReview";
import { workspaceRequest } from "../../workspaces/public/workspaceClient";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { ManagedWorkspace } from "../../workspaces/model/contracts";
import { isWorkspaceValid, useWorkspaceChecks } from "./TaskWorkspacePicker";
import { TaskBulkToolbar } from "./TaskBulkToolbar";
import { TaskList } from "./TaskList";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { useSprintBoard } from "../model/sprintClient";
import { sprintProjectKey, sprintTaskKey } from "../model/hostSprints";
import { initialTaskProjectScope, taskProjectIdentity } from "../model/taskBoardScope";
import { SprintManagement } from "./SprintManagement";
import { SprintPlanningControls } from "./SprintPlanningControls";
import { bulkTaskKey } from "../model/taskBulkActions";
import {
  type BoardTask,
  newTaskDraft,
  readTaskNotes,
  recheckTaskReview,
  finishTaskWithFindings,
  recordTaskEvaluation,
  resolveTaskNote,
  retargetTask,
  startTask,
  type TaskDraft,
} from "../model/taskClient";
import { taskClientErrors } from "../model/taskClientErrors";
import type { TaskWorkspace } from "../model/taskWorkspace";
import { taskColumn, type TaskColumn, type TaskStatus } from "../model/hostTasks";
import { t, useLocale, useT } from "../../../shared/i18n";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DashboardSquare } from "../../../shared/ui/icons";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import { TaskSessionSheet } from "./TaskSessionSheet";
import { useLocalHostState } from "../../connections/public/localHostService";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/public/lockState";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/public/models";
import { projectKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
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
  taskBoardTechnicalDetails,
} from "./useTaskBoardOperations";
import { TaskBoardColumns } from "./TaskBoardColumns";
import { TaskDetail } from "./TaskDetail";
import {
  TaskToolbar,
  normalizeTaskSection,
  projectScopeOptions,
  type TaskSection,
} from "./TaskToolbar";
import { TaskDeliveryDialog, TaskMetricsDialog } from "./TasksViewDialogs";
import { TasksViewDraftDialog } from "./TasksViewDraftDialog";
import { TasksViewEmpty } from "./TasksViewEmpty";
import { useFilteredTasks, type TaskCountFilter } from "./TasksViewFilter";
import { useBoardIndexes, useTaskContexts } from "./TasksViewIndexes";
import { useTaskMutations } from "./TasksViewMutations";
import { TasksViewRecovery } from "./TasksViewRecovery";
import {
  ALL_GOALS,
  GoalList,
  GoalSessionsDialog,
  GoalSettingsDialog,
  NewGoalDialog,
  useTaskGoals,
} from "./TaskGoals";
import { useMachineLimitSave } from "./TaskLimits";
import { StewardsSection, useTaskStewards } from "./TaskStewards";
import { TaskCountChips, useTaskCountsRequest } from "./TaskSummaryPanel";

type Props = {
  taskReveal?: import("../model/taskReveal").TaskRevealTarget & { token: number };
  goalReveal?: { machineId: string; goalId: string; token: number };
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
  goalReveal,
  taskReveal,
}: Props) {
  "use memo";
  const t = useT();
  // Inside a tool window the tool switcher replaces the plain title.
  const toolNavigation = useContext(ToolNavigationContext);
  const navigating = Boolean(toolNavigation?.active);
  return (
    <Text
      as="div"
      tone="neutral"
      size="inherit"
      role="region"
      aria-label={t("Tasks")}
      data-app-tasks
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <PaneHeader
        dragRegion
        chromeInset={!besideRail ? true : compactRail ? "compact" : false}
        leading={
          besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        }
        icon={navigating ? undefined : <DashboardSquare strokeWidth={1.75} />}
        title={navigating ? undefined : t("Tasks")}
        trailing={IS_MAC ? null : <WindowControls />}
      >
        {navigating ? <ToolNavigation /> : null}
      </PaneHeader>
      <TasksContent
        cwd={cwd}
        recents={recents}
        onOpenBackgroundSession={onOpenBackgroundSession}
        goalReveal={goalReveal}
        taskReveal={taskReveal}
      />
    </Text>
  );
}

function TasksContent({
  cwd,
  recents,
  onOpenBackgroundSession,
  goalReveal,
  taskReveal,
}: Pick<Props, "cwd" | "recents" | "onOpenBackgroundSession" | "goalReveal" | "taskReveal">) {
  useLocale();
  // Tasks for a project in a locked group are not shown.
  const viewStateKey = `tasks:${cwd ? projectKey(cwd) : "global"}`;
  const lock = useLockSnapshot();
  const [projectFilter, setProjectFilter] = useState("all");
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
  } = useTaskBoardQueries(projectFilter, { planningCatalog: true });
  const ops = useTaskBoardOperations(refreshQueries);
  const {
    error,
    errorDetails,
    errorMachineId,
    setError,
    reportError,
    saving,
    acting,
    act,
    refresh,
    confirmDialog,
  } = ops;
  // Background polls refresh silently; the spinner belongs to the first read and
  // to a refresh the user asked for.
  const [manualRefresh, setManualRefresh] = useState(false);
  const refreshInFlight = useRef(false);
  const queryClient = useQueryClient();
  const retryBoard = () => {
    if (board.pending || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setManualRefresh(true);
    void Promise.all([
      refreshQueries(true),
      ...(section === "sprints"
        ? [
            sprintBoard.refresh(),
            queryClient.invalidateQueries({ queryKey: SPRINT_CATALOG_QUERY_KEY }),
          ]
        : []),
    ])
      .catch((reason: unknown) => reportError(reason))
      .finally(() => {
        refreshInFlight.current = false;
        setManualRefresh(false);
      });
  };
  const { boardDataState, now } = useBoardDataState(board, projectFilter);
  // Machines whose host keeps a task board, this computer's included.
  const machines = board.machines;
  const inventory = queryClient.getQueryData<typeof machines>(["task-board", "inventory"]);
  const machineOptions = inventory ?? machines;
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
  const loading = board.pending && !board.hasTaskAnswer && !board.taskError;
  const refreshing = manualRefresh || loading;
  const [sessionPreview, setSessionPreview] = useState<BackgroundSessionTarget | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(new Set<string>());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [listView, setListView] = useRetainedState(`${viewStateKey}:list`, true);
  const [searchQuery, setSearchQuery] = useRetainedState(`${viewStateKey}:search`, "");
  const [statusFilter, setStatusFilter] = useRetainedState(`${viewStateKey}:status`, "all");
  const [countFilter, setCountFilter] = useRetainedState<TaskCountFilter | null>(
    `${viewStateKey}:count`,
    null,
  );
  const [machineFilter, setMachineFilter] = useRetainedState(`${viewStateKey}:machine`, "all");
  const [retainedSection, setSection] = useRetainedState<TaskSection | "reports">(
    `${viewStateKey}:section`,
    "backlog",
  );
  const section = normalizeTaskSection(retainedSection);
  const [sprintFilter, setSprintFilter] = useRetainedState(`${viewStateKey}:sprint`, "");
  const discoveredProjects = board.projects;
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
  const groupLabels = useProjectLabels();
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
  const [metricsOpen, setMetricsOpen] = useState(false);

  const visibleTasks = useMemo(
    () => storedTasks.filter((task) => !isProjectLockedIn(lock, task.cwd)),
    [lock, storedTasks],
  );
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
          name: projectDisplayNameFrom(task.cwd, groupLabels),
        });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [discoveredProjects, visibleTasks, machines, lock, groupLabels]);
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
  const sprintBoard = useSprintBoard(
    board.planningMachines,
    visibleTasks,
    sprintProjects,
    async (machine, data) => {
      const queryKey = [
        ...SPRINT_CATALOG_QUERY_KEY,
        machine.id,
        machine.environmentId,
        machine.endpoint,
      ];
      await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
      queryClient.setQueryData(queryKey, { machine, sprints: data.sprints, error: null });
    },
  );
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
  const selectedSprint = accessibleSprints.find((sprint) => sprint.id === sprintFilter);
  const currentSprint = section === "sprints" ? selectedSprint : undefined;
  const selectedProject = projectScopes.find(
    (project) =>
      project.key === projectFilter ||
      (projectFilter.startsWith("path:") && projectKey(project.cwd) === projectFilter.slice(5)),
  );
  const scopedCwd =
    selectedProject?.cwd ??
    (cwd && projectFilter === initialTaskProjectScope(cwd) ? cwd : undefined);
  const machineDefaultCwd =
    machineFilter === "all"
      ? undefined
      : projectScopes.find(
          (project) =>
            project.machineId === machineFilter &&
            (!currentSprint ||
              currentSprint.projects.some((member) => sprintProjectKey(member) === project.key)),
        )?.cwd;
  useEffect(() => {
    // A chosen project must not retain an incompatible sprint selection.
    if (
      selectedSprint &&
      selectedProject &&
      !selectedSprint.projects.some((project) => sprintProjectKey(project) === selectedProject.key)
    )
      setSprintFilter("");
  }, [selectedSprint, selectedProject?.key, setSprintFilter]);
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
      machineId: machineFilter === "all" ? undefined : machineFilter,
      selectedProject,
      scopedCwd: scopedCwd ?? machineDefaultCwd,
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
  useEffect(() => {
    if (!goalReveal) return;
    setProjectFilter("all");
    setGoalFilter(goalKey(goalReveal.machineId, goalReveal.goalId));
    setSection("backlog");
  }, [goalReveal]);
  const [handledTaskReveal, setHandledTaskReveal] = useState<number>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Resolves an external automation-history navigation request when its exact Host task arrives, once per request token.
  useEffect(() => {
    if (!taskReveal || handledTaskReveal === taskReveal.token) return;
    setProjectFilter("all");
    setGoalFilter(ALL_GOALS);
    setSearchQuery("");
    setStatusFilter("all");
    setCountFilter(null);
    setMachineFilter("all");
    setSprintFilter("");
    setSection("backlog");
    const task = findRevealedTask(taskReveal, machines, storedTasks);
    if (!task || isProjectLockedIn(lock, task.cwd)) return;
    setHandledTaskReveal(taskReveal.token);
    setSelectedKey(`${task.machineId}:${task.id}`);
  }, [
    taskReveal,
    machines,
    storedTasks,
    lock,
    handledTaskReveal,
    setSearchQuery,
    setSection,
    setSprintFilter,
    setGoalFilter,
    setStatusFilter,
    setCountFilter,
    setMachineFilter,
  ]);
  const stewards = useTaskStewards({
    ops,
    scope: { cwd, recents, projectFilter, lock, machines, selectedProject },
    stored: board.stewards,
    capable: stewardCapable,
    putSteward,
    removeSteward,
  });
  const onChangeLimits = useMachineLimitSave(limitCapable, putLimits, setError);
  const showBacklog = useStableCallback(() => {
    setSection("backlog");
    setSprintFilter("");
  });
  const countsRef = useRef<HTMLElement>(null);
  const [focusCounts, setFocusCounts] = useState(false);
  const revealCounts = useStableCallback(() => {
    showBacklog();
    setFocusCounts(true);
  });
  useTaskCountsRequest(revealCounts);
  // A notification changes panes first, then moves focus to the mounted counts.
  useEffect(() => {
    if (!focusCounts || section !== "backlog" || loading || !countsRef.current) return;
    countsRef.current.focus();
    setFocusCounts(false);
  }, [focusCounts, section, loading]);
  // Stewards are shown on the Tasks tab.
  useEffect(() => {
    if (stewards.open) showBacklog();
  }, [stewards.open, showBacklog]);
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
    const environment = machineOptions.find(
      (machine) => machine.id === machineFilter,
    )?.environmentId;
    setSprintFilter(id);
    if (
      sprint &&
      environment &&
      !sprint.projects.some((project) => project.environmentId === environment)
    )
      setMachineFilter("all");
    if (
      sprint &&
      (!selectedProject ||
        !sprint.projects.some((project) => sprintProjectKey(project) === selectedProject.key))
    )
      setProjectFilter("all");
    setSection("sprints");
  };
  const dailyNotice =
    dailyLimitNotice(limits.filter((entry) => !entry.stale)) ??
    (board.limitErrors.length ? t("Daily agent time is unavailable.") : null);
  const goalTitles = useMemo(
    () => new Map(goalList.map((goal) => [goalKey(goal.machineId, goal.id), goal.title])),
    [goalList],
  );
  const { scoped, tasks } = useFilteredTasks({
    visibleTasks,
    goalFilter,
    statusFilter,
    countFilter,
    machineFilter,
    projectFilter,
    searchQuery,
    machines,
    sprintBoard,
    accessibleSprints,
    section,
    sprintFilter,
    now,
  });
  const activeFilterCount =
    Number(goalFilter !== ALL_GOALS) +
    Number(statusFilter !== "all") +
    Number(sprintFilter !== "") +
    Number(machineFilter !== "all") +
    Number(projectFilter !== "all");
  // Changing scope drops hidden selections; select-all never means hidden tasks.
  // Adjusted during render when the visible set changes (the list itself is rebuilt often).
  // Rebuilt only when the filtered list itself changes, not on every render or poll tick.
  const visibleSignature = useMemo(() => JSON.stringify(tasks.map(bulkTaskKey)), [tasks]);
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
      setError(taskClientErrors.machine());
      return;
    }
    const preferredMachine = machineFilter === "all" ? undefined : machineFilter;
    const project =
      scopedCwd ??
      machineDefaultCwd ??
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
      machineId:
        selectedProject?.machineId ??
        preferredMachine ??
        backgroundMachineFor(machines, project)?.id,
    });
  };

  const { actOnTask, onMove, onTaskDrop, onSave, onDelete, onEdit, onSaveDetails } =
    useTaskMutations({
      ops,
      put: { task: putTask, tasks: putTasks, remove: removeTask },
      machines,
      displayedTasks: tasks,
      setDraft,
      currentSprint,
      sprintBoard,
      addPlanningRecovery,
    });
  const onOpenSession = async (task: BoardTask, sessionId: string) => {
    const key = JSON.stringify([task.machineId, sessionId]);
    if (openingSessionRequests.current.has(key)) return;
    openingSessionRequests.current.add(key);
    setOpeningSessions(new Set(openingSessionRequests.current));
    try {
      setSessionPreview(taskBackgroundSessionTarget(task, sessionId));
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      openingSessionRequests.current.delete(key);
      setOpeningSessions(new Set(openingSessionRequests.current));
    }
  };

  const boardIndexes = useBoardIndexes(storedTasks, tasks);
  const taskContexts = useTaskContexts(
    storedTasks,
    boardIndexes.machineTasks,
    groupLabels,
    goalTitles,
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
      onFinishWithFindings: () => void actOnTask(task, () => finishTaskWithFindings(task)),
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
  const openCard = useStableCallback((key: string) => setSelectedKey(key));
  const selected = selectedKey
    ? tasks.find((task) => `${task.machineId}:${task.id}` === selectedKey)
    : undefined;
  // A task that is gone from the board takes its panel with it.
  if (selectedKey && !loading && !selected) setSelectedKey(null);

  const workMachineId = machineFilter !== "all" ? machineFilter : selectedProject?.machineId;
  const workMachine = (inventory ?? machines).find((machine) => machine.id === workMachineId);
  const hostStopped =
    localHost === "stopped" &&
    (workMachine
      ? isLocalSyncMachine(workMachine)
      : projectFilter === "all" || Boolean(scopedCwd && !parseRemotePath(scopedCwd)));
  const actionError = draft || goals.draft || deliveryTask ? null : error;
  const actionMachine = machineOptions.find((machine) => machine.id === errorMachineId);
  const actionMessage =
    actionError && actionMachine
      ? `${isLocalSyncMachine(actionMachine) ? t("This computer") : actionMachine.name} · ${actionError}`
      : actionError;
  const boardIssue = missingNotice || boardDataState.error;
  const diagnostic = boardIssue
    ? taskBoardTechnicalDetails(queryClient, selectedProject?.machineId)
    : null;
  const affectedMachines = diagnostic?.machineIds
    .map((id) => {
      const machine = machineOptions.find((entry) => entry.id === id);
      return machine && isLocalSyncMachine(machine) ? t("This computer") : machine?.name;
    })
    .filter(Boolean)
    .join(", ");
  const problemMessage =
    (boardIssue
      ? (missingNotice ??
        (affectedMachines
          ? t("Some task data could not be refreshed on {p0}.", { p0: affectedMachines })
          : t("Some task data could not be refreshed.")))
      : null) ??
    (hostStopped ? t("The host on this computer is not running.") : null) ??
    actionMessage ??
    (!loading && !board.hasTaskAnswer && !machines.length
      ? t("Connect a machine with a task board to see tasks here.")
      : null);
  const technicalDetails = problemMessage
    ? [
        actionError ? (errorDetails ?? actionError) : null,
        boardIssue ? diagnostic?.details || boardDataState.error : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : null;
  // Optional reads or another machine failing cannot erase a verified empty board.
  const unreadable = !board.hasTaskAnswer
    ? board.taskError
      ? t("Tasks could not be read.")
      : machines.length === 0
        ? t("Connect a machine with a task board to see tasks here.")
        : null
    : null;
  const narrowed = Boolean(searchQuery.trim()) || activeFilterCount > 0 || countFilter !== null;
  const resetPopoverFilters = () => {
    setSprintFilter("");
    setGoalFilter(ALL_GOALS);
    setStatusFilter("all");
    setMachineFilter("all");
    setProjectFilter("all");
  };
  const resetTaskFilters = () => {
    resetPopoverFilters();
    setSearchQuery("");
    setCountFilter(null);
  };
  const hasTasks = visibleTasks.length > 0;
  const showOnboarding =
    section === "backlog" &&
    !loading &&
    !hasTasks &&
    goalList.length === 0 &&
    !narrowed &&
    !unreadable;
  const showTaskArea = section === "backlog" || Boolean(currentSprint);
  const inUsageScope = (id: string) => !workMachineId || id === workMachineId;
  const scopedLimits = limits.filter((entry) => inUsageScope(entry.machineId));
  const usageMachines = (projectFilter === "all" ? (inventory ?? machines) : machines).filter(
    (machine) => inUsageScope(machine.id),
  );
  const missingUsage = [
    ...new Set([
      ...usageMachines
        .filter((machine) => !scopedLimits.some((entry) => entry.machineId === machine.id))
        .map((machine) => (isLocalSyncMachine(machine) ? t("This computer") : machine.name)),
      ...board.limitErrors
        .filter(
          (entry) =>
            inUsageScope(entry.machineId) &&
            !scopedLimits.some((limit) => limit.machineId === entry.machineId),
        )
        .map((entry) => entry.machineName),
    ]),
  ];
  const retryPlanning = async (item: PlanningRecovery) => {
    if (retryingPlanning) return;
    setRetryingPlanning(item.id);
    try {
      if (item.task) await sprintBoard.plan(item.task, item.sprintId);
      else if (item.goal)
        await sprintBoard.setGoalContext(item.goal.environmentId, item.goal.goalId, item.sprintId);
      setPlanningRecovery((items) => items.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      setPlanningRecovery((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, reason: presentRemoteError(reason, { explicit: true }) }
            : entry,
        ),
      );
    } finally {
      setRetryingPlanning(null);
    }
  };
  const toggleSelectMode = () => {
    setSelectMode((value) => !value);
    setBulkSelection(new Set());
  };
  const creationBusy = saving || draft != null || goals.draft != null;
  const unavailableScope = projectFilter !== "all" && !scopedCwd;
  const createDisabled = creationBusy || unavailableScope;
  const epicDisabled =
    creationBusy || unavailableScope || !goalCapable.some((machine) => inUsageScope(machine.id));
  const newEpic = () => goals.begin();
  const emptyTasks = (
    <TasksViewEmpty
      unreadable={unreadable}
      retrying={board.pending || manualRefresh}
      hasVisibleTasks={visibleTasks.length > 0}
      narrowed={narrowed}
      onboarding={showOnboarding}
      createDisabled={createDisabled}
      epicDisabled={epicDisabled}
      onRetry={retryBoard}
      onReset={resetTaskFilters}
      onCreate={beginCreate}
      onCreateEpic={newEpic}
      emptySprint={
        section === "sprints" &&
        Boolean(currentSprint) &&
        !searchQuery.trim() &&
        statusFilter === "all" &&
        !countFilter &&
        machineFilter === "all" &&
        goalFilter === ALL_GOALS
      }
      onBacklog={showBacklog}
      onSprints={() => setSection("sprints")}
    />
  );

  return (
    <Text
      as="div"
      tone="neutral"
      size="inherit"
      className="bycoda-tasks flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {taskReveal && handledTaskReveal !== taskReveal.token ? (
        <Alert tone={board.pending ? "info" : "warning"}>
          {board.pending
            ? t("Loading task…")
            : t("This task is unavailable on its original machine and project.")}
        </Alert>
      ) : null}
      <TaskToolbar
        section={section}
        onSection={(value) => {
          setSection(value);
          if (value === "backlog") setSprintFilter("");
        }}
        search={{
          visible: showTaskArea && (hasTasks || Boolean(searchQuery)),
          value: searchQuery,
          onChange: setSearchQuery,
        }}
        view={{
          visible: !showOnboarding && showTaskArea,
          list: listView,
          onList: setListView,
        }}
        newReviewNotes={newReviewNotes}
        filters={{
          visible:
            activeFilterCount > 0 ||
            goalList.length > 0 ||
            hasTasks ||
            projectScopes.length > 1 ||
            machineOptions.length > 1 ||
            accessibleSprints.length > 0,
          values: {
            project: projectFilter,
            status: statusFilter,
            machine: machineFilter,
            goal: goalFilter,
            sprint: sprintFilter,
          },
          activeCount: activeFilterCount,
          machines: machineOptions,
          projects: projectScopeOptions({
            t,
            projectLabels: groupLabels,
            projectFilter,
            selectedProject,
            projectScopes,
            currentSprint,
            cwd,
          }),
          goals: goalList,
          sprints: accessibleSprints,
          onProject: (value) => {
            const project = projectScopes.find((entry) => entry.key === value);
            if (project && machineFilter !== "all" && project.machineId !== machineFilter)
              setMachineFilter("all");
            setProjectFilter(value);
          },
          onStatus: (value) => {
            setCountFilter(null);
            setStatusFilter(value);
          },
          onMachine: (value) => {
            setMachineFilter(value);
            if (value !== "all" && projectFilter !== "all" && selectedProject?.machineId !== value)
              setProjectFilter("all");
            const environment = machineOptions.find(
              (machine) => machine.id === value,
            )?.environmentId;
            if (
              selectedSprint &&
              environment &&
              !selectedSprint.projects.some((project) => project.environmentId === environment)
            )
              setSprintFilter("");
          },
          onGoal: setGoalFilter,
          onSprint: selectSprint,
          onReset: resetPopoverFilters,
        }}
        select={{
          visible: showTaskArea && visibleTasks.length > 0 && !selectMode,
          active: selectMode,
          disabled: bulkBusy,
          onToggle: toggleSelectMode,
        }}
        menu={{
          stewardsOpen: stewards.open,
          showStewards: stewardCapable.length > 0,
          onPick: (id) => {
            if (id === "metrics") setMetricsOpen(true);
            if (id === "stewards") stewards.toggle();
          },
        }}
        phase={boardDataState.phase}
        problem={
          problemMessage
            ? {
                label:
                  boardIssue || hostStopped || !actionError
                    ? t("Connection issue")
                    : t("Task action failed"),
                message: problemMessage,
                details: technicalDetails,
                updatedAt: boardDataState.updatedAt,
                hostStopped,
                retrying: refreshing || board.pending,
                onRetry: retryBoard,
              }
            : null
        }
        create={{
          visible: !showOnboarding && showTaskArea && (!unreadable || loading),
          disabled: createDisabled,
          onCreate: beginCreate,
        }}
        epic={{ disabled: epicDisabled, onCreate: newEpic }}
      />
      {showTaskArea && !loading ? (
        <TaskCountChips
          tasks={scoped}
          now={now}
          selected={countFilter}
          onSelect={(filter) => {
            setStatusFilter("all");
            setCountFilter((value) => (value === filter ? null : filter));
          }}
          incomplete={Boolean(board.taskError || scoped.some((task) => task.stale))}
          limits={scopedLimits}
          missingUsage={missingUsage}
          focusRef={countsRef}
        />
      ) : null}
      <TasksViewRecovery
        items={planningRecovery}
        retrying={retryingPlanning}
        onRetry={(item) => void retryPlanning(item)}
      />
      {selectMode && showTaskArea ? (
        <>
          <TaskBulkToolbar
            tasks={tasks}
            selected={bulkSelection}
            onSelect={setBulkSelection}
            disabled={acting !== null}
            onBusy={setBulkBusy}
            onUpdated={putTask}
            onDeleted={removeTask}
            onFinish={toggleSelectMode}
            onError={setError}
          />
          <SprintPlanningControls
            layout="bar"
            board={accessibleSprintBoard}
            tasks={tasks.filter((task) => bulkSelection.has(bulkTaskKey(task)))}
            disabled={bulkBusy || acting !== null}
          />
        </>
      ) : null}
      {confirmDialog}
      {metricsOpen ? (
        <TaskMetricsDialog tasks={tasks} onClose={() => setMetricsOpen(false)} />
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
        <Alert
          tone="warning"
          className="mx-3 mt-3 shrink-0"
          action={{ label: t("Manage models"), onClick: () => openModelsSettings("order") }}
        >
          {dailyNotice}
        </Alert>
      ) : null}
      {draft ? (
        <TasksViewDraftDialog
          draft={draft}
          recents={recents}
          machines={machines}
          todoCapable={todoCapable}
          saving={saving}
          notice={error}
          sprintName={currentSprint?.name}
          onClose={() => setDraft(null)}
          onSave={(mode, saved) => void onSave(mode, saved)}
        />
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
            void refresh().catch((reason) => reportError(reason));
          }}
        />
      ) : null}
      {deliveryTask ? (
        <TaskDeliveryDialog
          task={deliveryTask}
          machine={machines.find((machine) => machine.id === deliveryTask.machineId)}
          workspace={deliveryWorkspace}
          acting={Boolean(acting)}
          busy={deliveryBusy}
          valid={deliveryValid}
          notice={error}
          onChange={setDeliveryWorkspace}
          onBusyChange={setDeliveryBusy}
          onChecksChange={patchDeliveryChecks}
          onClose={() => setDeliveryTask(null)}
          onSave={() =>
            void act(
              deliveryTask,
              () => retargetTask(deliveryTask, deliveryWorkspace),
              (saved) => {
                putTask(saved);
                setDeliveryTask(null);
              },
            )
          }
        />
      ) : null}
      {section === "backlog" ? (
        <StewardsSection
          stewards={stewards}
          capable={stewardCapable}
          recents={recents}
          saving={saving}
          acting={acting}
          now={now}
        />
      ) : null}
      {showTaskArea && goalList.length > 0 ? (
        <GoalList
          goals={goals}
          filter={goalFilter}
          tasks={storedTasks}
          acting={acting}
          revealKey={
            goalReveal
              ? `${goalReveal.machineId}:${goalReveal.goalId}:${goalReveal.token}`
              : undefined
          }
        />
      ) : null}
      {section === "sprints" ? (
        <SprintManagement
          board={accessibleSprintBoard}
          projects={sprintProjects}
          selectedId={sprintFilter}
          onSelect={selectSprint}
          projectKey={selectedProject?.key}
          environmentId={
            machineOptions.find((machine) => machine.id === machineFilter)?.environmentId
          }
        />
      ) : null}
      {showTaskArea ? (
        <div className="@container/task-area task-board-area flex min-w-0 flex-1">
          <GoalSessionsDialog goals={goals} tasks={visibleTasks} onOpenSession={onOpenSession} />
          <ScrollArea
            ref={boardRef}
            axis="both"
            scrollbar="always"
            gutter="stable"
            className="min-h-0 min-w-0 flex-1 overscroll-none p-4 @max-[640px]/task-area:has-[+aside]:hidden"
          >
            {loading ? (
              <SurfaceLoading />
            ) : listView || selectMode ? (
              tasks.length ? (
                <TaskList
                  stateKey={`${viewStateKey}:list:${projectFilter}:${sprintFilter}:${section}:${statusFilter}:${countFilter ?? ""}`}
                  tasks={tasks}
                  selection={selectMode}
                  selected={bulkSelection}
                  activeKey={selectedKey}
                  disabled={bulkBusy}
                  planningLabel={planningLabel}
                  actionsFor={cardActions}
                  now={now}
                  onToggle={(task, checked) =>
                    setBulkSelection((current) => {
                      const next = new Set(current);
                      if (checked) next.add(bulkTaskKey(task));
                      else next.delete(bulkTaskKey(task));
                      return next;
                    })
                  }
                  onOpen={(task) => openCard(`${task.machineId}:${task.id}`)}
                  onRetry={(task) => onMove(task, "queued")}
                />
              ) : (
                emptyTasks
              )
            ) : (
              <TaskBoardColumns
                tasks={tasks}
                visibleTasks={tasks}
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
                empty={emptyTasks}
              />
            )}
          </ScrollArea>
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
      ) : null}
    </Text>
  );
}
