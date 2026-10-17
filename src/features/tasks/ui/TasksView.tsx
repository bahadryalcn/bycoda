import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Popover } from "../../../shared/ui/Popover";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { NumberField } from "../../../shared/ui/NumberField";
import { useTaskBoardQueries } from "../model/useTaskBoardQueries";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { projectDisplayName } from "../../projects/model/projectNames";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TaskWorkspacePicker } from "./TaskWorkspacePicker";
import { startTask, retargetTask, reorderTasks } from "../model/taskClient";
import type { TaskWorkspace } from "../model/taskWorkspace";
import { taskColumn } from "../model/hostTasks";
import "./tasks.css";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import {
  invalidateMachineSnapshot,
  machineProjects,
} from "../../automations/model/machineSnapshot";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  useCallback,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  MoreHorizontal,
  ListFilter,
  CircleHelp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  DashboardSquare,
  Gauge,
  GitBranch,
  GitMerge,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import {
  AUTOMATION_WEEKDAYS,
  automationScheduleLabel,
  nextRunPreview,
} from "../../automations/model/automations";
import { RUNTIME_MODE_LABEL } from "../../sessions/model/session";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { TaskReviewNotes } from "./TaskReviewNotes";
import { TaskAttemptHistory, repairStopLabel } from "./TaskAttemptHistory";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { backgroundMachineFor, hostProjectCwd } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { RemoteDataStatus } from "../../connections/ui/RemoteDataStatus";
import { LocalHostStartButton } from "../../connections/ui/LocalHostDownNotice";
import { useLocalHostState } from "../../connections/model/localHostService";
import type { RemoteDataState } from "../../connections/model/remoteDataState";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import {
  DAILY_SUMMARY_OPEN_EVENT,
  DAILY_SUMMARY_STORED_EVENT,
  gatherDailySummary,
  loadStoredDailySummary,
  takeSummaryPanelRequest,
} from "../model/dailySummaryClient";
import type { DailySummary, SummaryTask } from "../model/dailySummary";
import { IS_MAC } from "../../../platform/tauri/platform";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import { projectKey } from "../../../shared/lib/paths";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";
import {
  EMPTY_PROMPT_ERROR,
  TASK_COLUMNS,
  canEditTask,
  canMoveTask,
  canTakeOverBlockedTask,
  taskRequiresInstructions,
  hasUnmergedBranch,
  unfinishedDependencies,
  type TaskColumn,
  type TaskStatus,
  type TaskVerification,
} from "../model/hostTasks";
import { taskInstructionsMarkdown, taskInstructionsSummary } from "../model/taskInstructions";
import {
  MAX_GOAL_PROJECTS,
  goalProgress,
  type GoalStatus,
  type GoalSettings,
} from "../model/hostGoals";
import {
  approveGoal,
  cancelGoal,
  createGoal,
  deleteGoal,
  goalKey,
  newGoalDraft,
  replanGoal,
  updateGoal,
  toggleGoalProject,
  type BoardGoal,
  type GoalDraft,
} from "../model/goalClient";
import {
  TASK_MACHINE_ERROR,
  deleteTask,
  draftFromTask,
  moveTask,
  recheckTaskReview,
  readTaskNotes,
  resolveTaskNote,
  newTaskDraft,
  saveTask,
  formatTaskSpan,
  taskTimeLabel,
  tasksInColumn,
  todoUnsupportedMessage,
  type BoardTask,
  type TaskDraft,
} from "../model/taskClient";
import { MAX_OPEN_LIMIT, MAX_PROPOSALS_LIMIT } from "../model/hostStewards";
import {
  STEWARD_STATUS_LABELS,
  declineProposal,
  deleteSteward,
  draftFromSteward,
  isStewardProposal,
  newStewardDraft,
  runStewardNow,
  saveSteward,
  setStewardEnabled,
  stewardProjectName,
  type BoardSteward,
  type StewardDraft,
} from "../model/stewardClient";
import {
  DAILY_LIMIT_CHOICES,
  MAX_RUNNING_TASKS_LIMIT,
  formatAgentMinutes,
  type HostSettings,
} from "../model/hostSettings";
import { dailyLimitNotice, saveMachineLimits, type MachineLimits } from "../model/settingsClient";
import {
  taskBackgroundSessionTarget,
  taskSessionIds,
  type BackgroundSessionTarget,
} from "../model/backgroundSession";

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

