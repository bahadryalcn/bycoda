import { findRevealedTask } from "../model/taskReveal";
import { Button } from "../../../shared/ui/Button";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import { Text } from "../../../shared/ui/Text";
import "./tasks.css";
import "./tasks-shell.css";
import { Alert } from "../../../shared/ui/Alert";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { useTaskBoardQueries } from "../model/useTaskBoardQueries";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { projectDisplayName } from "../../projects/public/projectNames";
import { ToolNavigation, ToolNavigationContext } from "../../../app/shell/ToolNavigation";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { WorkspaceReview } from "../../workspaces/ui/WorkspaceReview";
import { workspaceRequest } from "../../workspaces/public/workspaceClient";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { ManagedWorkspace } from "../../workspaces/model/contracts";
import { isWorkspaceValid, useWorkspaceChecks } from "./TaskWorkspacePicker";
import { TaskBulkToolbar } from "./TaskBulkToolbar";
import { TaskList } from "./TaskList";
import { useSprintBoard } from "../model/sprintClient";
import { sprintProjectKey, sprintTaskKey } from "../model/hostSprints";
import { initialTaskProjectScope, taskProjectIdentity } from "../model/taskBoardScope";
import { SprintManagement } from "./SprintManagement";
import { SprintPlanningControls } from "./SprintPlanningControls";
import { SprintReports } from "./SprintReports";
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
  TASK_MACHINE_ERROR,
  type TaskDraft,
} from "../model/taskClient";
import type { TaskWorkspace } from "../model/taskWorkspace";
import { taskColumn, type TaskColumn, type TaskStatus } from "../model/hostTasks";
import { t, useLocale, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
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
import { loadTabGroupLabels } from "../../workspace/public/tabGroups";
import { goalKey } from "../model/goalClient";
import { declineProposal } from "../model/stewardClient";
import { dailyLimitNotice } from "../model/settingsClient";
import { formatAgentMinutes } from "../model/hostSettings";
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
import { TaskBoardColumns } from "./TaskBoardColumns";
import { TaskDetail } from "./TaskDetail";
import { TaskToolbar, projectScopeOptions } from "./TaskToolbar";
import { TaskBoardStatusDialog, TaskDeliveryDialog, TaskMetricsDialog } from "./TasksViewDialogs";
import { TasksViewDraftDialog } from "./TasksViewDraftDialog";
import { TasksViewEmpty } from "./TasksViewEmpty";
import { useFilteredTasks } from "./TasksViewFilter";
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
import { SummaryPanel, useDailySummaryPanel } from "./TaskSummaryPanel";

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
  const [projectFilter, setProjectFilter] = useState(() => initialTaskProjectScope(cwd));
  // A new project folder resets the scope, adjusted during render from the previous one.
  const [scopeCwd, setScopeCwd] = useState(cwd);
  if (scopeCwd !== cwd) {
    setScopeCwd(cwd);
    setProjectFilter(initialTaskProjectScope(cwd));
  }
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
  const { error, setError, saving, acting, act, refresh, confirmDialog } = ops;
  // Background polls refresh silently; the spinner belongs to the first read and
  // to a refresh the user asked for.
  const [manualRefresh, setManualRefresh] = useState(false);
  const retryBoard = () => {
    if (board.pending || manualRefresh) return;
    setManualRefresh(true);
    void Promise.all([
      refreshQueries(true),
      ...(section === "sprints" || section === "reports" ? [sprintBoard.refresh()] : []),
    ])
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setManualRefresh(false));
  };
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
  const loading = board.pending && !board.hasTaskAnswer && !board.taskError;
  const refreshing = manualRefresh || loading;
  const [sessionPreview, setSessionPreview] = useState<BackgroundSessionTarget | null>(null);
  const [statusDetails, setStatusDetails] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkSelection, setBulkSelection] = useState(new Set<string>());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [listView, setListView] = useRetainedState(`${viewStateKey}:list`, true);
  const [searchQuery, setSearchQuery] = useRetainedState(`${viewStateKey}:search`, "");
  const [statusFilter, setStatusFilter] = useRetainedState(`${viewStateKey}:status`, "all");
  const [machineFilter, setMachineFilter] = useRetainedState(`${viewStateKey}:machine`, "all");
  const [section, setSection] = useRetainedState<"backlog" | "sprints" | "reports">(
    `${viewStateKey}:section`,
    "backlog",
  );
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
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);

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
  const sprintBoard = useSprintBoard(board.planningMachines, visibleTasks, sprintProjects);
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
  const summary = useDailySummaryPanel();
  // Summary, limits and stewards belong to the backlog: opening one (also from a
  // notification) goes there, so no other tab repeats them.
  const showBacklog = () => {
    setSection("backlog");
    setSprintFilter("");
  };
  useEffect(() => {
    if (summary.open) showBacklog();
  }, [summary.open]);
  useEffect(() => {
    if (stewards.open) showBacklog();
  }, [stewards.open]);
  useEffect(() => {
    if (limitsOpen) showBacklog();
  }, [limitsOpen]);
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
  const tasks = useFilteredTasks({
    visibleTasks,
    goalFilter,
    statusFilter,
    machineFilter,
    projectFilter,
    searchQuery,
    machines,
    sprintBoard,
    accessibleSprints,
    section,
    sprintFilter,
  });
  const activeFilterCount =
    Number(goalFilter !== ALL_GOALS) +
    Number(statusFilter !== "all") +
    Number(machineFilter !== "all") +
    Number(sprintFilter !== "");
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

  const { actOnTask, onMove, onTaskDrop, onSave, onDelete, onEdit, onSaveDetails } =
    useTaskMutations({
      ops,
      put: { task: putTask, tasks: putTasks, remove: removeTask },
      machines,
      visibleTasks,
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      openingSessionRequests.current.delete(key);
      setOpeningSessions(new Set(openingSessionRequests.current));
    }
  };

  const boardIndexes = useBoardIndexes(storedTasks, tasks, visibleTasks);
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

  // One answer for "no task is visible": unreadable board, filters hiding tasks, or truly none.
  const noMachineNotice = t(
    "No connected machine has a task board. Connect one, or update its {p0} Host.",
    { p0: PRODUCT_IDENTITY.displayName },
  );
  // The raw error and notice already live in the status control; do not repeat them here.
  const unreadable =
    storedTasks.length === 0
      ? board.taskError
        ? t("Tasks couldn’t be read. Retry, or open Connection issue for details.")
        : machines.length === 0
          ? t("Connect a machine with a task board to see tasks here.")
          : null
      : null;
  const narrowed =
    Boolean(searchQuery.trim()) ||
    activeFilterCount > 0 ||
    projectFilter !== "all" ||
    sprintFilter !== "";
  const resetTaskFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setMachineFilter("all");
    setGoalFilter(ALL_GOALS);
    setProjectFilter("all");
    setSprintFilter("");
  };
  const resetPopoverFilters = () => {
    setSprintFilter("");
    setGoalFilter(ALL_GOALS);
    setStatusFilter("all");
    setMachineFilter("all");
  };
  const hasTasks = visibleTasks.length > 0;
  // Nothing to run yet: only "what is this and how do I start" is shown.
  const showOnboarding = section === "backlog" && !loading && !hasTasks && !unreadable;
  const runningTasks = visibleTasks.filter((task) => taskColumn(task.status) === "running").length;
  const agentMinutesToday = limits.reduce((sum, entry) => sum + entry.usedMinutes, 0);
  const summaryLine = [
    t("{p0} tasks", { p0: tasks.length }),
    runningTasks > 0 ? t("{p0} running", { p0: runningTasks }) : "",
    limits.length > 0 && !board.limitErrors.length
      ? t("{p0} agent time today", { p0: formatAgentMinutes(agentMinutesToday) })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const retryPlanning = async (item: PlanningRecovery) => {
    if (retryingPlanning) return;
    setRetryingPlanning(item.id);
    try {
      if (item.task) await sprintBoard.plan(item.task, item.sprintId);
      else if (item.goal)
        await sprintBoard.setGoalContext(item.goal.environmentId, item.goal.goalId, item.sprintId);
      setPlanningRecovery((items) => items.filter((entry) => entry.id !== item.id));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRetryingPlanning(null);
    }
  };
  const toggleSelectMode = () => {
    setSelectMode((value) => !value);
    setBulkSelection(new Set());
  };
  const createDisabled = draft != null || goals.draft != null;
  const emptyTasks = (
    <TasksViewEmpty
      unreadable={unreadable}
      retrying={board.pending}
      hasVisibleTasks={visibleTasks.length > 0}
      narrowed={narrowed}
      onboarding={showOnboarding}
      createDisabled={createDisabled}
      onRetry={retryBoard}
      onReset={resetTaskFilters}
      onCreate={beginCreate}
      emptySprint={
        section === "sprints" &&
        Boolean(currentSprint) &&
        !searchQuery.trim() &&
        statusFilter === "all" &&
        machineFilter === "all" &&
        goalFilter === ALL_GOALS
      }
      onBacklog={() => {
        setSection("backlog");
        setSprintFilter("");
      }}
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
          {t(
            board.pending
              ? "Loading task…"
              : "This task is unavailable on its original machine and project.",
          )}
        </Alert>
      ) : null}
      <TaskToolbar
        section={section}
        showReports={accessibleSprints.length > 0 || section === "reports"}
        onSection={(value) => {
          setSection(value);
          if (value === "backlog") setSprintFilter("");
        }}
        onboarding={showOnboarding}
        projectOptions={projectScopeOptions({
          t,
          projectFilter,
          selectedProject,
          projectScopes,
          currentSprint,
          cwd,
        })}
        projectFilter={projectFilter}
        onProject={setProjectFilter}
        search={{ visible: hasTasks, value: searchQuery, onChange: setSearchQuery }}
        machineNotice={
          machines.length === 0 ? (loading ? t("Looking for machines…") : noMachineNotice) : null
        }
        view={{
          visible: !showOnboarding && (section === "backlog" || Boolean(currentSprint)),
          list: listView,
          onList: setListView,
        }}
        newReviewNotes={newReviewNotes}
        filters={{
          visible:
            !showOnboarding && (goalList.length > 0 || hasTasks || accessibleSprints.length > 0),
          values: {
            status: statusFilter,
            machine: machineFilter,
            goal: goalFilter,
            sprint: sprintFilter,
          },
          activeCount: activeFilterCount,
          machines,
          goals: goalList,
          sprints: accessibleSprints,
          onStatus: setStatusFilter,
          onMachine: setMachineFilter,
          onGoal: setGoalFilter,
          onSprint: selectSprint,
          onReset: resetPopoverFilters,
        }}
        select={{
          visible:
            (section === "backlog" || Boolean(currentSprint)) &&
            visibleTasks.length > 0 &&
            !selectMode,
          active: selectMode,
          disabled: bulkBusy,
          onToggle: toggleSelectMode,
        }}
        menu={{
          summaryOpen: summary.open,
          stewardsOpen: stewards.open,
          limitsOpen,
          showStewards: stewardCapable.length > 0,
          showLimits: limits.length > 0 || board.limitErrors.length > 0,
          newGoalDisabled: goals.draft != null || draft != null,
          onPick: (id) => {
            if (id === "metrics") setMetricsOpen(true);
            if (id === "summary") summary.toggle();
            if (id === "stewards") stewards.toggle();
            if (id === "limits") setLimitsOpen((open) => !open);
            if (id === "goal") goals.begin();
          },
        }}
        status={{
          phase: boardDataState.phase,
          problem: Boolean(error || missingNotice || boardDataState.error),
          refreshing,
          retryable: Boolean(boardDataState.error),
          failed: Boolean(error),
          connectionIssue: Boolean(missingNotice || boardDataState.error),
          onDetails: () => setStatusDetails(true),
          onRefresh: retryBoard,
        }}
        create={{
          visible: !showOnboarding && (section === "backlog" || Boolean(currentSprint)),
          disabled: createDisabled,
          onCreate: beginCreate,
        }}
      />
      <TasksViewRecovery
        items={planningRecovery}
        retrying={retryingPlanning}
        onRetry={(item) => void retryPlanning(item)}
      />
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
          />
        </div>
      ) : null}
      {selectMode ? (
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
      {statusDetails ? (
        <TaskBoardStatusDialog
          missingNotice={missingNotice}
          error={error || boardDataState.error}
          updatedAt={boardDataState.updatedAt}
          hostStopped={localHost === "stopped"}
          onClose={() => setStatusDetails(false)}
          onRetry={retryBoard}
          onStartError={(message) => setError(message ?? null)}
        />
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
        <Alert tone="warning" className="mx-3 mt-3 shrink-0">
          {dailyNotice}
        </Alert>
      ) : null}
      {section === "backlog" && summary.open ? (
        <SummaryPanel
          summary={summary.summary}
          busy={summary.busy}
          error={summary.error}
          onRefresh={() => void summary.refresh()}
          onOpenTask={setSelectedKey}
        />
      ) : null}
      {section === "backlog" && limitsOpen ? (
        <Text as="p" size="caption" tone="secondary">
          {t("Unattended work limits are managed in Models.")}{" "}
          <Button variant="link" onClick={() => openModelsSettings("order")}>
            {t("Manage models")}
          </Button>
        </Text>
      ) : null}
      {draft ? (
        <TasksViewDraftDialog
          draft={draft}
          recents={recents}
          machines={machines}
          todoCapable={todoCapable}
          saving={saving}
          error={error}
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
            void refresh();
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
          error={error}
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
      {(section === "backlog" || (section === "sprints" && currentSprint)) &&
      goalList.length > 0 ? (
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
      {(section === "backlog" || (section === "sprints" && currentSprint)) &&
      hasTasks &&
      !loading ? (
        <p className="task-board-summary">
          <Text size="caption" tone="secondary" leading="inherit" className="task-scope-summary">
            {summaryLine}
          </Text>
        </p>
      ) : null}
      <div
        className={`@container/task-area min-h-0 min-w-0 flex-1 ${section === "reports" || (section === "sprints" && !currentSprint) ? "hidden" : "flex"}`}
      >
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
                stateKey={`${viewStateKey}:list:${projectFilter}:${sprintFilter}:${section}:${statusFilter}`}
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
              emptyTasks
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
    </Text>
  );
}