const COLUMN_LABELS: Record<TaskColumn, string> = {
  todo: "To do",
  queued: "Queued",
  running: "Running",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

const COLUMN_EMPTY: Record<TaskColumn, string> = {
  todo: "Nothing to do yet",
  queued: "Nothing waiting",
  running: "Nothing running",
  review: "Nothing to review",
  done: "Nothing done yet",
  blocked: "Nothing blocked",
};

// The same choices as an automation's run time limit.
const RUN_TIME_LIMIT_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("No limit");
    },
  },
  {
    value: "15",
    get label() {
      return t("15 minutes");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "60",
    get label() {
      return t("1 hour");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "240",
    get label() {
      return t("4 hours");
    },
  },
  {
    value: "480",
    get label() {
      return t("8 hours");
    },
  },
] as const;

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  planning: "Planning",
  "awaiting-approval": "Plan ready",
  running: "Running",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const GOAL_STATUS_TONES: Record<GoalStatus, BadgeTone> = {
  planning: "info",
  "awaiting-approval": "warning",
  running: "info",
  done: "success",
  blocked: "danger",
  cancelled: "neutral",
};

const ALL_GOALS = "all";

function upsertBoardItem<T extends { machineId: string; id: string }>(current: T[], saved: T): T[] {
  return [
    ...current.filter((item) => item.machineId !== saved.machineId || item.id !== saved.id),
    saved,
  ];
}

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
  useLocale();
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
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <DashboardSquare
              className="size-3.5 shrink-0 text-(--ui-text-secondary)"
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
  const lock = useLockSnapshot();
  // Machines whose host keeps a task board, this computer's included.
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  // Machines whose tasks are missing: offline, or with an older host.
  const [missingNotice, setMissingNotice] = useState<string | null>(null);
  const localHost = useLocalHostState();
  // The ones whose host also keeps manual to-do items.
  const [todoCapable, setTodoCapable] = useState<RemoteMachine[]>([]);
  const [storedTasks, setTasks] = useState<BoardTask[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [boardDataState, setBoardDataState] = useState<RemoteDataState>({
    phase: "loading",
  });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [deliveryTask, setDeliveryTask] = useState<BoardTask | null>(null);
  const [deliveryWorkspace, setDeliveryWorkspace] = useState<TaskWorkspace>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryValid, setDeliveryValid] = useState(true);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<TaskColumn | null>(null);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const openingSessionRequests = useRef(new Set<string>());
  const [openingSessions, setOpeningSessions] = useState(new Set<string>());
  const [groupLabels] = useState(loadTabGroupLabels);
  const boardLock = useLockOverscroll<HTMLDivElement>();
  // Machines whose host carries out goals, and their goals.
  const [goalCapable, setGoalCapable] = useState<RemoteMachine[]>([]);
  const [storedGoals, setGoals] = useState<BoardGoal[]>([]);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [editingGoal, setEditingGoal] = useState<BoardGoal | null>(null);
  const [goalSettingsError, setGoalSettingsError] = useState<string | null>(null);
  const [goalFilter, setGoalFilter] = useState(ALL_GOALS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [boardActionMenu, setBoardActionMenu] = useState<HTMLElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  const [goalSessions, setGoalSessions] = useState<BoardGoal | null>(null);
  // Machines whose host runs project stewards, and their stewards.
  const [stewardCapable, setStewardCapable] = useState<RemoteMachine[]>([]);
  const [storedStewards, setStewards] = useState<BoardSteward[]>([]);
  const [stewardDraft, setStewardDraft] = useState<StewardDraft | null>(null);
  const [stewardsOpen, setStewardsOpen] = useState(false);
  // Machines whose host keeps work limits, and what each reports.
  const [limitCapable, setLimitCapable] = useState<RemoteMachine[]>([]);
  const [limits, setLimits] = useState<MachineLimits[]>([]);
  const [limitsOpen, setLimitsOpen] = useState(false);
  // The daily summary: the last one sent, or a fresh one built on request.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [storedSummary, setStoredSummary] = useState(loadStoredDailySummary);
  const [freshSummary, setFreshSummary] = useState<DailySummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const visibleTasks = useMemo(
    () => storedTasks.filter((task) => !isProjectLockedIn(lock, task.cwd)),
    [lock, storedTasks],
  );
  const goals = useMemo(
    () =>
      storedGoals.filter(
        (goal) => !goal.projects.some((project) => isProjectLockedIn(lock, project.cwd)),
      ),
    [lock, storedGoals],
  );
  const stewards = useMemo(
    () => storedStewards.filter((steward) => !isProjectLockedIn(lock, steward.cwd)),
    [lock, storedStewards],
  );
  const dailyNotice = useMemo(() => dailyLimitNotice(limits), [limits]);
  const goalTitles = useMemo(
    () => new Map(goals.map((goal) => [goalKey(goal.machineId, goal.id), goal.title])),
    [goals],
  );
  const tasks = useMemo(
    () =>
      goalFilter === ALL_GOALS
        ? visibleTasks
        : visibleTasks.filter(
            (task) => task.goalId && goalKey(task.machineId, task.goalId) === goalFilter,
          ),
    [goalFilter, visibleTasks],
  );
  const newReviewNotes = tasks.reduce(
    (count, task) => count + unreadReviewNotes(task.reviewNotes),
    0,
  );

  // A click on the summary notification opens the panel, also when the view
  // was not showing yet.
  useEffect(() => {
    const open = () => {
      if (takeSummaryPanelRequest()) setSummaryOpen(true);
    };
    const stored = () => setStoredSummary(loadStoredDailySummary());
    open();
    window.addEventListener(DAILY_SUMMARY_OPEN_EVENT, open);
    window.addEventListener(DAILY_SUMMARY_STORED_EVENT, stored);
    return () => {
      window.removeEventListener(DAILY_SUMMARY_OPEN_EVENT, open);
      window.removeEventListener(DAILY_SUMMARY_STORED_EVENT, stored);
    };
  }, []);
  const onRefreshSummary = async () => {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const at = Date.now();
      setFreshSummary(await gatherDailySummary(at - 24 * 60 * 60 * 1000, at));
    } catch (cause) {
      setSummaryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSummaryBusy(false);
    }
  };

  const { board, refresh: refreshQueries, putTask } = useTaskBoardQueries();
  const refresh = useCallback(() => refreshQueries(), [refreshQueries]);
  const retryBoard = () => void refreshQueries(true);
  const previousBoard = useRef<typeof board | null>(null);
  useEffect(() => {
    const previous = previousBoard.current;
    previousBoard.current = board;
    startTransition(() => {
      setMachines(board.machines);
      setTodoCapable(board.todoCapable);
      setGoalCapable(board.goalCapable);
      setStewardCapable(board.stewardCapable);
      setLimitCapable(board.limitCapable);
      if (previous?.tasks !== board.tasks) setTasks(board.tasks);
      if (previous?.goals !== board.goals) setGoals(board.goals);
      if (previous?.stewards !== board.stewards) setStewards(board.stewards);
      if (previous?.limits !== board.limits) setLimits(board.limits);
      setMissingNotice(board.notice);
      setLoading(board.pending && !board.hasTaskAnswer);
      setNow(Date.now());
      setBoardDataState((current) => {
        const updatedAt = board.hasTaskAnswer && !board.error ? Date.now() : current.updatedAt;
        return {
          updatedAt,
          error: board.error,
          phase: board.error
            ? updatedAt
              ? "stale"
              : "error"
            : board.pending
              ? updatedAt
                ? "refreshing"
                : "loading"
              : board.machines.length
                ? "ready"
                : "empty",
        };
      });
    });
  }, [board]);

  const beginCreate = () => {
    const project =
      cwd && looksLikeProject(cwd) && !parseRemotePath(cwd) && !isProjectLockedIn(lock, cwd)
        ? cwd
        : (recents.find(
            (entry) =>
              looksLikeProject(entry.path) &&
              !parseRemotePath(entry.path) &&
              !isProjectLockedIn(lock, entry.path),
          )?.path ?? "~");
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    setDraft(newTaskDraft(project, harness, model));
  };

  const beginGoal = () => {
    const project =
      cwd && looksLikeProject(cwd) && !parseRemotePath(cwd) && !isProjectLockedIn(lock, cwd)
        ? cwd
        : (recents.find(
            (entry) =>
              looksLikeProject(entry.path) &&
              !parseRemotePath(entry.path) &&
              !isProjectLockedIn(lock, entry.path),
          )?.path ?? "");
    const preferred = defaultSessionChoice(project || "~");
    const harness = firstEnabledHarness(project || "~", preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    const draft = newGoalDraft(project, harness, model);
    setGoalDraft(looksLikeProject(project) ? draft : { ...draft, cwds: [], leadCwd: "" });
  };

  const onCreateGoal = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !goalDraft) return;
    setSaving(true);
    try {
      const saved = await createGoal(goalCapable, goalDraft);
      setGoals((current) => upsertBoardItem(current, saved));
      setGoalDraft(null);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const beginSteward = () => {
    const project = cwd && looksLikeProject(cwd) ? cwd : (recents[0]?.path ?? "~");
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    setStewardDraft(newStewardDraft(project, harness, model));
  };

  const onSaveSteward = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !stewardDraft) return;
    setSaving(true);
    try {
      const saved = await saveSteward(stewardCapable, stewardDraft);
      setStewards((current) => upsertBoardItem(current, saved));
      setStewardDraft(null);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const actOnSteward = (steward: BoardSteward, action: () => Promise<BoardSteward>) =>
    act({ id: `steward:${steward.machineId}:${steward.id}` }, action, (saved) =>
      setStewards((current) => upsertBoardItem(current, saved)),
    );

  const onDeleteSteward = (steward: BoardSteward) => {
    if (
      !window.confirm(
        `Delete the steward for ${stewardProjectName(steward)}? Its suggestions stay on the board.`,
      )
    )
      return;
    void act(
      { id: `steward:${steward.machineId}:${steward.id}` },
      () => deleteSteward(steward),
      () =>
        setStewards((current) =>
          current.filter((item) => item.machineId !== steward.machineId || item.id !== steward.id),
        ),
    );
  };

  const onChangeLimits = async (machineId: string, settings: Partial<HostSettings>) => {
    const machine = limitCapable.find((entry) => entry.id === machineId);
    if (!machine) return;
    try {
      const saved = await saveMachineLimits(machine, settings);
      setLimits((current) =>
        current.map((entry) => (entry.machineId === machineId ? saved : entry)),
      );
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const actOnGoal = (goal: BoardGoal, action: () => Promise<BoardGoal>) =>
    act({ id: `goal:${goalKey(goal.machineId, goal.id)}` }, action, (saved) =>
      setGoals((current) => upsertBoardItem(current, saved)),
    );

  const onDeleteGoal = (goal: BoardGoal) => {
    if (!window.confirm(`Delete the goal “${goal.title}”? Its tasks stay on the board.`)) return;
    if (goalFilter === goalKey(goal.machineId, goal.id)) setGoalFilter(ALL_GOALS);
    void act(
      { id: `goal:${goalKey(goal.machineId, goal.id)}` },
      () => deleteGoal(goal),
      () =>
        setGoals((current) =>
          current.filter((item) => item.machineId !== goal.machineId || item.id !== goal.id),
        ),
    );
  };

  const onOpenPlanner = async (goal: BoardGoal) => {
    const lead = goal.projects.find((project) => project.id === goal.leadProjectId);
    if (!goal.plannerSessionId || !lead) return;
    try {
      await onOpenBackgroundSession({
        machineId: goal.machineId,
        cwd: lead.cwd,
        projectId: lead.id,
        sessionId: goal.plannerSessionId,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const act = async <T,>(
    task: Pick<BoardTask, "id">,
    action: () => Promise<T>,
    commit?: (saved: T) => void,
  ) => {
    if (acting) return;
    setActing(task.id);
    try {
      const saved = await action();
      commit?.(saved);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // A merge that failed is recorded on its task, which stays in review.
      void refresh();
    } finally {
      setActing(null);
    }
  };

  const actOnTask = (task: BoardTask, action: () => Promise<BoardTask>) =>
    act(task, action, (saved) => {
      putTask(saved);
      setTasks((current) => upsertBoardItem(current, saved));
    });

  const onOpenSession = async (task: BoardTask, sessionId: string) => {
    const key = JSON.stringify([task.machineId, sessionId]);
    if (openingSessionRequests.current.has(key)) return;
    openingSessionRequests.current.add(key);
    setOpeningSessions(new Set(openingSessionRequests.current));
    try {
      await onOpenBackgroundSession(taskBackgroundSessionTarget(task, sessionId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      openingSessionRequests.current.delete(key);
      setOpeningSessions(new Set(openingSessionRequests.current));
    }
  };

  const onMove = (task: BoardTask, to: TaskStatus) => {
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
    setDraggedKey(null);
    setDropColumn(null);
    if (taskColumn(task.status) !== column) {
      if (!canMoveTask(task.status, column)) return;
      if (
        (column === "blocked" ||
          (column === "done" && hasUnmergedBranch(task)) ||
          (task.status === "review" && column === "queued")) &&
        !window.confirm(t("Move this task to {p0}?", { p0: t(COLUMN_LABELS[column]) }))
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
    await act(
      task,
      () => reorderTasks(ordered),
      (saved) =>
        setTasks((current) => saved.reduce((items, item) => upsertBoardItem(items, item), current)),
    );
  };

  /** `queued` starts a new task right away; `save` keeps an edited task's status. */
  const onSave = async (mode: "todo" | "queued" | "save") => {
    if (saving || !draft) return;
    setSaving(true);
    try {
      let saved = await saveTask(machines, draft, mode === "todo" ? "todo" : "queued");
      if (mode === "queued" && saved.workspaceControlsSupported) saved = await startTask(saved);
      putTask(saved);
      setTasks((current) => upsertBoardItem(current, saved));
      setDraft(null);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (task: BoardTask) => {
    const discard = hasUnmergedBranch(task);
    if (
      !window.confirm(
        discard
          ? `Delete “${task.title}”? Its work on ${task.branch} was never merged, and the branch will be discarded.`
          : `Delete “${task.title}”?`,
      )
    )
      return;
    void act(
      task,
      () => deleteTask(task, discard),
      () =>
        setTasks((current) =>
          current.filter((item) => item.machineId !== task.machineId || item.id !== task.id),
        ),
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
      setTasks((current) => upsertBoardItem(current, saved));
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
      busy: acting === task.id,
      onRecheckReview: () => void actOnTask(task, () => recheckTaskReview(task)),
      onMove: (to: TaskStatus) => onMove(task, to),
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
          () =>
            setTasks((current) =>
              current.filter((item) => item.machineId !== task.machineId || item.id !== task.id),
            ),
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
    ? visibleTasks.find((task) => `${task.machineId}:${task.id}` === selectedKey)
    : undefined;
  // A task that is gone from the board takes its panel with it.
  useEffect(() => {
    if (selectedKey && !loading && !selected) setSelectedKey(null);
  }, [loading, selected, selectedKey]);

  return (
    <div className="bycoda-tasks flex min-h-0 min-w-0 flex-1 flex-col text-(--ui-tone-neutral-fg)">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3">
        <h1 className="min-w-0 flex-1 text-[13px] font-medium">{t("Tasks")}</h1>
        <Badge className="tabular-nums">{visibleTasks.length}</Badge>
        <Button
          ref={helpTrigger}
          variant="ghost"
          iconOnly
          label={t("Help")}
          tooltip={t("Help")}
          aria-haspopup="dialog"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          <CircleHelp className="size-3.5" />
        </Button>
        {helpOpen ? (
          <Popover
            anchor={helpTrigger}
            align="end"
            width={280}
            onDismiss={(reason) => {
              setHelpOpen(false);
              if (reason === "escape") helpTrigger.current?.focus();
            }}
          >
            <p className="task-filter-popover text-(--ui-text-secondary)">
              {t("Each task runs on its project’s machine, with this app open or closed.")}
            </p>
          </Popover>
        ) : null}
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2">
        {machines.length === 0 ? (
          <span className="min-w-[min(100%,14rem)] flex-1 text-[12px] text-(--ui-text-secondary)">
            {loading
              ? t("Looking for machines…")
              : t("No connected machine has a task board. Connect one, or update its {p0} Host.", {
                  p0: PRODUCT_IDENTITY.displayName,
                })}
          </span>
        ) : null}
        {newReviewNotes > 0 ? (
          <span data-new-review-notes className="shrink-0 text-[11px] text-(--ui-tone-warning-fg)">
            {newReviewNotes}
            {t(" new review ")}
            {newReviewNotes === 1 ? t("note") : t("notes")}
          </span>
        ) : null}
        {goals.length > 0 ? (
          <>
            <Button
              ref={filterTrigger}
              variant="ghost"
              iconOnly
              label={t("Filters")}
              tooltip={t("Filters")}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              selected={goalFilter !== ALL_GOALS}
              aria-pressed={goalFilter !== ALL_GOALS}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter className="size-3.5" />
              {goalFilter !== ALL_GOALS ? (
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
                  <SearchableSelect
                    variant="pill"
                    align="end"
                    label={t("Show goal")}
                    value={goalFilter}
                    options={[
                      {
                        value: ALL_GOALS,
                        get label() {
                          return t("All tasks");
                        },
                      },
                      ...goals.map((goal) => ({
                        value: goalKey(goal.machineId, goal.id),
                        label: goal.title,
                      })),
                    ]}
                    onChange={setGoalFilter}
                  />
                  <Button
                    variant="ghost"
                    disabled={goalFilter === ALL_GOALS}
                    onClick={() => setGoalFilter(ALL_GOALS)}
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
          size="sm"
          iconOnly
          label={t("More actions")}
          aria-haspopup="menu"
          aria-expanded={!!boardActionMenu}
          onClick={(event) => setBoardActionMenu(event.currentTarget)}
        >
          <MoreHorizontal className="size-3.5" />
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
                checked: summaryOpen,
                icon: <Check className="size-3.5" />,
              },
              ...(stewardCapable.length > 0
                ? [
                    {
                      kind: "item" as const,
                      id: "stewards",
                      label: t("Stewards"),
                      checked: stewardsOpen,
                      icon: <Bot className="size-3.5" />,
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
                      icon: <Gauge className="size-3.5" />,
                    },
                  ]
                : []),
              {
                kind: "item",
                id: "goal",
                label: t("New goal"),
                disabled: goalDraft != null || draft != null,
                icon: <Sparkles className="size-3.5" />,
              },
            ]}
            onClose={() => setBoardActionMenu(null)}
            onPick={(id) => {
              if (id === "summary") setSummaryOpen((open) => !open);
              if (id === "stewards") setStewardsOpen((open) => !open);
              if (id === "limits") setLimitsOpen((open) => !open);
              if (id === "goal") beginGoal();
            }}
          />
        ) : null}
        <Button
          variant="secondary"
          type="button"
          onClick={beginCreate}
          disabled={draft != null || goalDraft != null}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          {t("New task")}
        </Button>
      </div>
      <RemoteDataStatus
        state={boardDataState}
        onRefresh={retryBoard}
        label={t("task board")}
        connectionIssueHandled={!!missingNotice}
      />
      {error ? (
        <Alert tone="danger" className="mx-4 mt-4 shrink-0">
          {error}
        </Alert>
      ) : null}
      {missingNotice ? (
        <Alert
          tone={boardDataState.error ? "warning" : "info"}
          role="status"
          aria-busy={board.pending}
          className="mx-3 mbs-3 shrink-0"
          data-remote-data-state={boardDataState.phase}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <span>{missingNotice}</span>
              {boardDataState.error ? (
                <p className="mbs-1 break-words text-(--ui-text-muted)">{boardDataState.error}</p>
              ) : null}
              {boardDataState.updatedAt ? (
                <span className="ms-1 text-(--ui-text-muted)">
                  {t("Last verified {p0}", {
                    p0: new Date(boardDataState.updatedAt).toLocaleString(getLocale()),
                  })}
                </span>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={retryBoard}
              loading={board.pending}
              disabled={board.pending}
            >
              <RefreshCw className="size-3.5" />
              {t("Retry")}
            </Button>
            {localHost === "stopped" ? (
              <LocalHostStartButton
                className="-my-1 shrink-0"
                onStarted={retryBoard}
                onError={(message) => setError(message ?? null)}
              />
            ) : null}
          </div>
        </Alert>
      ) : null}
      {dailyNotice ? (
        <Alert tone="warning" role="status" className="mx-4 mt-4 shrink-0">
          {dailyNotice}
        </Alert>
      ) : null}
      {summaryOpen ? (
        <SummaryPanel
          summary={freshSummary ?? storedSummary}
          busy={summaryBusy}
          error={summaryError}
          onRefresh={() => void onRefreshSummary()}
          onOpenTask={setSelectedKey}
        />
      ) : null}
      {limitsOpen && limits.length > 0 ? (
        <LimitsPanel limits={limits} onChange={onChangeLimits} />
      ) : null}
      {draft ? (
        <Modal
          title={draft.id ? t("Edit task") : t("New task")}
          size="lg"
          onClose={() => {
            if (!saving) setDraft(null);
          }}
        >
          {error ? (
            <Alert tone="danger" role="alert" className="">
              {error}
            </Alert>
          ) : null}
          <TaskForm
            key={draft.id ?? "new"}
            draft={draft}
            recents={recents}
            machines={machines}
            machine={machineName(machines, draft.cwd, draft.machineId)}
            todoUnsupported={todoUnsupportedMessage(machines, todoCapable, draft.cwd)}
            saving={saving}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSubmit={(mode) => void onSave(mode)}
            limits={limits}
            onChangeLimits={onChangeLimits}
          />
        </Modal>
      ) : null}
      {editingGoal ? (
        <Modal
          title={t("Edit goal settings")}
          onClose={() => {
            if (!saving) setEditingGoal(null);
          }}
        >
          <GoalSettingsForm
            goal={editingGoal}
            saving={saving}
            error={goalSettingsError}
            onCancel={() => setEditingGoal(null)}
            onSave={async (settings) => {
              if (saving) return;
              setSaving(true);
              setGoalSettingsError(null);
              try {
                const saved = await updateGoal(editingGoal, settings);
                setGoals((current) => upsertBoardItem(current, saved));
                setEditingGoal(null);
                void refresh();
              } catch (reason) {
                setGoalSettingsError(reason instanceof Error ? reason.message : String(reason));
                void refresh();
              } finally {
                setSaving(false);
              }
            }}
          />
        </Modal>
      ) : null}
      {goalDraft ? (
        <Modal
          title={t("New goal")}
          size="lg"
          onClose={() => {
            if (!saving) setGoalDraft(null);
          }}
        >
          {error ? (
            <Alert tone="danger" role="alert" className="">
              {error}
            </Alert>
          ) : null}
          <GoalForm
            draft={goalDraft}
            recents={recents}
            machines={goalCapable}
            machine={
              goalDraft.cwds[0]
                ? machineName(goalCapable, goalDraft.cwds[0], goalDraft.machineId)
                : undefined
            }
            saving={saving}
            onChange={setGoalDraft}
            onCancel={() => setGoalDraft(null)}
            onSubmit={onCreateGoal}
            limits={limits}
            onChangeLimits={onChangeLimits}
          />
        </Modal>
      ) : null}
      {deliveryTask ? (
        <Modal
          title={t("Choose delivery target")}
          size="lg"
          onClose={() => {
            if (!acting) setDeliveryTask(null);
          }}
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
              onValidityChange={setDeliveryValid}
            />
            <Button
              variant="primary"
              type="button"

              disabled={Boolean(acting) || deliveryBusy || !deliveryValid}
              onClick={() =>
                void act(
                  deliveryTask,
                  () => retargetTask(deliveryTask, deliveryWorkspace),
                  (saved) => {
                    putTask(saved);
                    setTasks((current) => upsertBoardItem(current, saved));
                    setDeliveryTask(null);
                  },
                )
              }
            >
              {t("Save delivery target")}
            </Button>
          </div>
        </Modal>
      ) : null}
      {stewardsOpen && stewardCapable.length > 0 ? (
        <StewardsPanel
          stewards={stewards}
          draft={stewardDraft}
          recents={recents}
          machine={stewardDraft ? machineName(stewardCapable, stewardDraft.cwd) : undefined}
          saving={saving}
          acting={acting}
          now={now}
          onAdd={beginSteward}
          onEdit={(steward) => {
            setError(null);
            setStewardDraft(draftFromSteward(steward));
          }}
          onChange={setStewardDraft}
          onCancel={() => setStewardDraft(null)}
          onSubmit={onSaveSteward}
          onToggle={(steward) =>
            void actOnSteward(steward, () => setStewardEnabled(steward, !steward.enabled))
          }
          onRunNow={(steward) => void actOnSteward(steward, () => runStewardNow(steward))}
          onDelete={onDeleteSteward}
        />
      ) : null}
      {goals.length > 0 ? (
        <ul
          aria-label={t("Goals")}
          className="flex max-h-[45%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-(--ui-tone-neutral-border) p-3"
        >
          {goals
            .filter(
              (goal) => goalFilter === ALL_GOALS || goalKey(goal.machineId, goal.id) === goalFilter,
            )
            .map((goal) => {
              const key = goalKey(goal.machineId, goal.id);
              return (
                <li key={key}>
                  <GoalCard
                    goal={goal}
                    tasks={storedTasks.filter((task) => task.machineId === goal.machineId)}
                    busy={acting === `goal:${key}`}
                    onApprove={() => void actOnGoal(goal, () => approveGoal(goal))}
                    onEdit={() => {
                      setGoalSettingsError(null);
                      setEditingGoal(goal);
                    }}
                    onReplan={(feedback) => actOnGoal(goal, () => replanGoal(goal, feedback))}
                    onCancel={() => {
                      if (
                        window.confirm(
                          `Cancel the goal “${goal.title}”? Its running tasks are stopped; their branches stay.`,
                        )
                      )
                        void actOnGoal(goal, () => cancelGoal(goal));
                    }}
                    onDelete={() => onDeleteGoal(goal)}
                    onSessions={() => setGoalSessions(goal)}
                    onOpenPlanner={
                      goal.plannerSessionId ? () => void onOpenPlanner(goal) : undefined
                    }
                  />
                </li>
              );
            })}
        </ul>
      ) : null}
      <div className="@container/task-area flex min-h-0 min-w-0 flex-1">
        {goalSessions ? (
          <Modal title={t("Task sessions")} size="lg" onClose={() => setGoalSessions(null)}>
            <div className="grid gap-3 p-4">
              <p>{goalSessions.title}</p>
              {visibleTasks
                .filter(
                  (task) =>
                    task.machineId === goalSessions.machineId && task.goalId === goalSessions.id,
                )
                .map((task) => {
                  const sessions = taskSessionIds(task);
                  return (
                    <div
                      key={task.id}
                      className="grid gap-1 rounded-md border border-(--ui-tone-neutral-border) p-3"
                    >
                      <strong>{task.title}</strong>
                      <span>{t(STATUS_LABELS[task.status])}</span>
                      <span className="break-all text-[11px]">
                        {task.branch} {task.worktreeCwd ?? task.workspace?.checkoutCwd ?? task.cwd}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {sessions.worker ? (
                          <Button
                            variant="secondary"
                            type="button"

                            onClick={() => {
                              setGoalSessions(null);
                              void onOpenSession(task, sessions.worker!);
                            }}
                          >
                            {t("Open worker session")}
                          </Button>
                        ) : (
                          <span>{t("Session will appear when this task starts.")}</span>
                        )}
                        {sessions.review ? (
                          <Button
                            variant="secondary"
                            type="button"

                            onClick={() => {
                              setGoalSessions(null);
                              void onOpenSession(task, sessions.review!);
                            }}
                          >
                            {t("Open review session")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>
          </Modal>
        ) : null}
        <div
          ref={boardLock}
          className="min-h-0 min-w-0 flex-1 overflow-x-scroll overflow-y-auto overscroll-none p-3 [scrollbar-gutter:stable] @max-[640px]/task-area:has-[+aside]:hidden"
        >
          {loading ? (
            <div className="grid h-full place-items-center text-(--ui-text-secondary)">
              <LoaderCircle className="size-4 animate-spin" />
            </div>
          ) : (
            <div className="grid h-full grid-cols-[repeat(6,minmax(10rem,1fr))] gap-3">
              {TASK_COLUMNS.map((status) => {
                const column = boardIndexes.columns.get(status)!;
                return (
                  <section
                    key={status}
                    aria-label={t(COLUMN_LABELS[status])}
                    data-task-column={status}
                    data-drop-active={dropColumn === status || undefined}
                    onDragOver={(event) => {
                      const dragged = visibleTasks.find(
                        (task) => `${task.machineId}:${task.id}` === draggedKey,
                      );
                      if (
                        dragged &&
                        ((taskColumn(dragged.status) === status &&
                          dragged.workspaceControlsSupported &&
                          (status === "todo" || status === "queued")) ||
                          canMoveTask(dragged.status, status))
                      ) {
                        event.preventDefault();
                        setDropColumn(status);
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node))
                        setDropColumn(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const dragged = visibleTasks.find(
                        (task) => `${task.machineId}:${task.id}` === draggedKey,
                      );
                      if (dragged) void onTaskDrop(dragged, status);
                    }}
                    className="bycoda-task-column flex min-h-0 min-w-0 flex-col rounded-md bg-(--ui-surface-raised)"
                  >
                    <h2 className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] font-medium text-(--ui-text-secondary)">
                      <span className="min-w-0 flex-1 truncate">{t(COLUMN_LABELS[status])}</span>
                      <Badge className="shrink-0 tabular-nums">{column.length}</Badge>
                    </h2>
                    <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
                      {column.map((task) => (
                        <li
                          key={`${task.machineId}:${task.id}`}
                          draggable={!acting && !task.stale}
                          onDragStart={(event) => {
                            if ((event.target as Element).closest("button,input,textarea,select")) {
                              event.preventDefault();
                              return;
                            }
                            const key = `${task.machineId}:${task.id}`;
                            event.dataTransfer.setData("application/x-bycoda-task", key);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggedKey(key);
                          }}
                          onDragEnd={() => {
                            setDraggedKey(null);
                            setDropColumn(null);
                          }}
                          onDrop={(event) => {
                            const dragged = visibleTasks.find(
                              (item) => `${item.machineId}:${item.id}` === draggedKey,
                            );
                            if (dragged && taskColumn(dragged.status) === status) {
                              event.preventDefault();
                              event.stopPropagation();
                              void onTaskDrop(dragged, status, task);
                            }
                          }}
                        >
                          <TaskCard
                            task={task}
                            now={now}
                            project={taskContext(task).project}
                            goal={taskContext(task).goal}
                            waitingForText={JSON.stringify(taskContext(task).waitingFor)}
                            actionsFor={cardActions}
                            busy={acting === task.id}
                            openingState={JSON.stringify(
                              [taskSessionIds(task).worker, taskSessionIds(task).review].map(
                                (id) =>
                                  !!id && openingSessions.has(JSON.stringify([task.machineId, id])),
                              ),
                            )}
                            orderKey={boardIndexes.orders.get(task.machineId + ":" + task.id) ?? ""}
                            selected={task.machineId + ":" + task.id === selectedKey}
                            onOpen={openCard}
                          />
                        </li>
                      ))}
                      {column.length === 0 ? (
                        <li>
                          <EmptyState description={t(COLUMN_EMPTY[status])} />
                        </li>
                      ) : null}
                    </ul>
                  </section>
                );
              })}
            </div>
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
          />
        ) : null}
      </div>
    </div>
  );
}

/** The machine that would run a task for the project at `cwd`, if connected. */
function machineName(
  machines: readonly RemoteMachine[],
  cwd: string,
  machineId?: string,
): string | undefined {
  const machine = backgroundMachineFor(machines, cwd);
  if (!machine || (machineId && machine.id !== machineId)) return undefined;
  return isLocalSyncMachine(machine) ? t("this computer") : machine.name;
}

const TaskCard = memo(function TaskCard({
  task,
  now,
  project,
  goal,
  waitingForText,
  selected,
  onOpen,
  actionsFor,
  busy,
  openingState,
  orderKey,
}: {
  task: BoardTask;
  now: number;
  project: string;
  goal?: string;
  waitingForText: string;
  selected: boolean;
  onOpen: (key: string) => void;
  actionsFor: (task: BoardTask) => TaskActionHandlers;
  busy: boolean;
  openingState: string;
  orderKey: string;
}) {
  void busy;
  void openingState;
  void orderKey;
  const waitingFor = useMemo<readonly string[]>(() => JSON.parse(waitingForText), [waitingForText]);
  return (
    <TaskCardBody
      task={task}
      now={now}
      project={project}
      goal={goal}
      waitingFor={waitingFor}
      selected={selected}
      onOpen={() => onOpen(task.machineId + ":" + task.id)}
      {...actionsFor(task)}
    />
  );
});

function TaskCardBody({
  task,
  now,
  project,
  goal,
  waitingFor,
  selected,
  onOpen,
  ...actions
}: {
  task: BoardTask;
  now: number;
  project: string;
  /** The title of the goal the task was planned for. */
  goal?: string;
  /** Titles of the tasks it waits for. */
  waitingFor: readonly string[];
  /** Its detail panel is open. */
  selected: boolean;
  onOpen: () => void;
} & TaskActionHandlers) {
  useLocale();
  const model = resolveModel(task.harness, task.model);
  const description = taskInstructionsSummary(task.prompt);
  const unread = unreadReviewNotes(task.reviewNotes);
  return (
    // A click anywhere on the card but its buttons opens the detail panel.
    <article
      aria-label={task.title}
      aria-current={selected || undefined}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onOpen();
      }}
      className={`cursor-pointer rounded-md border bg-(--ui-surface) px-2.5 py-2 hover:border-(--ui-tone-neutral-border) ${
        selected ? "border-(--ui-tone-neutral-border)" : "border-(--ui-tone-neutral-border)"
      }`}
    >
      {goal ? (
        <p
          data-task-goal
          title={t("Part of the goal “{p0}”", { p0: goal })}
          className="mb-1 flex min-w-0 items-center gap-1 text-[10px] text-(--ui-text-secondary)"
        >
          <Sparkles className="size-2.5 shrink-0" />
          <span className="min-w-0 truncate">{goal}</span>
        </p>
      ) : null}
      {task.source === "steward" ? (
        <Badge
          data-task-suggested
          title={t("Suggested by a project steward")}
          tone="info"
          className="mb-1"
        >
          <Bot className="size-2.5 shrink-0" />
          {t("Suggested")}
        </Badge>
      ) : null}
      <h3
        title={description}
        className="line-clamp-2 text-[13px] font-semibold leading-snug text-(--ui-tone-neutral-fg)"
      >
        {task.title}
      </h3>
      {description ? (
        <p
          data-task-description
          className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-[11px] leading-snug text-(--ui-text-secondary)"
        >
          {description}
        </p>
      ) : null}
      <p className="mt-1 truncate text-[11px] text-(--ui-text-secondary)">
        {project}
        {t(" · on ")}
        {task.machineName}
        {task.stale ? t(" (offline, last known)") : ""}
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-(--ui-text-secondary)">
        <HarnessIcon harness={task.harness} className="size-3.5 shrink-0" />
        <span title={model.name} className="min-w-0 truncate">
          {model.name}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-(--ui-text-secondary)">
          {taskTimeLabel(task, now)}
        </span>
      </p>
      {task.branch ? (
        <p
          title={task.merged ? t("Merged into {p0}", { p0: task.baseBranch }) : task.branch}
          className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-(--ui-text-secondary)"
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="min-w-0 truncate">
            {task.merged
              ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
              : task.branch}
          </span>
        </p>
      ) : null}
      {task.autoMerged ? (
        <Badge data-task-auto-merged tone="success" className="mt-1">
          {t("Merged automatically")}
        </Badge>
      ) : null}
      {waitingFor.length > 0 ? (
        <p className="mt-1 break-words text-[11px] leading-snug text-(--ui-text-secondary)">
          {t("Waiting for: ")}
          {waitingFor.join(", ")}
        </p>
      ) : null}
      {task.status === "verifying" ? (
        <Badge tone="info" className="mt-1.5 mr-1">
          {t("Verifying")}
        </Badge>
      ) : null}
      {task.needsInput || taskRequiresInstructions(task) ? (
        <Badge tone="warning" className="mt-1.5">
          {t("Needs input")}
        </Badge>
      ) : null}
      {task.repairAttempts ? (
        <p title={task.repairNote} className="mt-1.5 text-[11px] text-(--ui-tone-warning-fg)">
          {task.status === "blocked" ? t("Automatic corrections used") : t("Automatic correction")}
          {t(" · attempt ")}
          {task.repairAttempts}
        </p>
      ) : null}
      {repairStopLabel(task) ? (
        <p className="mt-1.5 text-[11px] text-(--ui-tone-warning-fg)">{repairStopLabel(task)}</p>
      ) : null}
      {task.reviewNotes?.length ? (
        <p
          data-task-review-notes
          className={`mt-1.5 text-[11px] ${unread ? "text-(--ui-tone-warning-fg)" : "text-(--ui-text-secondary)"}`}
        >
          {unread
            ? t(unread === 1 ? "{p0} new review note" : "{p0} new review notes", { p0: unread })
            : t(task.reviewNotes.length === 1 ? "{p0} review note" : "{p0} review notes", {
                p0: task.reviewNotes.length,
              })}
        </p>
      ) : null}
      {task.status === "blocked" && task.error ? (
        <p className="mt-1.5 line-clamp-4 break-words text-[11px] leading-snug text-(--ui-tone-danger-fg)">
          {task.error}
        </p>
      ) : null}
      {task.verification && (task.status === "review" || task.status === "blocked") ? (
        <VerificationSummary verification={task.verification} />
      ) : null}
      {task.status === "review" && task.diffStat ? (
        <pre
          aria-label={"Changes"}
          className="mt-1.5 max-h-32 overflow-auto rounded bg-(--ui-surface-raised) px-1.5 py-1 font-mono text-[10px] leading-snug text-(--ui-text-secondary)"
        >
          {task.diffStat}
        </pre>
      ) : null}
      {task.status === "review" && task.mergeError ? (
        <Alert tone="danger" role="alert" className="mt-1.5 break-words">
          {task.mergeError}
        </Alert>
      ) : null}
      {task.status === "review" ? (
        <p className="mbs-1 text-[11px] text-(--ui-tone-warning-fg)">
          {hasUnmergedBranch(task)
            ? task.mergeError
              ? t("Delivery is blocked")
              : task.autoMerge || task.deliveryRequested
                ? t("Waiting for automatic delivery")
                : t("Waiting for your merge approval")
            : t("Waiting for your approval")}
        </p>
      ) : null}
      <TaskActions task={task} {...actions} />
    </article>
  );
}

type TaskActionHandlers = {
  busy: boolean;
  onStart: () => void;
  onDelivery: () => void;
  onPauseMerge: () => void;
  onEarlier?: () => void;
  onLater?: () => void;
  onMove: (to: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Deletes a steward's to-do suggestion and keeps it from coming back. */
  onDecline: () => void;
  /** Missing while no current or retained worker session is known. */
  onOpenSession?: () => void;
  openingWorkerSession: boolean;
  onOpenReviewSession?: () => void;
  openingReviewSession: boolean;
  isOpeningSession: (sessionId: string) => boolean;
  onReadNotes: (noteIds: string[]) => void;
  onResolveNote: (noteId: string, resolved: boolean) => void;
  onOpenReview: (sessionId: string) => void;
  onRecheckReview: () => void;
};

/** What the owner can do with a task, as the card and the detail panel both
 * offer it. Clicks stay on the buttons rather than opening the panel. */
function TaskActions({
  task,
  busy,
  onStart,
  onDelivery,
  onPauseMerge,
  onEarlier,
  onLater,
  onMove,
  onEdit,
  onDelete,
  onDecline,
  onOpenSession,
  openingWorkerSession,
  onOpenReviewSession,
  openingReviewSession,
  onRecheckReview,
}: { task: BoardTask } & TaskActionHandlers) {
  useLocale();
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const can = (to: TaskStatus) => canMoveTask(task.status, to);
  type Action = {
    id: string;
    label: string;
    icon: ReactNode;
    run: () => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean;
  };
  const primary: Action[] = [],
    secondary: Action[] = [];
  if (onEarlier)
    primary.push({
      id: "earlier",
      label: t("Move earlier"),
      icon: <ChevronRight className="size-3" />,
      run: onEarlier,
      disabled: busy,
    });
  if (onLater)
    primary.push({
      id: "later",
      label: t("Move later"),
      icon: <ChevronDown className="size-3" />,
      run: onLater,
      disabled: busy,
    });
  if (task.status === "queued" && task.workspaceControlsSupported)
    primary.push({
      id: "start-now",
      label: t("Start now"),
      icon: <Play className="size-3" />,
      run: onStart,
      disabled: busy,
    });
  if (task.status === "review" && hasUnmergedBranch(task) && task.workspaceControlsSupported) {
    secondary.push({
      id: "delivery",
      label: t("Choose delivery target"),
      icon: <GitBranch className="size-3" />,
      run: onDelivery,
      disabled: busy,
    });
    if (task.autoMerge || task.deliveryRequested)
      secondary.push({
        id: "pause-merge",
        label: t("Pause automatic merge"),
        icon: <Square className="size-3" />,
        run: onPauseMerge,
        disabled: busy,
      });
  }
  if (can("done"))
    primary.push({
      id: "done",
      label: hasUnmergedBranch(task)
        ? t("Merge into {p0}", { p0: task.baseBranch })
        : task.status === "todo"
          ? t("Mark done")
          : t("Approve"),
      icon: hasUnmergedBranch(task) ? (
        <GitMerge className="size-3" />
      ) : (
        <Check className="size-3" />
      ),
      run: () => onMove("done"),
      disabled: busy,
    });
  if (can("queued") && !taskRequiresInstructions(task) && !canTakeOverBlockedTask(task))
    primary.push({
      id: "queued",
      label:
        task.status === "todo"
          ? t("Start")
          : task.status === "blocked"
            ? t("Retry")
            : t("Run again"),
      icon:
        task.status === "blocked" ? <RotateCcw className="size-3" /> : <Play className="size-3" />,
      run: () => onMove("queued"),
      disabled: busy,
    });
  if (
    task.status === "blocked" &&
    !taskRequiresInstructions(task) &&
    !canTakeOverBlockedTask(task) &&
    task.reviewRecheckSupported &&
    task.verification?.review?.verdict === "fail" &&
    task.sessionId
  )
    secondary.push({
      id: "recheck",
      label: t("Recheck review"),
      icon: <RefreshCw className="size-3" />,
      run: onRecheckReview,
      disabled: busy,
    });
  if (can("todo"))
    secondary.push({
      id: "todo",
      label: task.status === "done" ? t("Reopen") : t("Move to To do"),
      icon: <Undo2 className="size-3" />,
      run: () => onMove("todo"),
      disabled: busy,
    });
  if (can("blocked"))
    primary.push({
      id: "blocked",
      label: t("Stop"),
      icon: <Square className="size-3" />,
      run: () => onMove("blocked"),
      disabled: busy,
    });
  if (onOpenSession)
    primary.push({
      id: "worker",
      label: t("Open worker session"),
      icon: <MessageSquare className="size-3" />,
      run: onOpenSession,
      disabled: openingWorkerSession,
      loading: openingWorkerSession,
    });
  if (onOpenReviewSession)
    primary.push({
      id: "review",
      label: t("Open review session"),
      icon: <MessageSquare className="size-3" />,
      run: onOpenReviewSession,
      disabled: openingReviewSession,
      loading: openingReviewSession,
    });
  if (canEditTask(task.status))
    (taskRequiresInstructions(task) ? primary : secondary).push({
      id: "edit",
      label: taskRequiresInstructions(task) ? t("Update instructions") : t("Edit"),
      icon: <Pencil className="size-3" />,
      run: onEdit,
      disabled: busy,
    });
  if (isStewardProposal(task))
    secondary.push({
      id: "decline",
      label: t("Decline"),
      icon: <X className="size-3" />,
      run: onDecline,
      disabled: busy,
    });
  else if (task.status !== "running" && task.status !== "verifying")
    secondary.push({
      id: "delete",
      label: t("Delete"),
      icon: <Trash2 className="size-3" />,
      run: onDelete,
      disabled: busy,
      danger: true,
    });
  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {primary.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          disabled={action.disabled}
          loading={action.loading}
          onClick={action.run}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
      {secondary.length ? (
        <Button
          ref={trigger}
          variant="ghost"
          iconOnly
          label={t("More actions")}
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={busy}
          onClick={() => setMenu((open) => !open)}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      ) : null}
      {menu ? (
        <DropdownMenu
          anchor={trigger}
          label={t("More actions")}
          items={secondary.map(({ id, label, icon, disabled, danger }) => ({
            kind: "item" as const,
            id,
            label,
            icon,
            disabled,
            danger,
          }))}
          onClose={() => setMenu(false)}
          onPick={(id) => {
            const action = secondary.find((item) => item.id === id);
            if (action && !action.disabled) action.run();
          }}
        />
      ) : null}
    </div>
  );
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  queued: "Queued",
  running: "Running",
  verifying: "Verifying",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

function formatTime(at: number | undefined): string | undefined {
  return at ? new Date(at).toLocaleString(getLocale()) : undefined;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  useLocale();
  return (
    <div className="flex min-w-0 gap-2 text-[12px] leading-snug">
      <dt className="w-24 shrink-0 text-(--ui-text-secondary)">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-(--ui-text-secondary)">{children}</dd>
    </div>
  );
}

/** A task in full, beside the board: its description, where and how it runs,
 * and everything the host recorded about it. The title and description can be
 * edited in place while the task may be edited at all. */
function TaskDetail({
  task,
  now,
  project,
  goal,
  waitingFor,
  onClose,
  onSaveDetails,
  ...actions
}: {
  task: BoardTask;
  now: number;
  project: string;
  goal?: string;
  waitingFor: readonly string[];
  onClose: () => void;
  /** Resolves true once the new title and description are saved. */
  onSaveDetails: (title: string, prompt: string) => Promise<boolean>;
} & TaskActionHandlers) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [saving, setSaving] = useState(false);
  const model = resolveModel(task.harness, task.model);
  const description = task.prompt.trim();
  const editable = canEditTask(task.status);
  const canSave =
    title.trim().length > 0 && (task.status === "todo" || prompt.trim().length > 0) && !saving;

  // The task may stop being editable while its panel is open.
  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  const detailRoot = useRef<HTMLElement>(null);
  const overlayId = useOverlay(detailRoot, false, () => {
    if (editing) setEditing(false);
    else onClose();
  });

  const beginEdit = () => {
    setTitle(task.title);
    setPrompt(task.prompt);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      if (await onSaveDetails(title.trim(), prompt)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const { command, review } = task.verification ?? {};
  return (
    <OverlayParent.Provider value={overlayId}>
      <aside
        ref={detailRoot}
        aria-label={t("Task details")}
        className="flex min-h-0 w-[380px] max-w-[45%] shrink-0 flex-col border-l border-(--ui-tone-neutral-border) @max-[640px]/task-area:w-full @max-[640px]/task-area:max-w-none @max-[640px]/task-area:border-is-0"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3">
          <Badge tone="neutral" className="">
            {t(STATUS_LABELS[task.status])}
          </Badge>
          {task.needsInput || taskRequiresInstructions(task) ? (
            <Badge tone="warning" className="">
              {t("Needs input")}
            </Badge>
          ) : null}
          {task.source === "steward" ? (
            <Badge data-task-suggested tone="info" className="">
              {t("Suggested")}
            </Badge>
          ) : null}
          <Button
            iconOnly
            label={t("Close details")}
            variant="ghost"
            type="button"
            aria-label={t("Close details")}
            onClick={onClose}
            className="ml-auto"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {editing ? (
            <form aria-label={t("Edit details")} onSubmit={save} className="space-y-2">
              <TextField
                hideLabel
                label=""
                autoFocus
                aria-label={t("Title")}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                fieldClassName="w-full"
              />
              <TextareaField
                hideLabel
                label=""
                aria-label={t("Description")}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("Details, acceptance criteria, links…")}
                rows={8}
                fieldClassName="block w-full"
                className="resize-y"
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" type="submit" disabled={!canSave}>
                  {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                  {t("Save")}
                </Button>
                <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
                  {t("Cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-(--ui-tone-neutral-fg)">
                  {task.title}
                </h2>
                {editable ? (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={beginEdit}

                    aria-label={t("Edit title and description")}
                  >
                    <Pencil className="size-3" />
                    {t("Edit")}
                  </Button>
                ) : null}
              </div>
              <div data-task-detail-description className="text-[13px] text-(--ui-text-secondary)">
                {description ? (
                  <AgentMarkdown
                    text={taskInstructionsMarkdown(task.prompt)}
                    allowRemoteMedia={false}
                  />
                ) : (
                  <p className="text-(--ui-text-secondary)">{t("No description.")}</p>
                )}
              </div>
            </>
          )}
          <TaskActions task={task} {...actions} />
          <TaskAttemptHistory
            task={task}
            onOpenSession={actions.onOpenReview}
            isOpeningSession={actions.isOpeningSession}
          />
          {task.reviewNotes ? (
            <TaskReviewNotes
              notes={task.reviewNotes}
              busy={actions.busy}
              stale={task.stale}
              onRead={actions.onReadNotes}
              onResolve={actions.onResolveNote}
              onOpenReview={actions.onOpenReview}
            />
          ) : null}
          {goal ? (
            <p className="flex min-w-0 items-center gap-1 text-[12px] text-(--ui-text-secondary)">
              <Sparkles className="size-3 shrink-0" />
              <span className="min-w-0 truncate">
                {t("Part of the goal “")}
                {goal}”
              </span>
            </p>
          ) : null}
          {task.status === "blocked" && task.error ? (
            <Alert tone="danger" role="alert" className="break-words">
              {task.error}
            </Alert>
          ) : null}
          <dl className="space-y-1.5">
            <DetailRow label={t("Project")}>{project}</DetailRow>
            <DetailRow label={t("Machine")}>{task.machineName}</DetailRow>
            <DetailRow label={t("Execution")}>
              {task.continueUntilDone ? t("Continue until complete") : t("Standard")}
            </DetailRow>
            <DetailRow label={t("Agent")}>
              <span className="inline-flex items-center gap-1">
                <HarnessIcon harness={task.harness} className="size-3.5 shrink-0" />
                {model.name}
              </span>
            </DetailRow>
            <DetailRow label={t("Access")}>{t(RUNTIME_MODE_LABEL[task.runtimeMode])}</DetailRow>
            <DetailRow label={t("Time limit")}>
              {RUN_TIME_LIMIT_OPTIONS.find((option) => option.value === String(task.maxRunMinutes))
                ?.label ?? t("{p0} minutes", { p0: task.maxRunMinutes })}
            </DetailRow>
            {task.branch ? (
              <DetailRow label={t("Branch")}>
                {task.merged
                  ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                  : task.branch}
              </DetailRow>
            ) : null}
            {task.worktreeCwd ? (
              <DetailRow label={t("Worktree")}>{task.worktreeCwd}</DetailRow>
            ) : null}
            {task.deliveryCwd ? (
              <DetailRow label={t("Delivery worktree")}>{task.deliveryCwd}</DetailRow>
            ) : null}
            {task.baseBranch ? (
              <DetailRow label={t("Base branch")}>{task.baseBranch}</DetailRow>
            ) : null}
            {task.autoMerged ? (
              <DetailRow label={t("Merge")}>
                {t("Merged automatically")}
                {task.mergedAt ? ` · ${formatTime(task.mergedAt)}` : ""}
              </DetailRow>
            ) : null}
            {waitingFor.length > 0 ? (
              <DetailRow label={t("Waiting for")}>{waitingFor.join(", ")}</DetailRow>
            ) : null}
            <DetailRow label={t("Created")}>{formatTime(task.createdAt)}</DetailRow>
            {task.startedAt ? (
              <DetailRow label={t("Started")}>{formatTime(task.startedAt)}</DetailRow>
            ) : null}
            {task.completedAt ? (
              <DetailRow label={t("Completed")}>{formatTime(task.completedAt)}</DetailRow>
            ) : null}
            <DetailRow label={t("Status")}>{taskTimeLabel(task, now)}</DetailRow>
            {task.repairAttempts ? (
              <DetailRow label={t("Automatic correction")}>
                {t("Attempt ")}
                {task.repairAttempts} · {task.repairNote}
              </DetailRow>
            ) : null}
            {task.verifyCommand ? (
              <DetailRow label={t("Check command")}>
                <code className="font-mono text-[11px]">{task.verifyCommand}</code>
              </DetailRow>
            ) : null}
          </dl>
          {command ? (
            <section aria-label={t("Check output")} className="space-y-1">
              <h3 className="text-[12px] text-(--ui-text-secondary)">
                {t("Check command")}{" "}
                <span
                  className={
                    !command.timedOut && command.exitCode === 0
                      ? "text-(--ui-tone-success-fg)"
                      : "text-(--ui-tone-danger-fg)"
                  }
                >
                  {!command.timedOut && command.exitCode === 0
                    ? t("passed")
                    : command.timedOut
                      ? t("timed out")
                      : command.exitCode === null
                        ? t("could not run")
                        : t("failed (exit code {p0})", { p0: command.exitCode })}
                </span>
              </h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-surface-raised) px-2 py-1.5 font-mono text-[11px] text-(--ui-text-secondary)">
                {command.output.trim() || "No output."}
              </pre>
            </section>
          ) : null}
          {review ? (
            <p className="break-words text-[12px] leading-snug text-(--ui-text-secondary)">
              {t("Reviewer")}{" "}
              <span
                className={
                  review.verdict === "pass"
                    ? "text-(--ui-tone-success-fg)"
                    : "text-(--ui-tone-danger-fg)"
                }
              >
                {review.verdict === "pass" ? t("passed") : t("failed")}
              </span>
              {review.note ? ` · ${review.note}` : null}
            </p>
          ) : null}
          {task.diffStat ? (
            <pre
              aria-label={"Diff stat"}
              className="max-h-48 overflow-auto rounded bg-(--ui-surface-raised) px-2 py-1.5 font-mono text-[11px] leading-snug text-(--ui-text-secondary)"
            >
              {task.diffStat}
            </pre>
          ) : null}
          {task.mergeError ? (
            <Alert tone="danger" role="alert" className="break-words">
              {task.mergeError}
            </Alert>
          ) : null}
          {task.deliveryNote ? (
            <p
              role="status"
              className="break-words text-[12px] leading-snug text-(--ui-tone-warning-fg)"
            >
              {task.deliveryNote}
            </p>
          ) : null}
        </div>
      </aside>
    </OverlayParent.Provider>
  );
}

/** What the host checked before review: the check command's result, with its
 * output on demand, and the reviewer's verdict. */
function VerificationSummary({ verification }: { verification: TaskVerification }) {
  useLocale();
  const { command, review } = verification;
  if (!command && !review) return null;
  const passed = command && !command.timedOut && command.exitCode === 0;
  return (
    <div className="mt-1.5 space-y-1 text-[11px] leading-snug text-(--ui-text-secondary)">
      {command ? (
        <details>
          <summary className="cursor-pointer select-none">
            {t("Check command")}{" "}
            <span className={passed ? "text-(--ui-tone-success-fg)" : "text-(--ui-tone-danger-fg)"}>
              {passed
                ? t("passed")
                : command.timedOut
                  ? t("timed out")
                  : command.exitCode === null
                    ? t("could not run")
                    : t("failed (exit code {p0})", { p0: command.exitCode })}
            </span>
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-surface-raised) px-1.5 py-1 font-mono text-[10px] text-(--ui-text-secondary)">
            {command.output.trim() || "No output."}
          </pre>
        </details>
      ) : null}
      {review ? (
        <p className="break-words">
          {t("Reviewer")}{" "}
          <span
            className={
              review.verdict === "pass"
                ? "text-(--ui-tone-success-fg)"
                : "text-(--ui-tone-danger-fg)"
            }
          >
            {review.verdict === "pass" ? t("passed") : t("failed")}
          </span>
          {review.note ? ` · ${review.note}` : null}
        </p>
      ) : null}
    </div>
  );
}

/** Project discovery belongs to the selected host. Late responses cannot replace
 * the new host's choices, and errors have a local retry action. */
function useTaskMachineProjects(target: RemoteMachine | undefined, enabled = true) {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setProjects([]);
    setError(null);
    setLoading(Boolean(target && enabled));
    if (!target || !enabled) return;
    void machineProjects(target)
      .then(
        (entries) => {
          if (!cancelled)
            setProjects(
              entries.map((project) => ({
                path: hostProjectCwd(target, project),
                openedAt: 0,
              })),
            );
        },
        (reason) => {
          if (!cancelled) setError(String(reason));
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    target?.id,
    target?.endpoint,
    target?.environmentId,
    target?.localHost,
    target?.name,
    enabled,
    revision,
  ]);
  const retry = () => {
    if (target) invalidateMachineSnapshot(target.id);
    setRevision((current) => current + 1);
  };
  return { projects, error, loading, retry };
}

function ProjectDiscoveryStatus({ state }: { state: ReturnType<typeof useTaskMachineProjects> }) {
  return state.error ? (
    <span
      role="alert"
      className="inline-flex min-w-0 flex-wrap items-center gap-2 text-(--ui-tone-warning-fg)"
    >
      <span>{state.error}</span>
      <Button variant="secondary" type="button" onClick={state.retry}>
        {t("Retry")}
      </Button>
    </span>
  ) : state.loading ? (
    <span role="status" className="inline-flex items-center gap-1.5">
      <LoaderCircle className="size-3 animate-spin" />
      {t("Loading projects…")}
    </span>
  ) : null;
}

function TaskForm({
  draft,
  recents,
  machines,
  machine,
  todoUnsupported,
  saving,
  onChange,
  onCancel,
  onSubmit,
  limits,
  onChangeLimits,
}: {
  draft: TaskDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  /** The machine whose host would run this draft, when it is connected. */
  machine?: string;
  /** Why a to-do item cannot be added on that machine, when it cannot. */
  todoUnsupported?: string;
  saving: boolean;
  onChange: (draft: TaskDraft) => void;
  onCancel: () => void;
  /** `todo` and `queued` add a new task; `save` keeps an edited task's status. */
  onSubmit: (mode: "todo" | "queued" | "save") => void;
  limits: readonly MachineLimits[];
  onChangeLimits: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  useLocale();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceValid, setWorkspaceValid] = useState(true);
  const targetId = draft.machineId ?? backgroundMachineFor(machines, draft.cwd)?.id ?? "";
  const target = machines.find((entry) => entry.id === targetId);
  const lock = useLockSnapshot();
  useEffect(() => {
    if (!draft.machineId && !draft.id) {
      const selected = target ?? machines.find(isLocalSyncMachine);
      if (selected) onChange({ ...draft, machineId: selected.id });
    }
  }, [draft, target, machines, onChange]);
  const projectState = useTaskMachineProjects(target, !draft.id);
  const targetRecents = [
    { path: draft.cwd, openedAt: 0 },
    ...recents,
    ...projectState.projects,
  ].filter(
    (entry, index, entries) =>
      looksLikeProject(entry.path) &&
      !isProjectLockedIn(lock, entry.path) &&
      backgroundMachineFor(machines, entry.path)?.id === targetId &&
      entries.findIndex((other) => other.path === entry.path) === index,
  );
  // A to-do item is mostly title and description; the agent comes later.
  const [agentOpen, setAgentOpen] = useState(draft.id ? draft.status !== "todo" : false);
  const update = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const hasDescription = draft.prompt.trim().length > 0;
  const ready =
    !workspaceBusy &&
    workspaceValid &&
    draft.title.trim().length > 0 &&
    looksLikeProject(draft.cwd) &&
    draft.model.length > 0 &&
    machine != null &&
    (draft.id != null || backgroundMachineFor(machines, draft.cwd)?.id === targetId);
  const canTodo = ready && !todoUnsupported;
  const canSave = ready && (draft.status === "todo" || hasDescription);
  return (
    <form
      aria-label={draft.id ? t("Edit task") : t("New task")}
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        if (draft.id) {
          if (canSave) onSubmit("save");
        } else if (canTodo) onSubmit("todo");
      }}
      className="shrink-0 border-b border-(--ui-tone-neutral-border) px-4 py-3"
    >
      <div className="flex flex-wrap items-start gap-4">
        <TextField
          hideLabel
          label=""
          autoFocus
          aria-label={t("Task title")}
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder={t("What should get done?")}
          fieldClassName="task-title-field"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2 [max-inline-size:100%]">
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          {draft.id ? (
            <Button variant="primary" type="submit" disabled={!canSave || saving}>
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t("Save")}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={!ready || !hasDescription || saving}
                title={
                  hasDescription ? undefined : t("Add a description to start this with an agent.")
                }
                onClick={() => onSubmit("queued")}
              >
                {t("Add and start")}
              </Button>
              <Button variant="primary" type="submit" disabled={!canTodo || saving}>
                {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {t("Add to To do")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-(--ui-text-secondary)">
        {!draft.id ? (
          <SearchableSelect
            variant="pill"
            label={t("Machine")}
            value={targetId}
            options={machines.map((entry) => ({
              value: entry.id,
              label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
            }))}
            onChange={(id) => {
              onChange({
                ...draft,
                machineId: id,
                workspace: undefined,
                cwd:
                  recents.find(
                    (entry) =>
                      looksLikeProject(entry.path) &&
                      !isProjectLockedIn(lock, entry.path) &&
                      backgroundMachineFor(machines, entry.path)?.id === id,
                  )?.path ?? "",
              });
            }}
          />
        ) : null}
        {draft.id ? (
          // A task stays in the project it was created for.
          <span className="truncate">{projectDisplayName(draft.cwd)}</span>
        ) : (
          <SearchableSelect
            variant="pill"
            label={t("Project")}
            placeholder={t("Choose project")}
            value={draft.cwd}
            options={targetRecents.map((entry) => ({
              value: entry.path,
              label: projectDisplayName(entry.path),
              keywords: entry.path,
            }))}
            onChange={(cwd) => onChange({ ...draft, cwd, workspace: undefined })}
          />
        )}
        <ProjectDiscoveryStatus state={projectState} />
        <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-surface-raised)" />
        {target && !looksLikeProject(draft.cwd) ? (
          <span>{t("Choose project")}</span>
        ) : machine ? (
          <span className="truncate">
            {t("Runs on ")}
            {machine}
          </span>
        ) : (
          <span role="alert" className="text-(--ui-tone-warning-fg)">
            {TASK_MACHINE_ERROR}
          </span>
        )}
        {!draft.id && todoUnsupported ? (
          <span role="status" className="text-(--ui-tone-warning-fg)">
            {todoUnsupported}
          </span>
        ) : null}
      </div>
      <div
        data-ui-focus-group=""
        className="relative mt-2 rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) has-focus:border-(--ui-tone-neutral-border)"
      >
        <SkillPromptField
          value={draft.prompt}
          harness={draft.harness}
          cwd={draft.cwd}
          onChange={(prompt) => update("prompt", prompt)}
          label={t("Description")}
          placeholder={t("Details, acceptance criteria, links…")}
          focusOwner="group"
        />
      </div>
      <TaskExecutionMode
        isolate={draft.isolate}
        disabled={saving || draft.workspaceLocked}
        onChange={(isolate) => update("isolate", isolate)}
      />
      <TaskWorkspacePicker
        machine={target}
        cwd={draft.cwd}
        value={draft.workspace}
        onChange={(workspace) => update("workspace", workspace)}
        disabled={saving || draft.workspaceLocked}
        branchName={draft.isolate}
        isolate={draft.isolate}
        onBusyChange={setWorkspaceBusy}
        onValidityChange={setWorkspaceValid}
      />
      <MachineConcurrency machineId={targetId} limits={limits} onChange={onChangeLimits} />
      <Button
        variant="ghost"
        type="button"
        aria-expanded={agentOpen}
        onClick={() => setAgentOpen((open) => !open)}
        className="mt-2"
      >
        {agentOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {t("Agent settings")}
      </Button>
      {agentOpen ? (
        <div className="mt-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-2 py-2">
            <ModelPicker
              harness={draft.harness}
              model={draft.model}
              values={draft.modelSettings}
              project={draft.cwd}
              onChange={(harness, model) => onChange({ ...draft, harness, model })}
              onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
            />
            {draft.harness !== "fx" ? (
              <AccessPicker
                value={draft.runtimeMode}
                onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
              />
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-[11px] text-(--ui-text-secondary)">
              {t("Time limit")}
              <SearchableSelect
                variant="pill"
                searchable={false}
                align="end"
                label={t("Time limit")}
                value={String(draft.maxRunMinutes)}
                options={RUN_TIME_LIMIT_OPTIONS}
                onChange={(value) => update("maxRunMinutes", Number(value))}
              />
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-(--ui-text-secondary)">
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={draft.review}
                onChange={(event) => update("review", event.target.checked)}
              />
              {t("Review with a second agent")}
            </label>
            <AutoMergeField
              checked={draft.autoMerge && draft.isolate}
              disabled={!draft.isolate}
              onChange={(checked) => update("autoMerge", checked)}
            />
            <ContinueUntilDoneField
              checked={draft.continueUntilDone}
              onChange={(checked) => update("continueUntilDone", checked)}
            />
            <label className="flex min-w-[220px] flex-1 items-center gap-2">
              <span className="shrink-0">{t("Check command")}</span>
              <TextField
                hideLabel
                label=""
                aria-label={t("Check command")}
                value={draft.verifyCommand}
                onChange={(event) => update("verifyCommand", event.target.value)}
                placeholder={"npm test"}
                spellCheck={false}
                fieldClassName="min-w-0 flex-1"
                className="font-mono"
              />
            </label>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function ContinueUntilDoneField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block">{t("Continue until complete")}</span>
        <span className="block text-[11px] text-(--ui-text-secondary)">
          {t("Keeps correcting while progress is made; asks for input when needed.")}
        </span>
      </span>
    </label>
  );
}

/** The option to merge a task's branch once every check passes. */
function TaskExecutionMode({
  isolate,
  disabled,
  onChange,
}: {
  isolate: boolean;
  disabled?: boolean;
  onChange: (isolate: boolean) => void;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend>{t("Execution mode")}</legend>
      <SegmentedControl
        className="bycoda-arc"
        label={t("Execution mode")}
        selectionRole="radio"
        value={isolate ? "isolated" : "shared"}
        options={[
          { value: "shared", label: t("Shared checkout") },
          { value: "isolated", label: t("Separate worktree") },
        ]}
        onValueChange={(value) => onChange(value === "isolated")}
      />
    </fieldset>
  );
}

function AutoMergeField({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  useLocale();
  return (
    <label className={`flex items-center gap-1.5 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {t("Merge automatically")}
      <span className="text-[11px] text-(--ui-text-secondary)">
        {t("Merges into the base branch when every check passes")}
      </span>
    </label>
  );
}

const DAILY_LIMIT_LABELS: Record<number, string> = {
  0: "No limit",
  60: "1 hour",
  120: "2 hours",
  240: "4 hours",
  480: "8 hours",
  720: "12 hours",
};

/** Each machine's work limits: how many tasks run at once, how much agent time
 * a day may use, and how much of today's is gone. */
const SUMMARY_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const SUMMARY_HEADING =
  "text-[11px] font-medium uppercase tracking-wide text-(--ui-text-secondary)";

/** What the agents did over a period, across every machine. */
function SummaryPanel({
  summary,
  busy,
  error,
  onRefresh,
  onOpenTask,
}: {
  summary: DailySummary | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenTask: (key: string) => void;
}) {
  useLocale();
  const taskSection = (label: string, items: readonly SummaryTask[], note = "") =>
    items.length ? (
      <section aria-label={label} className="flex flex-col gap-1">
        <h3 className={SUMMARY_HEADING}>
          {label} · {items.length}
          {note}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.key} className="min-w-0 text-[12px] text-(--ui-text-secondary)">
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenTask(item.key)}
                className="max-w-full truncate text-left"
              >
                {item.title}
              </Button>{" "}
              <span className="text-(--ui-text-secondary)">
                {item.project} · {item.machineName}
                {item.detail ? ` · ${item.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const goalSection = (label: string, goals: DailySummary["goals"]) =>
    goals.length ? (
      <section aria-label={label} className="flex flex-col gap-1">
        <h3 className={SUMMARY_HEADING}>
          {label} · {goals.length}
        </h3>
        <ul className="flex flex-col gap-0.5">
          {goals.map((goal) => (
            <li
              key={`${goal.machineName}:${goal.title}`}
              className="text-[12px] text-(--ui-text-secondary)"
            >
              <span className="font-medium text-(--ui-text-secondary)">{goal.title}</span>{" "}
              <span className="text-(--ui-text-secondary)">
                {goal.done}
                {t(" of ")}
                {goal.total}
                {t(" tasks done · ")}
                {goal.machineName}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const empty =
    summary != null &&
    !summary.finished.length &&
    !summary.blocked.length &&
    !summary.waiting.length &&
    !summary.suggestions.length &&
    !summary.goals.length &&
    !summary.goalsFinished.length;
  return (
    <section
      aria-label={t("Summary")}
      className="mx-4 mt-4 flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-(--ui-text-secondary)">
          {summary
            ? t("From {p0} to {p1}", {
                p0: SUMMARY_TIME.format(summary.since),
                p1: SUMMARY_TIME.format(summary.until),
              })
            : t("No summary yet. One is sent every day at the time set in Settings.")}
        </p>
        <Button variant="secondary" type="button" onClick={onRefresh} disabled={busy}>
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          {busy ? t("Refreshing…") : t("Refresh now")}
        </Button>
      </div>
      {error ? <p className="text-[12px] text-(--ui-tone-danger-fg)">{error}</p> : null}
      {summary ? (
        <>
          {empty ? (
            <p className="text-[12px] text-(--ui-text-secondary)">{t("No background activity.")}</p>
          ) : null}
          {taskSection(
            "Finished",
            summary.finished,
            summary.autoMerged ? ` (${summary.autoMerged} merged automatically)` : "",
          )}
          {taskSection("Blocked", summary.blocked)}
          {taskSection("Waiting for you", summary.waiting)}
          {taskSection("New suggestions", summary.suggestions)}
          {goalSection("Goals in progress", summary.goals)}
          {goalSection("Goals finished", summary.goalsFinished)}
          {summary.usage.length ? (
            <section aria-label={t("Agent time")} className="flex flex-col gap-1">
              <h3 className={SUMMARY_HEADING}>{t("Agent time today")}</h3>
              <ul className="flex flex-col gap-0.5">
                {summary.usage.map((entry) => (
                  <li key={entry.machineName} className="text-[12px] text-(--ui-text-secondary)">
                    <span className="font-medium text-(--ui-text-secondary)">
                      {entry.machineName}
                    </span>{" "}
                    {formatAgentMinutes(entry.usedMinutes)}
                    {entry.dailyAgentMinutes
                      ? t(" of {p0}", { p0: formatAgentMinutes(entry.dailyAgentMinutes) })
                      : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {summary.unreachable.length || summary.outdated.length ? (
            <p className="text-[12px] text-(--ui-text-secondary)">
              {t("Not included:")}{" "}
              {[
                ...summary.unreachable.map((name) => `${name} (not reachable)`),
                ...summary.outdated.map((name) => `${name} (host needs an update)`),
              ].join(", ")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CustomDailyLimit({
  entry,
  onChange,
}: {
  entry: MachineLimits;
  onChange: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  useLocale();
  const [hours, setHours] = useState(String(entry.dailyAgentMinutes / 60));
  useEffect(() => {
    setHours(String(entry.dailyAgentMinutes / 60));
  }, [entry.dailyAgentMinutes]);
  const minutes = Math.round(Number(hours) * 60);
  const valid = hours.trim() !== "" && Number(hours) >= 0 && Number.isSafeInteger(minutes);
  return (
    <form
      aria-label={t("Custom daily agent time on {p0}", { p0: entry.machineName })}
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onChange(entry.machineId, { dailyAgentMinutes: minutes });
      }}
    >
      <label className="flex items-center gap-2">
        {t("Hours")}
        <NumberField
          hideLabel
          label=""

          min="0"
          step="any"
          aria-label={t("Daily agent hours on {p0}", { p0: entry.machineName })}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          fieldClassName="w-24 max-w-24"
        />
      </label>
      <Button variant="secondary" type="submit" disabled={!valid}>
        {t("Save")}
      </Button>
      <span className="text-[11px] text-(--ui-text-secondary)">{t("0 = no limit")}</span>
    </form>
  );
}

function MachineConcurrency({
  machineId,
  limits,
  onChange,
}: {
  machineId: string;
  limits: readonly MachineLimits[];
  onChange: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  const limit = limits.find((entry) => entry.machineId === machineId);
  if (!limit) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 text-[12px]">
      {t("Machine task limit")}
      <SearchableSelect
        label={t("Machine task limit")}
        value={String(limit.maxRunningTasks)}
        searchable={false}
        options={Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
        onChange={(value) => onChange(machineId, { maxRunningTasks: Number(value) })}
      />
      <span>{t("Applies to all goals and tasks on this machine.")}</span>
    </label>
  );
}

function LimitsPanel({
  limits,
  onChange,
}: {
  limits: readonly MachineLimits[];
  onChange: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  useLocale();
  // A limit set some other way stays selectable.
  const choices = (current: number) =>
    [...new Set([...DAILY_LIMIT_CHOICES, current])]
      .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b))
      .map((minutes) => ({
        value: String(minutes),
        label: DAILY_LIMIT_LABELS[minutes] ?? formatAgentMinutes(minutes),
      }));
  return (
    <ul
      aria-label={t("Work limits")}
      className="mx-4 mt-4 flex shrink-0 flex-col gap-2 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-3"
    >
      {limits.map((entry) => (
        <li
          key={entry.machineId}
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-(--ui-text-secondary)"
        >
          <span className="min-w-24 font-medium text-(--ui-text-secondary)">
            {entry.machineName}
          </span>
          <span className="flex items-center gap-2">
            {t("Max concurrent tasks")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Max concurrent tasks on {p0}", { p0: entry.machineName })}
              value={String(entry.maxRunningTasks)}
              options={Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
              onChange={(value) => onChange(entry.machineId, { maxRunningTasks: Number(value) })}
            />
          </span>
          <span className="flex items-center gap-2">
            {t("Daily agent time")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Daily agent time on {p0}", { p0: entry.machineName })}
              value={String(entry.dailyAgentMinutes)}
              options={choices(entry.dailyAgentMinutes)}
              onChange={(value) => onChange(entry.machineId, { dailyAgentMinutes: Number(value) })}
            />
          </span>
          <CustomDailyLimit entry={entry} onChange={onChange} />
          <span className="tabular-nums text-(--ui-text-secondary)">
            {t("Used today: ")}
            {formatAgentMinutes(entry.usedMinutes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One goal above the board: where it stands, how many of its tasks are done,
 * and what the owner can do about it. A plan waiting for approval is shown in
 * full; a plan that failed shows why. */
function GoalCard({
  goal,
  tasks,
  busy,
  onApprove,
  onEdit,
  onReplan,
  onCancel,
  onDelete,
  onOpenPlanner,
  onSessions,
}: {
  goal: BoardGoal;
  /** The tasks on the goal's machine. */
  tasks: readonly BoardTask[];
  busy: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReplan: (feedback: string) => Promise<unknown>;
  onCancel: () => void;
  onDelete: () => void;
  onOpenPlanner?: () => void;
  onSessions: () => void;
}) {
  useLocale();
  const [replanning, setReplanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
  const progress = goalProgress(goal, tasks);
  const failedPlanning = goal.status === "blocked" && goal.taskIds.length === 0;
  const canReplan = goal.status === "awaiting-approval" || failedPlanning;
  const projectOf = (id: string | undefined, path: string) =>
    goal.projects.find((project) => project.id === id)?.name ?? projectDisplayName(path);
  const titleOf = (key: string) => goal.plan?.tasks.find((task) => task.key === key)?.title ?? key;
  const reason = goal.planError ?? goal.error;
  return (
    <article
      aria-label={goal.title}
      data-goal-status={goal.status}
      className="rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
        <h3
          title={goal.prompt}
          className="min-w-0 truncate text-[13px] font-semibold text-(--ui-tone-neutral-fg)"
        >
          {goal.title}
        </h3>
        <Badge tone={GOAL_STATUS_TONES[goal.status]} className="shrink-0">
          {goal.status === "planning" ? (
            <LoaderCircle className="mr-1 size-3 animate-spin" />
          ) : null}
          {t(GOAL_STATUS_LABELS[goal.status])}
        </Badge>
        {progress.total > 0 ? (
          <span className="shrink-0 tabular-nums text-[11px] text-(--ui-text-secondary)">
            {progress.done}/{progress.total}
            {t(" done")}
          </span>
        ) : null}
        <span className="min-w-0 truncate text-[11px] text-(--ui-text-secondary)">
          {goal.projects.map((project) => project.name).join(", ")}
          {t(" · on")} {goal.machineName}
          {goal.stale ? t(" (offline, last known)") : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {busy ? (
            <LoaderCircle className="mx-1.5 size-3 animate-spin text-(--ui-text-secondary)" />
          ) : null}
          {goal.status !== "done" && goal.status !== "cancelled" ? (
            <Button
              variant="ghost"
              iconOnly
              label={t("Edit goal settings")}
              disabled={busy || Boolean(goal.stale) || !goal.settingsSupported}
              tooltip={
                goal.settingsSupported
                  ? t("Edit goal settings")
                  : t("Update the selected host to edit goal settings.")
              }
              onClick={onEdit}
            >
              <Pencil className="size-3" />
            </Button>
          ) : null}
          {goal.status === "awaiting-approval" ? (
            <Button variant="ghost" disabled={busy} onClick={onApprove}>
              <Check className="size-3" />
              {t("Approve")}
            </Button>
          ) : null}
          {canReplan ? (
            <Button
              variant="ghost"

              disabled={busy}
              onClick={() => setReplanning((open) => !open)}
            >
              <RotateCcw className="size-3" />
              {t("Replan")}
            </Button>
          ) : null}
          {onOpenPlanner ? (
            <Button variant="ghost" disabled={false} onClick={onOpenPlanner}>
              <MessageSquare className="size-3" />
              {t("Open planner")}
            </Button>
          ) : null}
          {goal.taskIds.length > 0 ? (
            <Button variant="ghost" disabled={false} onClick={onSessions}>
              <MessageSquare className="size-3" />
              {t("Task sessions")}
            </Button>
          ) : null}
          <Button
            ref={menuTrigger}
            variant="ghost"
            iconOnly
            label={t("More actions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={menuTrigger}
              label={t("More actions")}
              onClose={() => setMenuOpen(false)}
              items={[
                ...(goal.status === "done" || goal.status === "cancelled"
                  ? []
                  : [
                      {
                        kind: "item" as const,
                        id: "cancel",
                        label: t("Cancel"),
                        disabled: busy,
                        icon: <Square className="size-3" />,
                      },
                    ]),
                ...(goal.status === "planning" || goal.status === "running"
                  ? []
                  : [
                      {
                        kind: "item" as const,
                        id: "delete",
                        label: t("Delete"),
                        disabled: busy,
                        danger: true,
                        icon: <Trash2 className="size-3" />,
                      },
                    ]),
              ]}
              onPick={(id) => {
                if (busy) return;
                if (id === "cancel") onCancel();
                else if (id === "delete") onDelete();
              }}
            />
          ) : null}
        </div>
      </div>
      {goal.status === "blocked" && reason ? (
        <p className="mt-1 break-words text-[11px] leading-snug text-(--ui-tone-danger-fg)">
          {reason}
        </p>
      ) : null}
      {goal.status === "awaiting-approval" && goal.plan ? (
        <ol aria-label={t("Plan")} className="mt-1.5 space-y-1">
          {goal.plan.tasks.map((task) => (
            <li
              key={task.key}
              title={task.prompt}
              className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12px] leading-snug"
            >
              <span className="text-(--ui-text-secondary)">{task.title}</span>
              <span className="text-[11px] text-(--ui-text-secondary)">
                {t("in ")}
                {projectOf(task.projectId, task.project)}
              </span>
              {task.dependsOn.length ? (
                <span className="text-[11px] text-(--ui-text-secondary)">
                  {t("· after ")}
                  {task.dependsOn.map(titleOf).join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {replanning && canReplan ? (
        <form
          aria-label={t("Replan")}
          className="mt-1.5 flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onReplan(feedback).then(() => {
              setReplanning(false);
              setFeedback("");
            });
          }}
        >
          <TextareaField
            hideLabel
            label=""
            autoFocus
            aria-label={t("Plan feedback")}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("What should the plan do differently? (optional)")}
            rows={2}
            fieldClassName="min-w-0 flex-1"
            className="resize-y"
          />
          <Button variant="primary" type="submit" disabled={busy}>
            {t("Plan again")}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

/** Operational edits retain the goal's plan and execution identity. */
function GoalSettingsForm({
  goal,
  saving,
  error,
  onCancel,
  onSave,
}: {
  goal: BoardGoal;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (settings: GoalSettings) => Promise<void>;
}) {
  useLocale();
  const [settings, setSettings] = useState<GoalSettings>(() => ({
    autoMerge: Boolean(goal.autoMerge),
    continueUntilDone: Boolean(goal.continueUntilDone),
    maxRunningTasks: goal.maxRunningTasks ?? 0,
    maxRunMinutes: goal.maxRunMinutes,
  }));
  const valid =
    Number.isInteger(settings.maxRunMinutes) &&
    settings.maxRunMinutes >= 0 &&
    settings.maxRunMinutes <= 10_080;
  const update = <K extends keyof GoalSettings>(key: K, value: GoalSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  return (
    <form
      aria-label={t("Edit goal settings")}
      className="grid min-w-0 gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && valid) void onSave(settings);
      }}
    >
      <p className="break-words">{goal.title}</p>
      <p>
        {t(
          "Applies to existing unfinished tasks. Enabling automatic merge can deliver tasks that already passed review.",
        )}
      </p>
      <fieldset disabled={saving} className="grid min-w-0 gap-3">
        <AutoMergeField
          checked={settings.autoMerge}
          disabled={goal.isolate === false}
          onChange={(value) => update("autoMerge", value)}
        />
        <ContinueUntilDoneField
          checked={settings.continueUntilDone}
          onChange={(value) => update("continueUntilDone", value)}
        />
        <label>
          {t("Concurrent tasks in this goal")}
          <SearchableSelect
            label={t("Concurrent tasks in this goal")}
            searchable={false}
            value={String(settings.maxRunningTasks)}
            options={[
              { value: "0", label: t("Use machine limit") },
              ...Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              })),
            ]}
            onChange={(value) => update("maxRunningTasks", Number(value))}
          />
        </label>
        <TextField
          label={t("Run limit (minutes)")}
          type="number"
          disabled={goal.status === "planning"}
          min={0}
          max={10_080}
          step={1}
          value={Number.isNaN(settings.maxRunMinutes) ? "" : settings.maxRunMinutes}
          onChange={(event) =>
            update("maxRunMinutes", event.target.value === "" ? NaN : Number(event.target.value))
          }
        />
        <p>
          {t(
            "Zero disables the run limit. Limits apply to waiting tasks; active tasks keep their current limit. Blocked tasks still require restart.",
          )}
        </p>
        {goal.status === "planning" ? (
          <p>{t("Wait for planning to finish before changing the run limit.")}</p>
        ) : null}
      </fieldset>
      {error ? (
        <Alert tone="danger" role="alert" className="">
          {t(error)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid}>
          {t("Save")}
        </Button>
      </div>
    </form>
  );
}

/** The new goal form: the job, projects, lead project and task agent. */
function GoalForm({
  draft,
  recents,
  machines,
  machine,
  saving,
  onChange,
  onCancel,
  onSubmit,
  limits,
  onChangeLimits,
}: {
  draft: GoalDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  /** The machine whose host would carry out this goal, when it is connected. */
  machine?: string;
  saving: boolean;
  onChange: (draft: GoalDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  limits: readonly MachineLimits[];
  onChangeLimits: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  useLocale();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceValidity, setWorkspaceValidity] = useState<Record<string, boolean>>({});
  const update = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const targetId = draft.machineId ?? backgroundMachineFor(machines, draft.cwds[0] ?? "")?.id ?? "";
  const target = machines.find((entry) => entry.id === targetId);
  const lock = useLockSnapshot();
  useEffect(() => {
    if (!draft.machineId) {
      const selected = target ?? machines.find(isLocalSyncMachine);
      if (selected) onChange({ ...draft, machineId: selected.id });
    }
  }, [draft, target, machines, onChange]);
  const projectState = useTaskMachineProjects(target);
  const choices = [...recents, ...projectState.projects].filter(
    (recent, index, entries) =>
      looksLikeProject(recent.path) &&
      !isProjectLockedIn(lock, recent.path) &&
      !draft.cwds.includes(recent.path) &&
      backgroundMachineFor(machines, recent.path)?.id === targetId &&
      entries.findIndex((entry) => entry.path === recent.path) === index,
  );
  const lead = draft.leadCwd || draft.cwds[0] || "";
  const valid =
    !workspaceBusy &&
    draft.cwds.every((cwd) => workspaceValidity[cwd] !== false) &&
    draft.title.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    draft.cwds.length > 0 &&
    draft.model.length > 0 &&
    machine != null &&
    target != null &&
    draft.cwds.every((cwd) => backgroundMachineFor(machines, cwd)?.id === targetId);
  return (
    <form
      aria-label={t("New goal")}
      onSubmit={(event) => {
        if (!valid || saving) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="shrink-0 border-b border-(--ui-tone-neutral-border) px-4 py-3"
    >
      <div className="flex flex-wrap items-start gap-4">
        <TextField
          hideLabel
          label=""
          autoFocus
          aria-label={t("Goal title")}
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder={t("Name the main job")}
          fieldClassName="task-title-field"
        />
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || saving}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t("Plan it")}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-(--ui-text-secondary)">
        <SearchableSelect
          variant="pill"
          label={t("Machine")}
          placeholder={t("Choose machine")}
          value={targetId}
          options={machines.map((entry) => ({
            value: entry.id,
            label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
          }))}
          onChange={(machineId) =>
            onChange({ ...draft, machineId, cwds: [], leadCwd: "", workspaces: undefined })
          }
        />
        <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-surface-raised)" />
        <span className="shrink-0">{t("Projects")}</span>
        {draft.cwds.map((cwd) => (
          <span
            key={cwd}
            data-goal-project={cwd}
            className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full border border-(--ui-tone-neutral-border) pl-2 pr-1 text-[12px] text-(--ui-text-secondary)"
          >
            <span className="min-w-0 truncate">{projectDisplayName(cwd)}</span>
            {cwd === lead ? (
              <span className="shrink-0 text-[10px] text-(--ui-text-secondary)">{t("lead")}</span>
            ) : null}
            <Button
              iconOnly
              label={t("Remove {p0}", { p0: projectDisplayName(cwd) })}
              variant="ghost"
              type="button"
              aria-label={t("Remove {p0}", { p0: projectDisplayName(cwd) })}
              onClick={() => onChange(toggleGoalProject(draft, cwd))}
              className="shrink-0"
            >
              <X className="size-3" />
            </Button>
          </span>
        ))}
        {draft.cwds.length < MAX_GOAL_PROJECTS ? (
          <SearchableSelect
            variant="pill"
            label={t("Project")}
            placeholder={t("Choose project")}
            value=""
            options={choices.map((entry) => ({
              value: entry.path,
              label: projectDisplayName(entry.path),
              keywords: entry.path,
            }))}
            onChange={(cwd) => onChange(toggleGoalProject(draft, cwd))}
          />
        ) : null}
        <ProjectDiscoveryStatus state={projectState} />
        {draft.cwds.length > 1 ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-surface-raised)" />
            {t("Lead")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              label={t("Lead project")}
              value={lead}
              options={draft.cwds.map((cwd) => ({
                value: cwd,
                label: projectDisplayName(cwd),
              }))}
              onChange={(cwd) => update("leadCwd", cwd)}
            />
          </span>
        ) : null}
        <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-surface-raised)" />
        {machine ? (
          <span className="truncate">
            {t("Runs on ")}
            {machine}
          </span>
        ) : draft.cwds.length ? (
          <span role="alert" className="text-(--ui-tone-warning-fg)">
            {TASK_MACHINE_ERROR}
          </span>
        ) : (
          <span>{t("Choose the projects the job may touch, all on one machine.")}</span>
        )}
      </div>
      <div className="relative mt-2 rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) has-focus:border-(--ui-tone-neutral-border)">
        <TextareaField
          hideLabel
          label=""
          aria-label={t("Main job")}
          value={draft.prompt}
          onChange={(event) => update("prompt", event.target.value)}
          placeholder={t(
            "Describe the whole job. A planner agent reads the projects and splits it into tasks, which agents then carry out.",
          )}
          rows={4}
          fieldClassName="block w-full"
          className="resize-y"
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          <ModelPicker
            harness={draft.harness}
            model={draft.model}
            values={draft.modelSettings}
            project={lead || "~"}
            onChange={(harness, model) => onChange({ ...draft, harness, model })}
            onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
          />
          {draft.harness !== "fx" ? (
            <AccessPicker
              value={draft.runtimeMode}
              onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
            />
          ) : null}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-(--ui-text-secondary)">
            {t("Time limit")}
            <SearchableSelect
              variant="pill"
              searchable={false}
              align="end"
              label={t("Time limit")}
              value={String(draft.maxRunMinutes)}
              options={RUN_TIME_LIMIT_OPTIONS}
              onChange={(value) => update("maxRunMinutes", Number(value))}
            />
          </span>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-(--ui-text-secondary)">
        <label
          title={t("The planned tasks are created only once you approve the plan.")}
          className="flex cursor-pointer items-center gap-1.5"
        >
          <Checkbox
            checked={draft.approvePlan}
            onChange={(event) => update("approvePlan", event.target.checked)}
          />
          {t("Review the plan before starting")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox
            checked={draft.review}
            onChange={(event) => update("review", event.target.checked)}
          />
          {t("Review each task with a second agent")}
        </label>
        <TaskExecutionMode
          isolate={draft.isolate !== false}
          disabled={saving}
          onChange={(isolate) => update("isolate", isolate)}
        />
        <AutoMergeField
          checked={draft.autoMerge && draft.isolate !== false}
          disabled={draft.isolate === false}
          onChange={(checked) => update("autoMerge", checked)}
        />
        <ContinueUntilDoneField
          checked={draft.continueUntilDone}
          onChange={(checked) => update("continueUntilDone", checked)}
        />
        <span className="text-[11px] text-(--ui-text-secondary)">
          {draft.isolate === false
            ? t("Tasks work directly in the selected checkout. You review and commit the changes.")
            : draft.autoMerge
              ? t("Each task runs on its own branch.")
              : t("Each task runs on its own branch and waits for you to merge it.")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <label>
          {t("Start planned tasks")}
          <SearchableSelect
            label={t("Start planned tasks")}
            searchable={false}
            value={draft.manualStart ? "manual" : "automatic"}
            options={[
              { value: "automatic", label: t("Automatically when ready") },
              { value: "manual", label: t("Manually from To do") },
            ]}
            onChange={(value) => update("manualStart", value === "manual")}
          />
        </label>
        <label>
          {t("Concurrent tasks in this goal")}
          <SearchableSelect
            label={t("Concurrent tasks in this goal")}
            searchable={false}
            value={String(draft.maxRunningTasks ?? 0)}
            options={[
              { value: "0", label: t("Use machine limit") },
              ...Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              })),
            ]}
            onChange={(value) => update("maxRunningTasks", Number(value) || undefined)}
          />
        </label>
        <MachineConcurrency machineId={targetId} limits={limits} onChange={onChangeLimits} />
      </div>
      {draft.cwds.map((cwd) => (
        <div key={cwd}>
          <p className="font-medium text-[12px]">{projectDisplayName(cwd)}</p>
          <TaskWorkspacePicker
            machine={target}
            cwd={cwd}
            isolate={draft.isolate !== false}
            value={draft.workspaces?.[cwd]}
            disabled={saving || workspaceBusy}
            onBusyChange={setWorkspaceBusy}
            onValidityChange={(valid) =>
              setWorkspaceValidity((current) =>
                current[cwd] === valid ? current : { ...current, [cwd]: valid },
              )
            }
            onChange={(workspace) =>
              update("workspaces", { ...draft.workspaces, [cwd]: workspace ?? {} })
            }
          />
        </div>
      ))}
    </form>
  );
}

function scheduleOf(draft: StewardDraft) {
  return {
    scheduleKind: draft.scheduleKind,
    minute: draft.minute,
    time: draft.time,
    dayOfWeek: draft.dayOfWeek,
  };
}

const SCHEDULE_OPTIONS = [
  {
    value: "hourly",
    get label() {
      return t("Hourly");
    },
  },
  {
    value: "daily",
    get label() {
      return t("Daily");
    },
  },
  {
    value: "weekdays",
    get label() {
      return t("Weekdays");
    },
  },
  {
    value: "weekly",
    get label() {
      return t("Weekly");
    },
  },
] as const;

/** The stewards above the board: one row per project with its schedule and
 * last run, and the form that adds or edits one. */
function StewardsPanel({
  stewards,
  draft,
  recents,
  machine,
  saving,
  acting,
  now,
  onAdd,
  onEdit,
  onChange,
  onCancel,
  onSubmit,
  onToggle,
  onRunNow,
  onDelete,
}: {
  stewards: readonly BoardSteward[];
  draft: StewardDraft | null;
  recents: RecentProject[];
  /** The machine that would run the draft's steward, when it is connected. */
  machine?: string;
  saving: boolean;
  acting: string | null;
  now: number;
  onAdd: () => void;
  onEdit: (steward: BoardSteward) => void;
  onChange: (draft: StewardDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  onToggle: (steward: BoardSteward) => void;
  onRunNow: (steward: BoardSteward) => void;
  onDelete: (steward: BoardSteward) => void;
}) {
  useLocale();
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLButtonElement } | null>(null);
  const menuSteward = menu
    ? stewards.find((steward) => `${steward.machineId}:${steward.id}` === menu.key)
    : undefined;
  const menuBusy = menuSteward
    ? acting === `steward:${menuSteward.machineId}:${menuSteward.id}`
    : true;
  return (
    <section
      aria-label={t("Stewards")}
      className="flex max-h-[45%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-(--ui-tone-neutral-border) p-3"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-(--ui-text-secondary)">
          {t(
            "A steward reads its project on a schedule and suggests the next work as To do items. Nothing runs until you start it.",
          )}
        </p>
        <Button variant="secondary" type="button" onClick={onAdd} disabled={draft != null}>
          <Plus className="size-3.5" strokeWidth={1.75} />
          {t("Add steward")}
        </Button>
      </div>
      {draft ? (
        <StewardForm
          draft={draft}
          recents={recents}
          machine={machine}
          saving={saving}
          onChange={onChange}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
      <ul aria-label={t("Steward list")} className="flex flex-col gap-1.5">
        {stewards.map((steward) => {
          const busy = acting === `steward:${steward.machineId}:${steward.id}`;
          const running = steward.run != null;
          return (
            <li key={`${steward.machineId}:${steward.id}`}>
              <article
                aria-label={t("Steward for {p0}", { p0: stewardProjectName(steward) })}
                data-steward-status={steward.lastRunStatus}
                className="rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Bot className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
                  <h3
                    title={steward.focus || undefined}
                    className="min-w-0 truncate text-[13px] font-semibold text-(--ui-tone-neutral-fg)"
                  >
                    {stewardProjectName(steward)}
                  </h3>
                  <span className="min-w-0 truncate text-[11px] text-(--ui-text-secondary)">
                    {t("on ")}
                    {steward.machineName}
                    {steward.stale ? t(" (offline, last known)") : ""} ·{" "}
                    {automationScheduleLabel(steward)}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    {busy ? (
                      <LoaderCircle className="mx-1.5 size-3 animate-spin text-(--ui-text-secondary)" />
                    ) : null}
                    <label className="flex cursor-pointer items-center gap-1.5 px-1.5 text-[11px] text-(--ui-text-secondary)">
                      <Checkbox
                        aria-label={t("Enabled")}
                        checked={steward.enabled}
                        disabled={busy}
                        onChange={() => onToggle(steward)}
                      />
                      {t("Enabled")}
                    </label>
                    <Button
                      variant="ghost"

                      disabled={busy || running}
                      onClick={() => onRunNow(steward)}
                    >
                      <Play className="size-3" />
                      {t("Run now")}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => onEdit(steward)}>
                      <Pencil className="size-3" />
                      {t("Edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      iconOnly
                      label={t("More actions")}
                      disabled={busy}
                      aria-haspopup="menu"
                      aria-expanded={menu?.key === `${steward.machineId}:${steward.id}`}
                      onClick={(event) =>
                        setMenu({
                          key: `${steward.machineId}:${steward.id}`,
                          anchor: event.currentTarget,
                        })
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 break-words text-[11px] leading-snug text-(--ui-text-secondary)">
                  {steward.lastRunStatus ? (
                    <>
                      {t("Last run: ")}
                      {STEWARD_STATUS_LABELS[steward.lastRunStatus]}
                      {steward.lastRunAt
                        ? t(" {p0} ago", { p0: formatTaskSpan(now - steward.lastRunAt) })
                        : ""}
                      {steward.lastRunStatus === "succeeded" && steward.lastProposed !== undefined
                        ? t(
                            steward.lastProposed === 1
                              ? " · {p0} new suggestion"
                              : " · {p0} new suggestions",
                            { p0: steward.lastProposed },
                          )
                        : ""}
                    </>
                  ) : (
                    t("Has not run yet")
                  )}
                  {steward.enabled ? ` · ${nextRunPreview(steward.nextRunAt)}` : t(" · Paused")}
                </p>
                {steward.lastRunError &&
                (steward.lastRunStatus === "failed" || steward.lastRunStatus === "skipped") ? (
                  <p
                    className={`mt-0.5 break-words text-[11px] leading-snug ${
                      steward.lastRunStatus === "failed"
                        ? "text-(--ui-tone-danger-fg)"
                        : "text-(--ui-text-secondary)"
                    }`}
                  >
                    {steward.lastRunError}
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
        {stewards.length === 0 && !draft ? (
          <li>
            <EmptyState description={t("No stewards yet.")} />
          </li>
        ) : null}
      </ul>
      {menu && menuSteward ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("More actions")}
          items={[
            {
              kind: "item",
              id: "delete",
              label: t("Delete"),
              danger: true,
              disabled: menuBusy,
              icon: <Trash2 className="size-3" />,
            },
          ]}
          onClose={() => setMenu(null)}
          onPick={() => {
            if (!menuBusy) onDelete(menuSteward);
          }}
        />
      ) : null}
    </section>
  );
}

/** The steward form: the project, what to look for, when to look, and the
 * agent that does it. */
function StewardForm({
  draft,
  recents,
  machine,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: StewardDraft;
  recents: RecentProject[];
  machine?: string;
  saving: boolean;
  onChange: (draft: StewardDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  useLocale();
  const update = <K extends keyof StewardDraft>(key: K, value: StewardDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const valid = looksLikeProject(draft.cwd) && draft.model.length > 0 && machine != null;
  const number = (
    label: string,
    value: number,
    max: number,
    key: "maxProposals" | "maxOpen" | "minute",
    min = 1,
  ) => (
    <label className="flex items-center gap-2">
      <span className="shrink-0">{label}</span>
      <NumberField
        hideLabel
        label=""

        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Math.trunc(Number(event.target.value));
          if (Number.isFinite(next)) update(key, Math.min(max, Math.max(min, next)));
        }}
        fieldClassName="w-16 max-w-16"
      />
    </label>
  );
  return (
    <form
      aria-label={draft.id ? t("Edit steward") : t("New steward")}
      onSubmit={onSubmit}
      className="rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface) px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-(--ui-text-secondary)">
        {draft.id ? (
          // A steward stays with the project it was created for.
          <span className="truncate">{projectDisplayName(draft.cwd)}</span>
        ) : (
          <SearchableProjectPicker
            cwd={draft.cwd}
            recents={recents}
            onSelectProject={(cwd) => update("cwd", cwd)}
          />
        )}
        <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-surface-raised)" />
        {machine ? (
          <span className="truncate">
            {t("Runs on ")}
            {machine}
          </span>
        ) : (
          <span role="alert" className="text-(--ui-tone-warning-fg)">
            {TASK_MACHINE_ERROR}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!valid || saving}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t("Save")}
          </Button>
        </div>
      </div>
      <TextareaField
        hideLabel
        label=""
        aria-label={t("Focus")}
        value={draft.focus}
        onChange={(event) => update("focus", event.target.value)}
        placeholder={t(
          "What should it look for? e.g. follow docs/ROADMAP.md, or find bugs and missing tests",
        )}
        rows={2}
        fieldClassName="mt-2 block w-full"
        className="resize-y"
      />
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-(--ui-text-secondary)">
        <span className="shrink-0">{t("Look")}</span>
        <SearchableSelect
          variant="pill"
          searchable={false}
          label={t("Schedule")}
          value={draft.scheduleKind}
          options={SCHEDULE_OPTIONS}
          onChange={(value) => update("scheduleKind", value as StewardDraft["scheduleKind"])}
        />
        {draft.scheduleKind === "weekly" ? (
          <SearchableSelect
            variant="pill"
            searchable={false}
            label={t("Day of week")}
            value={String(draft.dayOfWeek)}
            options={AUTOMATION_WEEKDAYS.map((day, index) => ({
              value: String(index),
              label: day,
            }))}
            onChange={(value) => update("dayOfWeek", Number(value))}
          />
        ) : null}
        {draft.scheduleKind === "hourly" ? (
          number("Minute", draft.minute, 59, "minute", 0)
        ) : (
          <TextField
            hideLabel
            label=""
            type="time"
            aria-label={t("Time")}
            value={draft.time}
            onChange={(event) => {
              if (event.target.value) update("time", event.target.value);
            }}
          />
        )}
        <span className="text-[11px] text-(--ui-text-secondary)">
          {automationScheduleLabel(scheduleOf(draft))}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 rounded-md border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-2 py-2">
        <ModelPicker
          harness={draft.harness}
          model={draft.model}
          values={draft.modelSettings}
          project={draft.cwd}
          onChange={(harness, model) => onChange({ ...draft, harness, model })}
          onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
        />
        {draft.harness !== "fx" ? (
          <AccessPicker
            value={draft.runtimeMode}
            onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
          />
        ) : null}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-(--ui-text-secondary)">
        {number("Max suggestions per run", draft.maxProposals, MAX_PROPOSALS_LIMIT, "maxProposals")}
        {number("Pause at open suggestions", draft.maxOpen, MAX_OPEN_LIMIT, "maxOpen")}
        <label className="flex cursor-pointer items-center gap-1.5">
          <Checkbox
            checked={draft.autoStart}
            onChange={(event) => update("autoStart", event.target.checked)}
          />
          {t("Start suggestions automatically")}
        </label>
        <AutoMergeField
          checked={draft.autoMerge}
          onChange={(checked) => update("autoMerge", checked)}
        />
        {draft.autoStart ? (
          <span role="status" className="text-[11px] text-(--ui-tone-warning-fg)">
            {t("Suggestions will run without you reviewing the idea first.")}
            {draft.autoMerge ? "" : t(" Each still waits for your review before it is merged.")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
