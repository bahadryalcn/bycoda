import {
  rebuildClosedRoomPrivacyProjection,
  getRoomPrivacyStatus,
  isRoomPrivacyRecoveryPending,
  retryRoomPrivacyProjection,
  subscribeRoomPrivacyStatus,
} from "../../group-lock/model/roomPrivacyProjection";
import { isTauri } from "@tauri-apps/api/core";
import { isAppQuitting } from "../../../app/model/appLifecycle";
import {
  beginAssistantDraftOperation,
  registerAssistantDraftFlusher,
} from "../model/assistantDraftFlush";
import {
  assistantNativeHeldIntent,
  preserveAssistantDraft,
  readAssistantDraftBackup,
  readAssistantDraftBackups,
  readAssistantNativeDraft,
  readAssistantNativeHeldIntent,
  reconcileAssistantNative,
  sendAssistantNative,
  writeAssistantNativeDraft,
  type AssistantDraftBackup,
} from "../model/assistantNativeSend";
import { AssistantResponseValidationSchema } from "../../../shared/model/host-contracts/assistant";
import { formatBytes } from "../../../shared/i18n/format";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import { AssistantMemoryPanel } from "./AssistantMemoryPanel";
import { AssistantRemoteAccess } from "./AssistantRemoteAccess";
import { useAssistantControlSource } from "../model/useAssistantControlSource";
import { MemoryEditor } from "./MemoryEditor";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import sessionStyles from "./AssistantSessions.module.css";
import { AssistantSettings } from "./AssistantSettings";
import { AssistantHistory } from "./AssistantHistory";
import { AssistantNotificationRecovery } from "./AssistantNotificationRecovery";
import historyStyles from "./AssistantHistory.module.css";
import { AssistantNoteCard } from "./AssistantNoteCard";
import noteStyles from "./AssistantNoteCard.module.css";
import type {
  AssistantJob,
  AssistantMemory,
  AssistantMessage,
  AssistantNote,
  AssistantRequest,
  AssistantSnapshot,
  AssistantTrash,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Badge } from "../../../shared/ui/Badge";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { ConfirmDialog, type ConfirmRequest } from "../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Popover } from "../../../shared/ui/Popover";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import {
  MoreHorizontal,
  Settings,
  Square,
  Trash2,
  RefreshCw,
  X,
  Plus,
  ChevronDown,
  ArrowUp,
} from "../../../shared/ui/icons";
import {
  assistantIdentity,
  assistantRequest as ownerRequest,
  operationId,
  useAssistantSnapshot,
} from "../model/assistantClient";
import { AssistantKeepAwakeStatus } from "./AssistantKeepAwakeStatus";
import { AssistantPresenceStatus } from "./AssistantPresenceStatus";
import { AssistantBriefingCard } from "./AssistantBriefingCard";
import type { AssistantGoalApprovalTarget } from "../model/assistantBriefing";
import { AssistantSessions } from "./AssistantSessions";
import { ManualSessionSupervision } from "./ManualSessionSupervision";
import { useManualSupervision, visibleAssistantProjects } from "../model/assistantManual";
import { useVisibleProjects } from "../../group-lock/hooks/useGroupLock";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import {
  assistantPrivacyScope,
  canReadAssistantBriefing,
  projectAssistantSnapshot,
  visibleAssistantMessages,
  type AssistantPrivacyScope,
} from "../model/assistantPrivacy";
import {
  AssistantJobBatch,
  assistantJobDraftIdentity,
  assistantQuickDraftIdentity,
  assistantJobDraftVisible,
  assistantJobDraftReady,
  changeAssistantJobDraftKind,
  assistantJobProjectIds,
  assistantJobVisible,
  selectAssistantJobProjects,
  type AssistantJobDraft,
} from "../model/assistantJobs";
import { AssistantQuickNoteFields } from "./AssistantQuickNoteFields";
import { AssistantQuickAutomationFields } from "./AssistantQuickAutomationFields";
import { captureAssistantHostRead } from "../model/assistantHostRead";
import { AssistantNoteDraft } from "../model/assistantNoteDraft";
import {
  verifiedAssistantJobDeleteReview,
  type AssistantJobTasksTarget,
} from "../model/assistantJobDeletion";
import type { AssistantAutomationTarget } from "../model/assistantAutomationReveal";
import { AssistantSetup } from "./AssistantSetup";
import { AssistantOwnerQuestions } from "./AssistantOwnerQuestions";
import {
  hasAssistantSummaryRefresh,
  refreshAssistantSummary,
} from "../model/assistantSummaryRefresh";
import styles from "./AssistantView.module.css";

const tabs = ["Today", "Conversations", "Jobs", "Sessions", "Notes", "History", "Memory"] as const;
type View = (typeof tabs)[number];
type OwnerRequest = typeof ownerRequest;
type Project = { id?: string; path: string; name: string };
export type AssistantViewProps = {
  initialTab?: Lowercase<View> | "settings";
  navigationToken?: number;
  projectPath?: string;
  sessionId?: string;
  projects?: readonly Project[];
  visibleProjectPaths?: readonly string[];
  /** Only pass an identity captured with the displayed Room source. */
  environmentId?: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onOpenGoal?: (target: AssistantGoalApprovalTarget) => void | Promise<void>;
  onOpenAutomation?: (target: AssistantAutomationTarget) => void | Promise<void>;
  onReviewJobTasks?: (target: AssistantJobTasksTarget) => void | Promise<void>;
  onOpenProject?: (path: string) => void | Promise<void>;
  onClose?: () => void;
};
const finished = (job: AssistantJob) => ["done", "failed", "cancelled"].includes(job.status);
function statusLabel(status: AssistantJob["status"]) {
  return t(
    {
      queued: "Queued",
      planning: "Planning",
      running: "Running",
      stalled: "Stalled",
      waiting: "Waiting for you",
      done: "Done",
      failed: "Failed",
      paused: "Paused",
      cancelled: "Cancelled",
    }[status],
  );
}
function jobStatusLabel(job: AssistantJob) {
  return job.kind === "quick" && job.status === "done"
    ? job.quickAction.kind === "note" && job.quickResult?.noteId
      ? t("Note saved")
      : job.quickAction.kind === "automation" && job.quickResult?.automationId
        ? t("Automation created")
        : statusLabel(job.status)
    : statusLabel(job.status);
}
const date = (at: number) => new Date(at).toLocaleString();
const matches = (query: string, ...values: (string | undefined)[]) =>
  !query.trim() ||
  values.some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
type Pending = { key: string; label: string } | null;
type JobDraft = Omit<AssistantJobDraft, "idempotencyKey" | "projectIds"> & {
  projectIds: string[];
  key: string;
};

const jobIntentsKey = "bycoda.assistant.job-intents";
/** Null when storage cannot be read; callers then fall back to the in-memory map. */
function readJobIntents(): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(jobIntentsKey) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return null;
  }
}
/**
 * Read-modify-write of the shared job-intent map: other windows may have added or removed
 * keys since this window last read them, so the mutation applies to the stored map, not to a
 * stale whole-map copy.
 */
function commitJobIntents(
  memory: { current: Record<string, string> },
  mutate: (intents: Record<string, string>) => void,
) {
  const intents = readJobIntents() ?? { ...memory.current };
  mutate(intents);
  memory.current = intents;
  try {
    localStorage.setItem(jobIntentsKey, JSON.stringify(intents));
  } catch {
    /* Keep the current intent in memory. */
  }
  return intents;
}

function draftText(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function AssistantView(props: AssistantViewProps) {
  const roomPrivacy = useSyncExternalStore(
    subscribeRoomPrivacyStatus,
    getRoomPrivacyStatus,
    getRoomPrivacyStatus,
  );
  const locale = useLocale();
  const {
    snapshot: canonicalSnapshot,
    environmentId: snapshotEnvironmentId,
    loading,
    error: readError,
    refresh,
  } = useAssistantSnapshot();
  const environmentId = snapshotEnvironmentId ?? undefined;
  const assistantRequest: OwnerRequest = (input, expectedEnvironmentId = environmentId) => {
    if (!expectedEnvironmentId)
      return Promise.reject(
        new Error(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        ),
      );
    return ownerRequest(input, expectedEnvironmentId);
  };
  const [hostProjects, setHostProjects] = useState<readonly Project[] | null>(null);
  const projectBindingEnvironment = useRef<string | undefined>(undefined);
  const [projectReadError, setProjectReadError] = useState("");
  const projectReadEpoch = useRef(0);
  async function readProjects() {
    const epoch = ++projectReadEpoch.current;
    setProjectReadError("");
    try {
      const owner = await captureAssistantHostRead(props.environmentId ?? environmentId);
      const result = await owner.projects();
      if (epoch === projectReadEpoch.current) {
        projectBindingEnvironment.current = owner.environmentId;
        setHostProjects(result);
      }
    } catch (cause) {
      if (epoch === projectReadEpoch.current)
        setProjectReadError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  useEffect(() => {
    void readProjects();
    return () => {
      projectReadEpoch.current++;
    };
  }, [props.environmentId, environmentId]);
  const boundProjects =
    environmentId && projectBindingEnvironment.current !== environmentId ? null : hostProjects;
  const unlockedProjects = useVisibleProjects(
    boundProjects ?? props.projects ?? [],
    (project) => project.path,
  );
  const projects = visibleAssistantProjects(
    unlockedProjects,
    props.visibleProjectPaths ??
      props.projects?.map((project) => project.path) ??
      (props.projectPath ? [props.projectPath] : []),
  );
  const projectPrivacy = assistantPrivacyScope(boundProjects, projects, canonicalSnapshot);
  const privacy = {
    ...projectPrivacy,
    key: JSON.stringify([environmentId ?? null, props.environmentId ?? null, projectPrivacy.key]),
  };
  const snapshot = projectAssistantSnapshot(canonicalSnapshot, privacy);
  const visibility = useRef({ projects, privacy, canonicalSnapshot });
  visibility.current = { projects, privacy, canonicalSnapshot };
  function canSeeProject(id: string) {
    return visibility.current.projects.some(
      (project) => project.id === id && !isProjectLocked(project.path),
    );
  }
  function canReadBriefing(source?: AssistantSnapshot) {
    const current = visibility.current;
    const candidate = source ?? current.canonicalSnapshot;
    return (
      !!candidate &&
      canReadAssistantBriefing(candidate, current.privacy) &&
      (candidate.briefing?.projectIds ?? []).every(canSeeProject)
    );
  }
  const scopeEpoch = useRef({ key: privacy.key, value: 0 });
  if (scopeEpoch.current.key !== privacy.key)
    scopeEpoch.current = { key: privacy.key, value: scopeEpoch.current.value + 1 };
  const identity = assistantIdentity(snapshot?.profile, locale);
  const [view, setView] = useState<View>("Today");
  const [setup, setSetup] = useState<boolean | "voice">(false);
  const [returnMessage, setReturnMessage] = useState("");
  const [settings, setSettings] = useState(false);
  const [trash, setTrash] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [healthAnchor, setHealthAnchor] = useState<HTMLElement | null>(null);
  const [presenceAnchor, setPresenceAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [jobProjectFilter, setJobProjectFilter] = useState("");
  const [jobDateFilter, setJobDateFilter] = useState("all");
  const [jobEdit, setJobEdit] = useState<{
    job: AssistantJob;
    mode: "priority" | "replan";
    environmentId: string;
    scopeKey: string;
  } | null>(null);
  const [dailySummary, setDailySummary] = useState<{
    snapshot: AssistantSnapshot;
    environmentId: string;
    scopeKey: string;
    day: string;
  } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [errorState, setErrorState] = useState<{
    key: string;
    text: string;
    scopeKey: string;
  } | null>(null);
  const error =
    errorState?.scopeKey === privacy.key
      ? { ...errorState, text: t(errorState.text) }
      : errorState?.key === "pauseAll"
        ? { ...errorState, text: t("The stop request could not be confirmed. Check the Room.") }
        : null;
  function setError(value: { key: string; text: string } | null) {
    setErrorState(value ? { ...value, scopeKey: privacy.key } : null);
  }
  const [confirm, setConfirmState] = useState<ConfirmRequest | null>(null);
  const confirmPrivacy = useRef(privacy.key);
  function setConfirm(request: ConfirmRequest | null) {
    confirmPrivacy.current = privacy.key;
    setConfirmState(request);
  }
  const [undo, setUndo] = useState<{
    id: string;
    label: string;
    projectId?: string;
    projectIds?: string[];
    environmentId?: string;
  } | null>(null);
  const [deletedNoteWithoutReceipt, setDeletedNoteWithoutReceipt] = useState<string | null>(null);
  const [restoredUndoId, setRestoredUndoId] = useState<{
    id: string;
    environmentId?: string;
  } | null>(null);
  useEffect(() => {
    if (!restoredUndoId) return;
    if (
      !undo ||
      undo.id !== restoredUndoId.id ||
      undo.environmentId !== restoredUndoId.environmentId
    ) {
      setRestoredUndoId(null);
      return;
    }
    if (pending?.key === "undo") return;
    setUndo(null);
    setErrorState((current) => (current?.key === "undo" ? null : current));
    setRestoredUndoId(null);
  }, [restoredUndoId, undo, pending?.key]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [jobText, setJobText] = useState(() => draftText("bycoda.assistant.job-draft"));
  const [jobReview, setJobReview] = useState<JobDraft[] | null>(null);
  const jobBatch = useRef<AssistantJobBatch | null>(null);
  const [jobReviewFrozen, setJobReviewFrozen] = useState(false);
  const jobReviewEnvironment = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (jobReview && !jobReviewFrozen)
      try {
        localStorage.setItem(
          "bycoda.assistant.job-review",
          JSON.stringify({ source: jobText, rows: jobReview, frozen: false }),
        );
      } catch {
        /* Save validates durable intent before dispatch. */
      }
  }, [jobReview, jobText, jobReviewFrozen]);
  const jobIntents = useRef<Record<string, string>>(readJobIntents() ?? {});
  useEffect(() => {
    // Another window wrote the map: refresh the in-memory copy so new keys are reused here.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== jobIntentsKey) return;
      jobIntents.current = readJobIntents() ?? jobIntents.current;
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function jobKey(title: string, projectId: string, projectIds: readonly string[] = [projectId]) {
    const source = assistantJobDraftIdentity(title, projectId, projectIds);
    let key = "";
    commitJobIntents(jobIntents, (intents) => {
      key = intents[source] ?? operationId();
      intents[source] = key;
    });
    return key;
  }
  function reviewIntent(draft: JobDraft) {
    return draft.kind === "quick" && draft.quickAction
      ? assistantQuickDraftIdentity(draft.request, draft.title, draft.quickAction)
      : assistantJobDraftIdentity(draft.request, draft.projectId, draft.projectIds);
  }
  const reviewedDraft = (draft: JobDraft): AssistantJobDraft => ({
    ...draft,
    idempotencyKey: draft.key,
  });
  const visibleDraft = (draft: JobDraft) =>
    assistantJobDraftVisible(reviewedDraft(draft), canSeeProject);
  function updateJobDraft(id: string, patch: Partial<JobDraft>) {
    if (jobReviewFrozen || pending) return;
    const row = jobReview?.find((candidate) => candidate.id === id);
    if (!row) return;
    const next = { ...row, ...patch };
    if (next.kind === "quick" && next.quickAction?.kind === "automation") {
      next.projectId = next.quickAction.projectId;
      next.projectIds = next.projectId ? [next.projectId] : [];
    }
    // The intent key is resolved here, outside the state updater, so the updater stays pure.
    const source = reviewIntent(next);
    let key = "";
    commitJobIntents(jobIntents, (intents) => {
      key = intents[source] ?? operationId();
      intents[source] = key;
    });
    next.key = key;
    setJobReview(
      (current) => current?.map((candidate) => (candidate.id === id ? next : candidate)) ?? null,
    );
  }

  const [memoryResults, setMemoryResults] = useState<AssistantMemory[] | null>(null);
  const [memorySearching, setMemorySearching] = useState(false);
  useEffect(() => {
    if (view !== "Memory" || !query.trim()) {
      setMemoryResults(null);
      setMemorySearching(false);
      return;
    }
    let cancelled = false;
    setMemorySearching(true);
    setMemoryResults([]);
    const timer = setTimeout(() => {
      void assistantRequest({ op: "memory.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled) setMemoryResults(result.entries ?? []);
        })
        .catch((cause) => {
          if (!cancelled)
            setError({
              key: "memory.search",
              text: cause instanceof Error ? cause.message : String(cause),
            });
        })
        .finally(() => {
          if (!cancelled) setMemorySearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, query, snapshot?.memory]);
  const memoryEntries = memoryResults ?? snapshot?.memory ?? [];
  const [memoryEdit, setMemoryEdit] = useState<AssistantMemory | "new" | null>(null);
  const [noteEdit, setNoteEdit] = useState<AssistantNote | "new" | null>(null);
  const manual = useManualSupervision(
    snapshot,
    projects,
    snapshot?.profile.setupComplete === true && (view === "Sessions" || settings),
    environmentId,
  );
  const currentProject = projects.find((project) => project.path === props.projectPath);
  const defaultProjectId = currentProject?.id ?? currentProject?.path ?? "";

  useEffect(() => {
    try {
      localStorage.setItem("bycoda.assistant.job-draft", jobText);
    } catch {
      /* The in-memory draft remains available. */
    }
  }, [jobText]);
  useEffect(() => {
    const target = props.initialTab;
    if (target === "settings") setSettings(true);
    else if (target) {
      const match = tabs.find((tab) => tab.toLowerCase() === target);
      if (match) setView(match);
    }
  }, [props.initialTab, props.navigationToken]);
  useEffect(() => {
    const listener = () => setSetup(true);
    window.addEventListener("bycoda:assistant-setup", listener);
    return () => window.removeEventListener("bycoda:assistant-setup", listener);
  }, []);

  async function run(key: string, label: string, action: () => Promise<unknown>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending({ key, label });
    setError(null);
    const epoch = scopeEpoch.current.value;
    try {
      await action();
      return true;
    } catch (cause) {
      if (epoch === scopeEpoch.current.value)
        setError({
          key,
          text: cause instanceof Error ? cause.message : String(cause),
        });
      return false;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }
  const mutate = (key: string, label: string, request: AssistantRequest) =>
    run(key, label, () => assistantRequest(request));
  async function stopEverything() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    setError(null);
    try {
      await assistantRequest({ op: "pauseAll" });
    } catch (cause) {
      setError({ key: "pauseAll", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }
  const onOpenSession = props.onOpenSession
    ? (id: string, sourceEnvironmentId = props.environmentId ?? environmentId) => {
        void run(`navigation:${id}`, t("Opening session..."), async () => {
          if (sourceEnvironmentId) await props.onOpenSession!(id, sourceEnvironmentId);
          else await props.onOpenSession!(id);
        });
      }
    : undefined;

  function returnToAssistant() {
    void run("presence.return", t("Preparing briefing..."), async () => {
      setReturnMessage("");
      await assistantRequest({ op: "presence.set", state: "present" });
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await assistantRequest({ op: "briefing.daily", day });
      const current = (await assistantRequest({ op: "snapshot", limit: 100 })).snapshot;
      if (current && !current.briefing) setReturnMessage(t("Nothing new to report."));
    });
  }

  function control(job: AssistantJob, action: "pause" | "resume" | "stop" | "delete" | "keep") {
    if (!assistantJobVisible(job, canSeeProject)) return;
    if (action === "keep") {
      void run(job.id, t("Keeping job and tasks..."), async () => {
        const result = await assistantRequest({
          op: "jobs.deleteAbort",
          id: job.id,
          expectedVersion: job.version,
        });
        if (
          !result.job ||
          result.job.id !== job.id ||
          result.job.status !== "paused" ||
          result.job.pendingTaskDeletion ||
          result.job.awaitingOwnerRestart !== true ||
          result.job.projectId !== job.projectId ||
          JSON.stringify(assistantJobProjectIds(result.job)) !==
            JSON.stringify(assistantJobProjectIds(job))
        )
          throw new Error("Job status is unknown. Check the Room before retrying.");
      });
      return;
    }
    if (action === "delete") {
      void run(`deleteReview:${job.id}`, t("Loading..."), async () => {
        const sourcePrivacy = privacy.key;
        let review: ReturnType<typeof verifiedAssistantJobDeleteReview>,
          reviewError = "";
        if (job.kind !== "quick" && job.goalId) {
          try {
            const response = await assistantRequest({
              op: "jobs.deleteReview",
              id: job.id,
              expectedVersion: job.version,
            });
            review = verifiedAssistantJobDeleteReview(job, response.deleteReview, canSeeProject);
            if (!review)
              throw new Error(
                "The task deletion scope could not be verified. You can still delete only the job.",
              );
          } catch (cause) {
            reviewError = cause instanceof Error ? cause.message : String(cause);
          }
        }
        if (
          sourcePrivacy !== visibility.current.privacy.key ||
          !assistantJobVisible(job, canSeeProject)
        )
          return;
        let frozenInput: Extract<AssistantRequest, { op: "jobs.control" }> | undefined;
        setConfirm({
          title: t("Delete job?"),
          message: job.title,
          confirmLabel: (state) =>
            t(state.acknowledged ? "Delete job and tasks" : "Delete job only"),
          acknowledge: review
            ? { label: t("Also delete the reviewed tasks"), defaultChecked: false, required: false }
            : undefined,
          body: review ? (
            <div className={styles.stack}>
              <p>{t("{p0} tasks in the canonical deletion scope", { p0: review.tasks.length })}</p>
              {review.tasks.map((task) => (
                <p key={task.id}>
                  <strong>{task.title}</strong> · {projectName(task.projectId)}
                </p>
              ))}
            </div>
          ) : reviewError ? (
            <InlineError>{t(reviewError)}</InlineError>
          ) : undefined,
          consequences: (state) => [
            t(
              state.acknowledged
                ? "The job and reviewed task metadata stop first and move to Recently deleted. Sessions, branches, worktrees and working files remain."
                : job.kind === "quick"
                  ? "Deleting this job keeps its saved note or automation."
                  : "The job stops first. Tasks, sessions, worktrees and changes remain.",
            ),
            t("You can restore this job from Recently deleted for seven days."),
            ...(state.acknowledged
              ? [
                  t(
                    "Restoring keeps the goal and tasks stopped. Review them in the task board before restarting.",
                  ),
                ]
              : []),
          ],
          onConfirm: async ({ acknowledged }) => {
            if (!assistantJobVisible(job, canSeeProject))
              throw new Error("The selected project is no longer visible.");
            if (acknowledged && !verifiedAssistantJobDeleteReview(job, review, canSeeProject))
              throw new Error(
                "The task deletion scope could not be verified. You can still delete only the job.",
              );
            const input: Extract<AssistantRequest, { op: "jobs.control" }> = {
              op: "jobs.control",
              id: job.id,
              expectedVersion: job.version,
              action,
              ...(acknowledged ? { deleteTasks: true, taskDeleteToken: review!.sourceToken } : {}),
            };
            if (frozenInput && JSON.stringify(input) !== JSON.stringify(frozenInput))
              throw new Error(
                "The deletion is pending. Keep its original task selection while checking its status.",
              );
            frozenInput ??= input;
            try {
              const result = await assistantRequest(frozenInput);
              if (
                !result.job ||
                result.job.id !== job.id ||
                result.job.status !== "cancelled" ||
                result.job.projectId !== job.projectId ||
                JSON.stringify(assistantJobProjectIds(result.job)) !==
                  JSON.stringify(assistantJobProjectIds(job))
              )
                throw new Error("Job status is unknown. Check the Room before retrying.");
            } catch (cause) {
              await refresh();
              throw cause;
            }
            setUndo({
              id: `jobs:${job.id}`,
              label: job.title,
              projectId: job.projectId ?? undefined,
              projectIds: assistantJobProjectIds(job),
              environmentId,
            });
          },
        });
      });
    } else
      void mutate(
        job.id,
        t(action === "stop" ? "Stopping..." : action === "pause" ? "Pausing..." : "Resuming..."),
        {
          op: "jobs.control",
          id: job.id,
          expectedVersion: job.version,
          action,
        },
      );
  }
  function reviewJobTasks(job: AssistantJob) {
    void run(`tasks:${job.id}`, t("Loading..."), async () => {
      if (
        job.kind === "quick" ||
        !job.goalId ||
        !environmentId ||
        !assistantJobVisible(job, canSeeProject) ||
        !props.onReviewJobTasks
      )
        throw new Error("The selected project is no longer visible.");
      await props.onReviewJobTasks({
        jobId: job.id,
        goalId: job.goalId,
        projectId: job.projectId,
        projectIds: assistantJobProjectIds(job),
        environmentId,
      });
    });
  }
  async function submitJobs() {
    if (!jobReview?.length) return;
    const sourceEnvironment = jobReviewFrozen ? jobReviewEnvironment.current : environmentId;
    setJobReviewFrozen(true);
    jobReviewEnvironment.current = sourceEnvironment;
    if (!jobBatch.current)
      jobBatch.current = new AssistantJobBatch(async (request) => {
        if (request.op === "jobs.create") {
          if (request.kind !== "quick" && !assistantJobVisible(request, canSeeProject))
            throw new Error("The selected project is no longer visible.");
          if (
            request.kind === "quick" &&
            (request.quickAction.kind === "note"
              ? visibility.current.canonicalSnapshot?.capabilities.quickNotes !== true
              : visibility.current.canonicalSnapshot?.capabilities.quickAutomations !== true ||
                !canSeeProject(request.quickAction.projectId))
          )
            throw new Error(
              request.quickAction.kind === "note"
                ? "Quick note jobs are unavailable on this Host."
                : "Quick automation jobs are unavailable for this project.",
            );
        }
        if (!sourceEnvironment)
          throw new Error(
            "The original Host could not be verified. Keep this draft and reconnect its original computer.",
          );
        return ownerRequest(request, sourceEnvironment);
      });
    const result = await run("jobs.create", t("Starting jobs..."), async () => {
      localStorage.setItem(
        "bycoda.assistant.job-review",
        JSON.stringify({
          source: jobText,
          rows: jobReview,
          frozen: true,
          environmentId: sourceEnvironment,
        }),
      );
      if (!sourceEnvironment)
        throw new Error(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        );
      if (!jobReview.every(visibleDraft))
        throw new Error("The selected project is no longer visible.");
      await jobBatch.current!.start(jobReview.map(reviewedDraft));
      await refresh();
    });
    if (result) {
      localStorage.removeItem("bycoda.assistant.job-review");
      commitJobIntents(jobIntents, (intents) => {
        for (const draft of jobReview) delete intents[reviewIntent(draft)];
      });
      jobBatch.current = null;
      jobReviewEnvironment.current = undefined;
      setJobReviewFrozen(false);
      setJobReview(null);
      setJobText("");
    }
  }
  function bulk(action: "stop" | "delete") {
    if (!snapshot) return;
    const jobs = snapshot.jobs.filter((job) => selected.has(job.id));
    const execute = async () => {
      for (const job of jobs)
        if (assistantJobVisible(job, canSeeProject))
          await assistantRequest({
            op: "jobs.control",
            id: job.id,
            expectedVersion: job.version,
            action,
          });
      setSelected(new Set());
    };
    if (action === "delete")
      setConfirm({
        title: t("Delete selected jobs?"),
        message: t("The selected jobs stop first. Tasks, sessions and worktrees remain."),
        confirmLabel: t("Delete"),
        onConfirm: execute,
      });
    else void run("bulk", t("Stopping..."), execute);
  }
  const openJob = snapshot?.jobs.find((job) => job.id === detail);
  const visibleSelectedCount = snapshot?.jobs.filter((job) => selected.has(job.id)).length ?? 0;
  const jobDraftVisible =
    !jobReview ||
    jobReview.every(
      (draft) => (draft.kind !== "quick" && !draft.projectIds.length) || visibleDraft(draft),
    );
  const reviewHasAutomation = !!jobReview?.some(
    (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
  );
  const active = snapshot?.jobs.filter((job) => !finished(job)) ?? [];
  const workingJobs = active.filter((job) =>
    ["planning", "running", "stalled"].includes(job.status),
  );
  const allJobs = (view === "Today" ? active : (snapshot?.jobs ?? [])).filter(
    (job) =>
      matches(query, job.title, job.request, job.summary) &&
      (!filter || job.status === filter) &&
      (view !== "Jobs" ||
        ((!jobProjectFilter || assistantJobProjectIds(job).includes(jobProjectFilter)) &&
          (jobDateFilter === "all" ||
            job.createdAt >=
              (jobDateFilter === "today"
                ? new Date().setHours(0, 0, 0, 0)
                : Date.now() - 7 * 86400000)))),
  );
  const projectName = (id: string) =>
    projects.find((project) => (project.id ?? project.path) === id)?.name ??
    t("Project unavailable");
  const errorFor = (key: string) =>
    error?.key === key ? <InlineError className={styles.error}>{error.text}</InlineError> : null;
  const empty = (text: string) => <p className={styles.empty}>{t(text)}</p>;
  function clearHistory() {
    setConfirm({
      title: t("Clear history?"),
      message: t("Your activity records move to Recently deleted. Running work is unaffected."),
      confirmLabel: t("Clear"),
      onConfirm: async () => {
        await assistantRequest({ op: "activity.clear" });
      },
    });
  }

  return (
    <main className={styles.room} aria-label={identity.room}>
      <LiveText
        className="sr-only"
        mode="assertive"
        text={error?.text || readError || projectReadError || ""}
      />
      <LiveText
        className="sr-only"
        text={
          pending?.label ||
          returnMessage ||
          (undo
            ? `${t("Deleted")}: ${undo.label}`
            : deletedNoteWithoutReceipt
              ? `${t("Deleted")}: ${deletedNoteWithoutReceipt}`
              : "")
        }
      />
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{identity.name || identity.title}</h1>
          {snapshot?.profile.setupComplete && (
            <Button
              variant="ghost"
              label={t("Assistant status")}
              onClick={(event) => setHealthAnchor(event.currentTarget)}
            >
              {snapshot.paused
                ? t("Paused")
                : workingJobs.length
                  ? t("Working")
                  : snapshot.usage.mode === "report"
                    ? t("Report only")
                    : active.some((job) => job.status === "waiting")
                      ? t("Waiting for you")
                      : t("Ready")}
              <ChevronDown className="icon-xs" />
            </Button>
          )}
        </div>
        <div className={styles.toolbar}>
          {snapshot?.profile.setupComplete && (
            <>
              <Button
                variant="ghost"
                label={t("Presence")}
                onClick={(event) => setPresenceAnchor(event.currentTarget)}
              >
                <AssistantPresenceStatus
                  snapshot={snapshot}
                  compact
                  unconfirmed={Boolean(
                    readError ||
                    pending?.key.startsWith("presence") ||
                    error?.key.startsWith("presence"),
                  )}
                />
                <ChevronDown className="icon-xs" />
              </Button>
              <Button
                iconOnly
                label={t(snapshot.paused ? "Resume work" : "Stop everything")}
                tooltip={t(snapshot.paused ? "Resume work" : "Stop everything")}
                tone={snapshot.paused ? "neutral" : "danger"}
                disabled={snapshot.paused && Boolean(pending)}
                loading={stopping || pending?.key === "pauseAll"}
                onClick={() =>
                  snapshot.paused
                    ? void mutate("pauseAll", t("Updating..."), { op: "resumeAll" })
                    : void stopEverything()
                }
              >
                <Square className="icon-sm" />
              </Button>
            </>
          )}
          <Button
            iconOnly
            label={t("Settings")}
            onClick={() => setSettings(true)}
            disabled={!snapshot}
          >
            <Settings className="icon-md" />
          </Button>
          <Button
            iconOnly
            label={t("More options")}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(event) => setMenu(event.currentTarget)}
          >
            <MoreHorizontal className="icon-md" />
          </Button>
          {props.onClose && (
            <Button iconOnly label={t("Close")} onClick={props.onClose}>
              <X className="icon-md" />
            </Button>
          )}
        </div>
      </header>
      {menu && (
        <DropdownMenu
          anchor={menu}
          label={t("Room options")}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "trash") setTrash(true);
            else if (id === "refresh") void refresh();
            else setSetup(true);
          }}
          items={[
            {
              kind: "item",
              id: "refresh",
              label: t("Refresh"),
              icon: <RefreshCw className="icon-sm" />,
              disabled: loading,
            },
            {
              kind: "item",
              id: "trash",
              label: t("Recently deleted"),
              icon: <Trash2 className="icon-sm" />,
            },
            { kind: "item", id: "setup", label: t("Run setup again") },
          ]}
        />
      )}
      {roomPrivacy.pending && (
        <InlineMessage className={styles.feedbackInline} tone="info">
          {t("Confirming Room privacy protection...")}
        </InlineMessage>
      )}
      {roomPrivacy.error && (
        <InlineError
          className={styles.feedbackInline}
          retry={{ onRetry: retryRoomPrivacyProjection }}
        >
          {t("Room privacy protection could not be confirmed.")}
        </InlineError>
      )}
      {roomPrivacy.error &&
        (roomPrivacy.error === "Privacy lock state is unavailable" ||
          isRoomPrivacyRecoveryPending()) && (
          <div className={styles.feedback}>
            <InlineMessage tone="info">
              {t("Review current project visibility before rebuilding Room privacy protection.")}
            </InlineMessage>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void rebuildClosedRoomPrivacyProjection().catch(() => {});
              }}
            >
              {t("Rebuild Room privacy protection")}
            </Button>
          </div>
        )}
      {readError && (
        <InlineError
          className={styles.feedback}
          retry={{ onRetry: () => void refresh(), pending: loading }}
        >
          {readError}
        </InlineError>
      )}
      {projectReadError && (
        <InlineError className={styles.feedback} retry={{ onRetry: () => void readProjects() }}>
          {t(projectReadError)}
        </InlineError>
      )}
      {error?.key.startsWith("navigation:") && (
        <InlineError className={styles.feedback}>{error.text}</InlineError>
      )}
      {!snapshot ? (
        <div className={styles.empty}>
          {loading ? t("Loading...") : t("Connect to the local Host to open this room.")}
        </div>
      ) : !snapshot.profile.setupComplete ? (
        <section className={styles.setupPrompt}>
          <h2>{t("Set up your personal assistant")}</h2>
          <p>{t("Choose a name, working permissions and a daily budget before starting.")}</p>
          <Button variant="primary" onClick={() => setSetup(true)}>
            {t("Set up")}
          </Button>
        </section>
      ) : (
        <>
          {healthAnchor && (
            <Popover
              anchor={healthAnchor}
              onDismiss={() => setHealthAnchor(null)}
              kind="dialog"
              aria-label={t("Assistant status")}
            >
              <div className={styles.healthDetails}>
                <AssistantPresenceStatus snapshot={snapshot} details />
                <p>
                  {snapshot.lastHeartbeatAt
                    ? t("Last checked: {p0}", { p0: date(snapshot.lastHeartbeatAt) })
                    : t("Waiting for the first check")}
                </p>
                <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
                <Button
                  variant="link"
                  onClick={() => {
                    setHealthAnchor(null);
                    setSettings(true);
                  }}
                >
                  {t(snapshot.usage.estimated ? "About {p0} tokens today" : "{p0} tokens today", {
                    p0: snapshot.usage.total.toLocaleString(),
                  })}
                </Button>
                <p>{t("Work tracking continues while voice is off.")}</p>
              </div>
            </Popover>
          )}
          {presenceAnchor && (
            <Popover
              anchor={presenceAnchor}
              onDismiss={() => setPresenceAnchor(null)}
              kind="dialog"
              aria-label={t("Presence")}
            >
              <div className={styles.healthDetails}>
                <Select
                  label={t("Presence")}
                  value={snapshot.presence.state}
                  options={[
                    ["present", "I'm here"],
                    ["away", "Away"],
                    ["dnd", "Do not disturb"],
                    ["idle", "Idle"],
                  ].map(([value, label]) => ({ value, label: t(label) }))}
                  disabled={Boolean(pending)}
                  onValueChange={(state) =>
                    void mutate("presence", t("Updating..."), {
                      op: "presence.set",
                      state: state as "present" | "away" | "dnd" | "idle",
                    })
                  }
                />
                <Button
                  disabled={Boolean(pending)}
                  loading={pending?.key === "presence.return"}
                  onClick={returnToAssistant}
                >
                  {t("I'm back")}
                </Button>
              </div>
            </Popover>
          )}
          {errorFor("presence")}
          {errorFor("presence.return")}
          {returnMessage && <p className={styles.muted}>{returnMessage}</p>}
          {errorFor("pauseAll")}
          {snapshot.chiefReview?.blocked && (
            <div className={styles.feedback}>
              <span>
                <strong>{t("Supervisor review needs attention")}</strong> ·{" "}
                {snapshot.chiefReview.message}
              </span>
              <Button
                disabled={Boolean(pending)}
                loading={pending?.key === "chief.retry"}
                onClick={() =>
                  snapshot.profile.autonomy === "chief"
                    ? void mutate("chief.retry", t("Updating..."), { op: "chief.retry" })
                    : setSettings(true)
                }
              >
                {t(snapshot.profile.autonomy === "chief" ? "Retry review" : "Settings")}
              </Button>
            </div>
          )}
          {errorFor("chief.retry")}
          <div className={styles.tabRow}>
            <TabStrip
              label={t("Room sections")}
              value={view}
              onValueChange={(value) => {
                setView(value);
                setQuery("");
                setFilter("");
              }}
              controls="assistant-content"
              items={tabs.map((value) => ({
                value,
                label: t(value),
                count: value === "Jobs" ? active.length || null : null,
              }))}
            />
          </div>
          <section
            id="assistant-content"
            className={`${styles.content} ${view === "Sessions" ? sessionStyles.workspace : ""} ${view === "History" ? historyStyles.workspace : ""} ${view === "Notes" ? noteStyles.page : ""}`}
            data-view={view}
            aria-label={t(view)}
          >
            {(view === "Today" || view === "Jobs") && snapshot.workHoursActive === false && (
              <p className={styles.muted}>
                {t("Outside working hours. Accepted turns can finish; new work waits.")}
              </p>
            )}
            {view === "History" && (
              <header className={historyStyles.heading}>
                <h2>{t("History")}</h2>
                <span>{snapshot.activity.length}</span>
              </header>
            )}
            {view === "Sessions" && (
              <div className={sessionStyles.pageHeading}>
                <h2>{t("Sessions")}</h2>
                <p>{t("Follow assistant jobs and manage supervision of your conversations.")}</p>
              </div>
            )}
            {view !== "Today" && view !== "Memory" && (
              <div
                className={`${styles.collectionTools} ${view === "Notes" ? noteStyles.toolbar : ""}`}
              >
                {view === "Notes" && (
                  <h2>
                    {t("Notes")}{" "}
                    <span>
                      {
                        snapshot.notes.filter((note) => matches(query, note.title, note.body))
                          .length
                      }
                    </span>
                  </h2>
                )}
                {view === "Jobs" && (
                  <h2 className={styles.jobsTitle}>
                    {t("Jobs")} <span>{allJobs.length}</span>
                  </h2>
                )}
                <SearchInput
                  type="search"
                  value={query}
                  aria-label={t("Search this section")}
                  placeholder={t(view === "Sessions" ? "Search sessions" : "Search")}
                  appearance={
                    view === "Sessions" || view === "History" || view === "Notes"
                      ? "field"
                      : undefined
                  }
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
                {view === "Notes" && (
                  <>
                    <Button
                      loading={pending?.key === "notes.summary"}
                      disabled={Boolean(pending) || !environmentId}
                      onClick={() => {
                        const sourceEnvironment = environmentId,
                          scopeKey = privacy.key;
                        const now = new Date(),
                          day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                        void run("notes.summary", t("Preparing briefing..."), async () => {
                          if (!sourceEnvironment)
                            throw new Error(
                              "The original Host could not be verified. Keep this draft and reconnect its original computer.",
                            );
                          const response = await assistantRequest(
                            { op: "briefing.daily", day },
                            sourceEnvironment,
                          );
                          if (scopeKey !== visibility.current.privacy.key) return;
                          if (!response.snapshot)
                            throw new Error(
                              "Daily summary was not confirmed. Retry on its original computer.",
                            );
                          setDailySummary({
                            snapshot: response.snapshot,
                            environmentId: sourceEnvironment,
                            scopeKey,
                            day,
                          });
                        });
                      }}
                    >
                      {t("Summarize today")}
                    </Button>
                    <Button
                      variant="primary"
                      startIcon={<Plus className="icon-sm" />}
                      disabled={!snapshot.capabilities.notes}
                      onClick={() => setNoteEdit("new")}
                    >
                      {t("New note")}
                    </Button>
                  </>
                )}
                {view === "History" && (
                  <Button disabled={!snapshot.activity.length} onClick={clearHistory}>
                    {t("Clear history")}
                  </Button>
                )}
                {["Jobs", "History", "Sessions"].includes(view) && (
                  <FilterTrigger
                    label={t("Filter")}
                    activeCount={
                      (filter ? 1 : 0) +
                      (view === "Jobs"
                        ? (jobProjectFilter ? 1 : 0) + (jobDateFilter !== "all" ? 1 : 0)
                        : 0)
                    }
                    onReset={() => {
                      setFilter("");
                      if (view === "Jobs") {
                        setJobProjectFilter("");
                        setJobDateFilter("all");
                      }
                    }}
                    onClick={(event) => setFilterAnchor(event.currentTarget)}
                  />
                )}
              </div>
            )}
            {filterAnchor && (
              <Popover
                anchor={filterAnchor}
                onDismiss={() => setFilterAnchor(null)}
                kind="dialog"
                aria-label={t("Filter")}
              >
                <div className={styles.filter}>
                  <Select
                    label={t("Status or type")}
                    value={filter}
                    options={[
                      { value: "", label: t("All") },
                      ...(view === "History"
                        ? [...new Set(snapshot.activity.map((item) => item.kind))].map((value) => ({
                            value,
                            label: t(value),
                          }))
                        : [...new Set(snapshot.jobs.map((job) => job.status))].map((value) => ({
                            value,
                            label: statusLabel(value),
                          }))),
                    ]}
                    onValueChange={setFilter}
                  />
                  {view === "Jobs" && (
                    <>
                      <SearchableSelect
                        label={t("Project")}
                        value={jobProjectFilter}
                        options={[
                          { value: "", label: t("All projects") },
                          ...projects.map((project) => ({
                            value: project.id ?? project.path,
                            label: project.name,
                          })),
                        ]}
                        onChange={setJobProjectFilter}
                      />
                      <Select
                        label={t("Created")}
                        value={jobDateFilter}
                        options={[
                          { value: "all", label: t("All dates") },
                          { value: "today", label: t("Today") },
                          { value: "week", label: t("Last 7 days") },
                        ]}
                        onValueChange={setJobDateFilter}
                      />
                    </>
                  )}
                  <Button
                    onClick={() => {
                      setFilter("");
                      if (view === "Jobs") {
                        setJobProjectFilter("");
                        setJobDateFilter("all");
                      }
                      setFilterAnchor(null);
                    }}
                  >
                    {t("Reset")}
                  </Button>
                </div>
              </Popover>
            )}
            {view === "Today" && environmentId && (
              <>
                <AssistantOwnerQuestions
                  questions={canonicalSnapshot?.ownerQuestions ?? []}
                  environmentId={environmentId}
                  visibleProjectIds={[...privacy.projectIds]}
                  request={assistantRequest}
                  onChanged={() => {
                    void refresh();
                  }}
                />
              </>
            )}
            {view === "Today" && snapshot.briefing && (
              <AssistantBriefingCard
                snapshot={snapshot}
                environmentId={props.environmentId ?? environmentId}
                privacyKey={privacy.key}
                canSeeProject={canSeeProject}
                canReadBriefing={canReadBriefing}
                onDismiss={() =>
                  assistantRequest({ op: "briefing.dismiss", id: snapshot.briefing!.id }).then(
                    () => undefined,
                  )
                }
                onOpenNotes={() => setView("Notes")}
                onOpenSession={props.onOpenSession}
                onOpenGoal={props.onOpenGoal}
                onSetupVoice={() => setSetup("voice")}
                onChooseLanguage={() => setSettings(true)}
              />
            )}
            {(view === "Today" || view === "Jobs") && (
              <section className={`${styles.section} ${styles.jobsSection}`}>
                <div className={styles.jobInput}>
                  <TextareaField
                    label={t("Give {p0} a job", { p0: identity.name })}
                    value={jobDraftVisible ? jobText : ""}
                    disabled={!jobDraftVisible}
                    minRows={view === "Jobs" ? 3 : 1}
                    autosize
                    maxRows={6}
                    maxLength={16000}
                    placeholder={t("One request per line")}
                    onChange={(event) => setJobText(event.currentTarget.value)}
                  />
                  <div className={styles.jobComposerActions}>
                    {view === "Jobs" && (
                      <span className={styles.muted}>{t("Review jobs before starting")}</span>
                    )}
                    <Button
                      variant="primary"
                      startIcon={<Plus className="icon-sm" />}
                      disabled={
                        !jobDraftVisible ||
                        !jobText.trim() ||
                        Boolean(pending) ||
                        (!snapshot.capabilities.jobs &&
                          !snapshot.capabilities.quickNotes &&
                          !snapshot.capabilities.quickAutomations)
                      }
                      onClick={() => {
                        try {
                          const saved = JSON.parse(
                            localStorage.getItem("bycoda.assistant.job-review") ?? "null",
                          );
                          if (
                            saved?.source === jobText &&
                            Array.isArray(saved.rows) &&
                            saved.rows.every(
                              (row: JobDraft) =>
                                typeof row.id === "string" &&
                                typeof row.key === "string" &&
                                typeof row.request === "string" &&
                                typeof row.title === "string" &&
                                typeof row.projectId === "string" &&
                                Array.isArray(row.projectIds),
                            )
                          ) {
                            jobBatch.current = null;
                            jobReviewEnvironment.current =
                              typeof saved.environmentId === "string"
                                ? saved.environmentId
                                : undefined;
                            setJobReviewFrozen(saved.frozen === true);
                            setJobReview(saved.rows);
                            return;
                          }
                        } catch {
                          /* Review the retained source text. */
                        }
                        jobBatch.current = null;
                        jobReviewEnvironment.current = undefined;
                        setJobReviewFrozen(false);
                        setJobReview(
                          jobText
                            .split(/\r?\n/)
                            .filter((request) => request.trim())
                            .map((request) => ({
                              id: operationId(),
                              title: request.trim().slice(0, 300),
                              request,
                              projectId: defaultProjectId,
                              projectIds: defaultProjectId ? [defaultProjectId] : [],
                              key: jobKey(request, defaultProjectId),
                            })),
                        );
                      }}
                    >
                      {t("Review jobs")}
                    </Button>
                  </div>
                </div>
                {!jobDraftVisible && (
                  <p className={styles.muted}>{t("The selected project is no longer visible.")}</p>
                )}
                {!snapshot.capabilities.jobs && (
                  <p className={styles.muted}>{t("Job execution is unavailable on this Host.")}</p>
                )}
                <div className={styles.rowHeading}>
                  {allJobs.length > 0 && view === "Today" && <h2>{t("Active jobs")}</h2>}
                  {visibleSelectedCount > 0 && (
                    <div className={styles.toolbar}>
                      <span>{t("{p0} selected", { p0: visibleSelectedCount })}</span>
                      <Button disabled={Boolean(pending)} onClick={() => bulk("stop")}>
                        {t("Stop")}
                      </Button>
                      <Button
                        disabled={Boolean(pending)}
                        tone="danger"
                        onClick={() => bulk("delete")}
                      >
                        {t("Delete")}
                      </Button>
                    </div>
                  )}
                </div>
                {allJobs.length ? (
                  allJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      projectName={assistantJobProjectIds(job).map(projectName).join(" · ")}
                      selected={selected.has(job.id)}
                      busy={pending?.key === job.id}
                      disabled={Boolean(pending)}
                      error={error?.key === job.id ? error.text : ""}
                      onEdit={
                        job.kind !== "quick" && !finished(job) && environmentId
                          ? (mode) =>
                              setJobEdit({ job, mode, environmentId, scopeKey: privacy.key })
                          : undefined
                      }
                      onSelect={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(job.id);
                          else next.delete(job.id);
                          return next;
                        })
                      }
                      onDetails={() => setDetail(job.id)}
                      onControl={(action) => control(job, action)}
                      onReviewTasks={props.onReviewJobTasks ? () => reviewJobTasks(job) : undefined}
                    />
                  ))
                ) : view === "Today" ? null : (
                  <div className={styles.jobsEmpty}>
                    <h3>
                      {t(
                        query || filter || jobProjectFilter || jobDateFilter !== "all"
                          ? "No matching jobs"
                          : "No jobs yet",
                      )}
                    </h3>
                    {query || filter || jobProjectFilter || jobDateFilter !== "all" ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQuery("");
                          setFilter("");
                          setJobProjectFilter("");
                          setJobDateFilter("all");
                        }}
                      >
                        {t("Reset")}
                      </Button>
                    ) : (
                      <p>{t("Give {p0} a job", { p0: identity.name })}</p>
                    )}
                  </div>
                )}
                {errorFor("bulk")}
              </section>
            )}
            {view === "Conversations" && (
              <ConversationPanel
                key={privacy.key}
                request={assistantRequest}
                environmentId={environmentId}
                snapshot={snapshot}
                source={canonicalSnapshot!}
                privacy={privacy}
                canSeeProject={canSeeProject}
                projectId={defaultProjectId}
                projects={projects}
                sessionId={props.sessionId}
                query={query}
                onOpenSession={onOpenSession}
                onJob={setDetail}
              />
            )}
            {view === "Sessions" && (
              <div className={sessionStyles.layout}>
                <AssistantSessions
                  jobs={snapshot.jobs}
                  query={query}
                  filter={filter}
                  environmentId={props.environmentId ?? environmentId}
                  contextSettings={snapshot.profile}
                  projectName={projectName}
                  onOpenSession={onOpenSession}
                  onJobs={() => {
                    setView("Jobs");
                    setQuery("");
                    setFilter("");
                  }}
                  onReset={() => {
                    setQuery("");
                    setFilter("");
                  }}
                />
                <ManualSessionSupervision
                  key={environmentId ?? "unknown"}
                  controller={manual}
                  projects={projects}
                  environmentId={environmentId}
                  query={query}
                  onSettings={() => setSettings(true)}
                  onOpenSession={onOpenSession}
                />
              </div>
            )}
            {view === "Notes" && (
              <section className={styles.section}>
                {errorFor("notes.summary")}
                {dailySummary &&
                  dailySummary.environmentId === environmentId &&
                  dailySummary.scopeKey === privacy.key && (
                    <div className={styles.stack}>
                      {dailySummary.snapshot.briefing && canReadBriefing(dailySummary.snapshot) ? (
                        <>
                          <h3>{t("Daily summary")}</h3>
                          <p className={styles.muted}>
                            {t("Saved daily summary · {p0}", {
                              p0: date(dailySummary.snapshot.briefing.createdAt),
                            })}
                          </p>
                          <p>{dailySummary.snapshot.briefing.text}</p>
                          <p className={styles.muted}>
                            {t("Today's summary is reused after it is generated.")}
                          </p>
                        </>
                      ) : (
                        <p>{t("Nothing new to report.")}</p>
                      )}
                    </div>
                  )}
                {!snapshot.capabilities.notes && (
                  <p className={styles.muted}>{t("Global notes are unavailable on this Host.")}</p>
                )}
                <div className={noteStyles.collection}>
                  {snapshot.notes
                    .filter((note) => matches(query, note.title, note.body))
                    .map((note) => (
                      <AssistantNoteCard
                        key={note.id}
                        note={note}
                        updatedAt={date(note.updatedAt)}
                        onOpen={() => setNoteEdit(note)}
                        actions={
                          <Button
                            iconOnly
                            label={t("Delete note")}
                            onClick={() =>
                              setConfirm({
                                title: t("Delete note?"),
                                message: note.title,
                                confirmLabel: t("Delete"),
                                onConfirm: async () => {
                                  const result = await assistantRequest({
                                    op: "notes.delete",
                                    id: note.id,
                                    expectedUpdatedAt: note.updatedAt,
                                  });
                                  if (result.ok !== true)
                                    throw new Error(
                                      t(
                                        "Note deletion is uncertain. Review the Room before retrying.",
                                      ),
                                    );
                                  if (result.trashId?.startsWith("notetrash:")) {
                                    setDeletedNoteWithoutReceipt(null);
                                    setUndo({
                                      id: result.trashId,
                                      label: note.title,
                                      environmentId,
                                    });
                                  } else {
                                    setUndo(null);
                                    setDeletedNoteWithoutReceipt(note.title);
                                  }
                                },
                              })
                            }
                          >
                            <Trash2 className="icon-sm" />
                          </Button>
                        }
                      />
                    ))}
                </div>
                {snapshot.capabilities.notes &&
                  !snapshot.notes.some((note) => matches(query, note.title, note.body)) &&
                  empty(query ? "No results" : "No notes yet")}
              </section>
            )}
            {view === "History" && (
              <>
                {environmentId && (
                  <AssistantNotificationRecovery
                    key={privacy.key}
                    projects={projects}
                    environmentId={environmentId}
                    request={assistantRequest}
                  />
                )}
                <AssistantHistory
                  filtered={Boolean(query.trim() || filter)}
                  entries={snapshot.activity.filter(
                    (item) =>
                      matches(query, item.summary, item.kind) && (!filter || item.kind === filter),
                  )}
                  onOpenSession={onOpenSession}
                  onJob={setDetail}
                />
              </>
            )}
            {view === "Memory" && (
              <AssistantMemoryPanel
                entries={memoryEntries}
                ruleCount={snapshot.memory.filter((entry) => entry.kind === "rule").length}
                query={query}
                searching={memorySearching}
                pending={Boolean(pending)}
                searchError={errorFor("memory.search")}
                errorFor={errorFor}
                date={date}
                onQuery={setQuery}
                onAdd={() => setMemoryEdit("new")}
                onEdit={setMemoryEdit}
                onToggle={(entry, active) =>
                  void mutate(entry.id, t("Saving..."), {
                    op: "memory.save",
                    id: entry.id,
                    kind: entry.kind,
                    text: entry.text,
                    scope: entry.scope,
                    source: entry.source,
                    quote: entry.quote,
                    forbiddenTerms: entry.forbiddenTerms,
                    expectedVersion: entry.version,
                    active,
                  })
                }
                onDelete={(entry) =>
                  setConfirm({
                    title: t("Delete memory?"),
                    message: entry.text,
                    confirmLabel: t("Delete"),
                    onConfirm: async () => {
                      await assistantRequest({
                        op: "memory.delete",
                        id: entry.id,
                        expectedVersion: entry.version,
                      });
                      setUndo({ id: `memory:${entry.id}`, label: entry.text, environmentId });
                    },
                  })
                }
              />
            )}
          </section>
          {pending && (
            <footer className={styles.footer}>
              <span>{pending.label}</span>
            </footer>
          )}
        </>
      )}
      {undo &&
        undo.environmentId === environmentId &&
        (!undo.projectId ||
          assistantJobVisible(
            { projectId: undo.projectId, projectIds: undo.projectIds },
            canSeeProject,
          )) && (
          <div className={styles.undo}>
            <span>
              {t("Deleted")}: {undo.label}
            </span>
            <Button
              disabled={Boolean(pending)}
              onClick={() =>
                void run("undo", t("Restoring..."), async () => {
                  const result = await assistantRequest(
                    { op: "trash.restore", id: undo.id },
                    undo.environmentId,
                  );
                  if (result.ok !== true)
                    throw new Error(
                      t(
                        "The restore could not be confirmed. Check Recently deleted before retrying.",
                      ),
                    );
                  setUndo(null);
                })
              }
            >
              {t("Undo")}
            </Button>
            <Button iconOnly label={t("Dismiss")} onClick={() => setUndo(null)}>
              <X className="icon-sm" />
            </Button>
            {errorFor("undo")}
          </div>
        )}
      {deletedNoteWithoutReceipt && (
        <div className={styles.undo}>
          <span>
            {t("Deleted")}: {deletedNoteWithoutReceipt}
          </span>
          <Button
            onClick={() => {
              setDeletedNoteWithoutReceipt(null);
              setTrash(true);
            }}
          >
            {t("Recently deleted")}
          </Button>
          <Button iconOnly label={t("Dismiss")} onClick={() => setDeletedNoteWithoutReceipt(null)}>
            <X className="icon-sm" />
          </Button>
        </div>
      )}
      {jobEdit &&
        jobEdit.environmentId === environmentId &&
        jobEdit.scopeKey === privacy.key &&
        assistantJobVisible(jobEdit.job, canSeeProject) && (
          <JobOwnerEditDialog
            key={`${jobEdit.environmentId}:${jobEdit.job.id}:${jobEdit.mode}`}
            job={jobEdit.job}
            mode={jobEdit.mode}
            environmentId={jobEdit.environmentId}
            request={ownerRequest}
            current={() =>
              visibility.current.privacy.key === jobEdit.scopeKey &&
              assistantJobVisible(jobEdit.job, canSeeProject)
            }
            onClose={() => setJobEdit(null)}
            onSaved={() => {
              void refresh();
              setJobEdit(null);
            }}
          />
        )}
      {setup && <AssistantSetup voice={setup === "voice"} onClose={() => setSetup(false)} />}
      {settings && snapshot && (
        <AssistantSettings
          request={assistantRequest}
          environmentId={environmentId}
          snapshot={snapshot}
          manual={manual}
          projects={projects}
          onClose={() => setSettings(false)}
          onSetup={() => {
            setSettings(false);
            setSetup(true);
          }}
        />
      )}
      {trash && snapshot && (
        <TrashPanel
          key={privacy.key}
          request={assistantRequest}
          entries={snapshot.trash}
          onRestored={(id) => setRestoredUndoId({ id, environmentId })}
          onClose={() => setTrash(false)}
        />
      )}
      {memoryEdit && (
        <MemoryEditor
          request={assistantRequest}
          entry={memoryEdit}
          onClose={() => setMemoryEdit(null)}
        />
      )}
      {noteEdit && (
        <NoteEditor
          request={ownerRequest}
          environmentId={environmentId}
          note={noteEdit}
          onSaved={refresh}
          onClose={() => setNoteEdit(null)}
        />
      )}
      {confirm && confirmPrivacy.current === privacy.key && (
        <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
      )}
      {openJob && (
        <Modal
          title={openJob.title}
          context={t("Job details")}
          onClose={() => setDetail(null)}
          placement="end"
          panelStyle={{ inlineSize: "min(560px, 100vw)" }}
          size="md"
          fitViewport
        >
          <div className={`${styles.stack} ${styles.modalBody} ${styles.detail}`}>
            <Badge>{jobStatusLabel(openJob)}</Badge>
            <p className={styles.prewrap}>{openJob.request}</p>
            <p>{openJob.summary}</p>
            {openJob.kind === "quick" && openJob.quickAction.kind === "note" && (
              <>
                <h3>{t("Note title")}</h3>
                <p>{openJob.quickAction.title}</p>
                <h3>{t("Note content")}</h3>
                <p className={styles.prewrap}>{openJob.quickAction.body}</p>
                {openJob.quickResult?.noteId && (
                  <Button
                    loading={pending?.key === `note:${openJob.id}`}
                    disabled={!!pending}
                    onClick={() =>
                      void run(`note:${openJob.id}`, t("Loading..."), async () => {
                        const id = openJob.quickResult?.noteId;
                        if (!id) throw new Error(t("The saved note is no longer available."));
                        const result = await assistantRequest({ op: "notes.get", id });
                        if (!result.note || result.note.id !== id)
                          throw new Error(t("The saved note is no longer available."));
                        setDetail(null);
                        setNoteEdit(result.note);
                      })
                    }
                  >
                    {t("Open saved note")}
                  </Button>
                )}
                {errorFor(`note:${openJob.id}`)}
              </>
            )}
            {openJob.kind !== "quick" && (
              <p>
                {t("Lead project")}: {projectName(openJob.projectId)}
              </p>
            )}
            {openJob.kind === "quick" && openJob.quickAction.kind === "automation" && (
              <>
                <AssistantQuickAutomationFields
                  value={openJob.quickAction}
                  projects={projects.map((project) => ({
                    ...project,
                    id: project.id ?? project.path,
                  }))}
                  disabled
                  onChange={() => undefined}
                />
                {!openJob.quickResult?.automationId && openJob.quickIntent?.automationId && (
                  <p className={styles.muted}>
                    {t(
                      "Automation creation is unconfirmed. Inspect its original target before retrying.",
                    )}{" "}
                    <code>{openJob.quickIntent.automationId}</code>
                  </p>
                )}
                {(openJob.quickResult?.automationId || openJob.quickIntent?.automationId) &&
                  props.onOpenAutomation && (
                    <Button
                      loading={pending?.key === `automation:${openJob.id}`}
                      disabled={!!pending}
                      onClick={() =>
                        void run(`automation:${openJob.id}`, t("Loading..."), async () => {
                          const navigationEpoch = scopeEpoch.current.value,
                            jobId = openJob.id;
                          const id =
                            openJob.quickResult?.automationId ?? openJob.quickIntent?.automationId;
                          if (!id || !environmentId || openJob.quickAction.kind !== "automation")
                            throw new Error(
                              "The linked automation is unavailable on its original computer.",
                            );
                          const owner = await captureAssistantHostRead(environmentId);
                          const rows = await owner.automations();
                          const projectId = openJob.quickAction.projectId;
                          const actual = rows.find(
                            (row) => row.id === id && row.projectId === projectId,
                          );
                          if (!actual || !assistantJobVisible(openJob, canSeeProject))
                            throw new Error(
                              "The linked automation is unavailable on its original computer.",
                            );
                          await props.onOpenAutomation!({
                            id: actual.id,
                            projectId: actual.projectId,
                            environmentId: owner.environmentId,
                          });
                          if (scopeEpoch.current.value === navigationEpoch)
                            setDetail((current) => (current === jobId ? null : current));
                        })
                      }
                    >
                      {t("Open automation")}
                    </Button>
                  )}
                {errorFor(`automation:${openJob.id}`)}
              </>
            )}
            {assistantJobProjectIds(openJob).length > 1 && (
              <div>
                <h3>{t("Participating projects")}</h3>
                <p>{assistantJobProjectIds(openJob).map(projectName).join(" · ")}</p>
              </div>
            )}
            <p>
              {t("{p0} tokens", {
                p0: openJob.tokens.toLocaleString(),
              })}
            </p>
            {openJob.kind !== "quick" && !finished(openJob) && (
              <div className={styles.toolbar}>
                <Button
                  disabled={!!pending || !environmentId}
                  onClick={() =>
                    environmentId &&
                    setJobEdit({
                      job: openJob,
                      mode: "priority",
                      environmentId,
                      scopeKey: privacy.key,
                    })
                  }
                >
                  {t("Priority")}:{" "}
                  {t(
                    ({ low: "Low", normal: "Normal", high: "High" } as const)[
                      openJob.priority ?? "normal"
                    ],
                  )}
                </Button>
                {!finished(openJob) &&
                  openJob.status !== "paused" &&
                  openJob.goalId &&
                  !openJob.pendingTaskDeletion &&
                  !openJob.awaitingOwnerRestart && (
                    <Button
                      disabled={!!pending || !environmentId}
                      onClick={() =>
                        environmentId &&
                        setJobEdit({
                          job: openJob,
                          mode: "replan",
                          environmentId,
                          scopeKey: privacy.key,
                        })
                      }
                    >
                      {t("Replan")}
                    </Button>
                  )}
              </div>
            )}
            <details className={styles.relatedWork}>
              <summary>{t("Related work")}</summary>
              {openJob.goalId && (
                <p>
                  {t("Goal")}:{" "}
                  <Button
                    variant="link"
                    disabled={!props.onReviewJobTasks || !!pending}
                    loading={pending?.key === `tasks:${openJob.id}`}
                    onClick={() => reviewJobTasks(openJob)}
                  >
                    {openJob.goalId}
                  </Button>
                </p>
              )}
              {(openJob.kind !== "quick" || openJob.sessionIds.length > 0) && (
                <h3>{t("Sessions")}</h3>
              )}
              {openJob.sessionIds.map((id) => (
                <Button
                  key={id}
                  variant="link"
                  disabled={!onOpenSession}
                  onClick={() => onOpenSession?.(id)}
                >
                  {id}
                </Button>
              ))}
              {error?.key.startsWith("navigation:") && (
                <InlineError className={styles.error}>{error.text}</InlineError>
              )}
              {(openJob.kind !== "quick" || openJob.taskIds.length > 0) && <h3>{t("Tasks")}</h3>}
              {openJob.taskIds.map((id) => (
                <Button
                  key={id}
                  variant="link"
                  disabled={
                    !props.onReviewJobTasks ||
                    !!pending ||
                    openJob.kind === "quick" ||
                    !openJob.goalId
                  }
                  onClick={() => reviewJobTasks(openJob)}
                >
                  {id}
                </Button>
              ))}
            </details>
            {openJob.awaitingOwnerRestart && (
              <p>
                {t(
                  "Restoring keeps the goal and tasks stopped. Review them in the task board before restarting.",
                )}
              </p>
            )}
            {openJob.awaitingOwnerRestart && props.onReviewJobTasks && (
              <Button
                disabled={!!pending}
                loading={pending?.key === `tasks:${openJob.id}`}
                onClick={() => reviewJobTasks(openJob)}
              >
                {t("Review tasks")}
              </Button>
            )}
            {errorFor(`tasks:${openJob.id}`)}
            {openJob.pendingTaskDeletion && (
              <Button
                disabled={!!pending}
                loading={pending?.key === openJob.id}
                onClick={() => control(openJob, "keep")}
              >
                {t("Keep job and tasks")}
              </Button>
            )}
            <details className={styles.relatedWork}>
              <summary>{t("History")}</summary>

              {snapshot?.activity
                .filter((item) => item.jobId === openJob.id)
                .map((item) => (
                  <p key={item.id}>
                    {date(item.createdAt)} · {item.summary}
                  </p>
                ))}
            </details>
          </div>
        </Modal>
      )}
      {jobReview && jobDraftVisible && (
        <Modal
          title={t("Review jobs")}
          onClose={() => {
            if (!pending) setJobReview(null);
          }}
          size="md"
          fitViewport
          footerStart={
            error?.key === "jobs.create" || reviewHasAutomation ? (
              <div className={styles.reviewFooterNote}>
                {error?.key === "jobs.create" && <InlineError>{error.text}</InlineError>}
                {reviewHasAutomation && (
                  <p className={styles.muted}>
                    {t("This creates a scheduled automation. It does not run it now.")}
                  </p>
                )}
              </div>
            ) : undefined
          }
          footer={
            <ModalActions>
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={() => setJobReview(null)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                loading={pending?.key === "jobs.create"}
                disabled={
                  !jobReview.length ||
                  jobReview.some(
                    (item) =>
                      !assistantJobDraftReady(reviewedDraft(item)) ||
                      !visibleDraft(item) ||
                      (item.kind === "quick" &&
                        (item.quickAction?.kind === "automation"
                          ? snapshot?.capabilities.quickAutomations !== true
                          : snapshot?.capabilities.quickNotes !== true)),
                  )
                }
                onClick={() => void submitJobs()}
              >
                {t(
                  jobReviewFrozen
                    ? "Check and retry"
                    : jobReview.every(
                          (row) => row.kind === "quick" && row.quickAction?.kind === "note",
                        )
                      ? "Save notes"
                      : jobReview.every(
                            (row) => row.kind === "quick" && row.quickAction?.kind === "automation",
                          )
                        ? "Create automations"
                        : "Start",
                )}
              </Button>
            </ModalActions>
          }
        >
          <div className={`${styles.stack} ${styles.modalBody}`}>
            {jobReview.map((draft, index) => (
              <div className={styles.reviewJob} key={draft.id}>
                <div className={styles.reviewJobHead}>
                  <span className={styles.reviewJobTitle}>
                    {t("Request {p0}", { p0: index + 1 })}
                  </span>
                  <div className={styles.reviewJobTools}>
                    <Select
                      label={t("Job type")}
                      value={
                        draft.kind === "quick" && draft.quickAction?.kind === "automation"
                          ? "automation"
                          : (draft.kind ?? "project")
                      }
                      disabled={jobReviewFrozen || !!pending}
                      options={[
                        {
                          value: "project",
                          label: t("Project work"),
                          disabled: !snapshot?.capabilities.jobs,
                        },
                        {
                          value: "quick",
                          label: t("Save personal note"),
                          disabled: snapshot?.capabilities.quickNotes !== true,
                        },
                        {
                          value: "automation",
                          label: t("Create scheduled automation"),
                          disabled: snapshot?.capabilities.quickAutomations !== true,
                        },
                      ]}
                      onValueChange={(kind) => {
                        const next = changeAssistantJobDraftKind(
                          reviewedDraft(draft),
                          kind as "project" | "quick" | "automation",
                        );
                        updateJobDraft(draft.id, {
                          ...next,
                          projectIds: [...(next.projectIds ?? [])],
                        });
                      }}
                    />
                    {jobReview.length > 1 && (
                      <Button
                        iconOnly
                        size="sm"
                        variant="ghost"
                        label={t("Remove request")}
                        tooltip={t("Remove request")}
                        disabled={jobReviewFrozen || Boolean(pending)}
                        onClick={() =>
                          setJobReview((current) => current!.filter((item) => item.id !== draft.id))
                        }
                      >
                        <X className="icon-sm" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
                <TextField
                  label={t("Request {p0}", { p0: index + 1 })}
                  hideLabel
                  value={draft.request}
                  disabled={jobReviewFrozen || !!pending}
                  maxLength={16000}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateJobDraft(draft.id, { request: value, title: value.trim().slice(0, 300) });
                  }}
                />
                {draft.kind === "quick" && draft.quickAction?.kind === "note" ? (
                  <AssistantQuickNoteFields
                    value={draft.quickAction}
                    disabled={jobReviewFrozen || !!pending}
                    onChange={(quickAction) => updateJobDraft(draft.id, { quickAction })}
                  />
                ) : draft.kind === "quick" && draft.quickAction?.kind === "automation" ? (
                  <AssistantQuickAutomationFields
                    value={draft.quickAction}
                    projects={projects.map((project) => ({
                      ...project,
                      id: project.id ?? project.path,
                    }))}
                    disabled={jobReviewFrozen || !!pending}
                    onChange={(quickAction) => updateJobDraft(draft.id, { quickAction })}
                  />
                ) : (
                  <>
                    <SearchableSelect
                      label={t("Participating projects")}
                      visibleLabel
                      multiple
                      showSelectedValues
                      selectionLabels={{ done: t("Done") }}
                      value={draft.projectIds}
                      disabled={jobReviewFrozen || !!pending}
                      options={projects.map((project) => ({
                        value: project.id ?? project.path,
                        label: project.name,
                        description: project.path,
                        disabled:
                          draft.projectIds.length >= 20 &&
                          !draft.projectIds.includes(project.id ?? project.path),
                      }))}
                      onChange={(projectIds) =>
                        updateJobDraft(
                          draft.id,
                          selectAssistantJobProjects(draft.projectId, projectIds),
                        )
                      }
                    />
                    <SearchableSelect
                      visibleLabel
                      label={t("Lead project")}
                      value={draft.projectId}
                      disabled={jobReviewFrozen || !!pending || !draft.projectIds.length}
                      options={projects
                        .filter((project) => draft.projectIds.includes(project.id ?? project.path))
                        .map((project) => ({
                          value: project.id ?? project.path,
                          label: project.name,
                          description: project.path,
                        }))}
                      onChange={(projectId) =>
                        updateJobDraft(
                          draft.id,
                          selectAssistantJobProjects(projectId, draft.projectIds),
                        )
                      }
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </main>
  );
}

type JobOwnerEditInput = Extract<AssistantRequest, { op: "jobs.replan" | "jobs.priority" }>;
type JobOwnerDraft = {
  feedback: string;
  priority: "low" | "normal" | "high";
  intent?: JobOwnerEditInput;
};
const unsavedJobOwnerDrafts = new Map<string, JobOwnerDraft>();
function JobOwnerEditDialog({
  job,
  mode,
  environmentId,
  request,
  current,
  onClose,
  onSaved,
}: {
  job: AssistantJob;
  mode: "priority" | "replan";
  environmentId: string;
  request: OwnerRequest;
  current: () => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId(),
    key = `bycoda.assistant.job-edit:${environmentId}:${job.id}:${mode}`;
  const [draft, setDraft] = useState<JobOwnerDraft>(() => {
    const unsaved = unsavedJobOwnerDrafts.get(key);
    if (unsaved) return unsaved;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved &&
        typeof saved.feedback === "string" &&
        ["low", "normal", "high"].includes(saved.priority) &&
        (!saved.intent || (saved.intent.id === job.id && saved.intent.op === `jobs.${mode}`))
      )
        return saved;
    } catch {
      /* An invalid retained draft grants no action. */
    }
    return { feedback: "", priority: job.kind !== "quick" ? (job.priority ?? "normal") : "normal" };
  });
  const [pending, setPending] = useState(false),
    busy = useRef(false),
    [error, setError] = useState("");
  const [draftStorageError, setDraftStorageError] = useState(() => unsavedJobOwnerDrafts.has(key));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = useRef(current);
  live.current = current;
  function retain(next: typeof draft, requirePersistence = false) {
    if (!requirePersistence) setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      unsavedJobOwnerDrafts.delete(key);
      setDraftStorageError(false);
      if (requirePersistence) setDraft(next);
      return true;
    } catch {
      if (!requirePersistence) unsavedJobOwnerDrafts.set(key, next);
      setDraftStorageError(true);
      return false;
    }
  }
  function verify(next: AssistantJob | undefined) {
    if (
      !alive.current ||
      !live.current() ||
      !next ||
      next.id !== job.id ||
      next.kind === "quick" ||
      next.projectId !== job.projectId ||
      JSON.stringify(assistantJobProjectIds(next)) !== JSON.stringify(assistantJobProjectIds(job))
    )
      throw new Error("The job changed or is outside visible project scope.");
    return next;
  }
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (!live.current()) throw new Error("The selected project is no longer visible.");
      if (draft.intent) {
        const next = verify((await request({ op: "jobs.get", id: job.id }, environmentId)).job);
        if (
          draft.intent.op === "jobs.priority" &&
          next.version > draft.intent.expectedVersion &&
          (next.priority ?? "normal") === draft.intent.priority
        ) {
          localStorage.removeItem(key);
          onSaved();
          return;
        }
        setError(
          t(
            mode === "replan"
              ? "Replan was not confirmed. Review the goal before starting another replan."
              : "Priority change was not confirmed. Review the job before changing it again.",
          ),
        );
        return;
      }
      const input: JobOwnerEditInput =
        mode === "replan"
          ? {
              op: "jobs.replan",
              id: job.id,
              expectedVersion: job.version,
              feedback: draft.feedback.trim(),
            }
          : {
              op: "jobs.priority",
              id: job.id,
              expectedVersion: job.version,
              priority: draft.priority,
            };
      if (input.op === "jobs.replan" && !input.feedback)
        throw new Error("Describe the change before replanning.");
      if (!retain({ ...draft, intent: input }, true))
        throw new Error(
          t(
            "Could not save this request locally. Your draft is kept in this window; retry saving before continuing.",
          ),
        );
      const next = verify((await request(input, environmentId)).job);
      if (
        next.version <= job.version ||
        (input.op === "jobs.priority" && (next.priority ?? "normal") !== input.priority) ||
        (input.op === "jobs.replan" && next.status !== "planning")
      )
        throw new Error("Job status is unknown. Check the Room before retrying.");
      localStorage.removeItem(key);
      onSaved();
    } catch (cause) {
      if (alive.current && live.current())
        setError(cause instanceof Error ? t(cause.message) : String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(mode === "replan" ? "Replan job" : "Job priority")}
      onClose={onClose}
      size="md"
      footer={
        <ModalActions>
          <Button disabled={pending} onClick={onClose}>
            {t("Close")}
          </Button>
          <Button
            form={formId}
            type="submit"
            variant="primary"
            loading={pending}
            disabled={!draft.intent && mode === "replan" && !draft.feedback.trim()}
          >
            {t(draft.intent ? "Check status" : mode === "replan" ? "Replan" : "Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={`${styles.stack} ${styles.modalBody}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p>{job.title}</p>
        {mode === "replan" ? (
          <TextareaField
            label={t("Replan feedback")}
            value={draft.feedback}
            maxLength={3000}
            minRows={5}
            disabled={pending || !!draft.intent}
            onChange={(event) => retain({ ...draft, feedback: event.currentTarget.value })}
          />
        ) : (
          <Select
            label={t("Priority")}
            value={draft.priority}
            disabled={pending || !!draft.intent}
            options={[
              { value: "low", label: t("Low") },
              { value: "normal", label: t("Normal") },
              { value: "high", label: t("High") },
            ]}
            onValueChange={(priority) =>
              retain({ ...draft, priority: priority as typeof draft.priority })
            }
          />
        )}
        <LiveText
          className={styles.muted}
          text={
            draft.intent
              ? t(
                  "This request is retained on its original computer. Check its status before taking another action.",
                )
              : ""
          }
        />
        {error && <InlineError className={styles.error}>{error}</InlineError>}
        {draftStorageError && (
          <InlineError className={styles.error}>
            {t("Could not save this draft. It is kept in this window.")}{" "}
            <Button type="button" onClick={() => retain(draft)}>
              {t("Retry saving")}
            </Button>
          </InlineError>
        )}
      </form>
    </Modal>
  );
}

function JobRow({
  onReviewTasks,
  onEdit,
  job,
  projectName,
  selected,
  busy,
  disabled,
  error,
  onSelect,
  onDetails,
  onControl,
}: {
  onReviewTasks?: () => void;
  onEdit?: (mode: "priority" | "replan") => void;
  job: AssistantJob;
  projectName: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  error: string;
  onSelect: (selected: boolean) => void;
  onDetails: () => void;
  onControl: (action: "pause" | "resume" | "stop" | "delete" | "keep") => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <div className={styles.row} data-selected={selected || undefined}>
      <Checkbox
        aria-label={t("Select {p0}", { p0: job.title })}
        checked={selected}
        onChange={(event) => onSelect(event.currentTarget.checked)}
      />
      <div className={styles.rowText}>
        <Button variant="link" onClick={onDetails}>
          {job.title}
        </Button>
        <p>
          {projectName}
          {job.progress.total > 0 ? ` · ${job.progress.done}/${job.progress.total}` : ""}
        </p>
        {job.summary && <p>{job.summary}</p>}
        {job.dispatchState === "unknown" && (
          <p className={styles.error}>
            {t("Dispatch status unknown. Check the linked goal before retrying.")}
          </p>
        )}
        {error && <InlineError className={styles.error}>{error}</InlineError>}
      </div>
      <Badge
        tone={
          job.status === "failed"
            ? "danger"
            : job.status === "waiting" || job.status === "stalled"
              ? "warning"
              : "neutral"
        }
      >
        {jobStatusLabel(job)}
      </Badge>
      {job.awaitingOwnerRestart && onReviewTasks && (
        <Button disabled={disabled} onClick={onReviewTasks}>
          {t("Review tasks")}
        </Button>
      )}
      {job.pendingTaskDeletion && (
        <Button disabled={disabled} loading={busy} onClick={() => onControl("keep")}>
          {t("Keep job and tasks")}
        </Button>
      )}
      {!finished(job) && !job.pendingTaskDeletion && (
        <Button
          iconOnly
          label={t("Stop job")}
          loading={busy}
          disabled={disabled}
          onClick={() => onControl("stop")}
        >
          <Square className="icon-sm" />
        </Button>
      )}
      <Button
        iconOnly
        label={t("Job actions")}
        disabled={disabled}
        onClick={(event) => setMenu(event.currentTarget)}
      >
        <MoreHorizontal className="icon-md" />
      </Button>
      {menu && (
        <DropdownMenu
          label={t("Job actions")}
          anchor={menu}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "details") onDetails();
            else if (id === "priority" || id === "replan") onEdit?.(id);
            else onControl(id as "pause" | "resume" | "delete");
          }}
          items={[
            { kind: "item", id: "details", label: t("Details") },
            ...(onEdit
              ? [
                  { kind: "item" as const, id: "priority", label: t("Priority") },
                  ...(!finished(job) &&
                  job.status !== "paused" &&
                  job.goalId &&
                  !job.pendingTaskDeletion &&
                  !job.awaitingOwnerRestart
                    ? [{ kind: "item" as const, id: "replan", label: t("Replan") }]
                    : []),
                ]
              : []),
            ...(!finished(job) && !job.pendingTaskDeletion && !job.awaitingOwnerRestart
              ? [
                  {
                    kind: "item" as const,
                    id: job.status === "paused" ? "resume" : "pause",
                    label: t(job.status === "paused" ? "Resume" : "Pause"),
                  },
                ]
              : []),
            { kind: "sep" },
            { kind: "item", id: "delete", label: t("Delete..."), danger: true },
          ]}
        />
      )}
    </div>
  );
}

let unsavedConversationDrafts: Record<string, string> | undefined;
const nativeUnsavedConversationDrafts = new Map<string, string>();
const emptyAssistantMessages: AssistantMessage[] = [];

function ConversationPanel({
  request,
  environmentId,
  snapshot,
  source,
  privacy,
  canSeeProject,
  projectId,
  projects,
  sessionId,
  query,
  onOpenSession,
  onJob,
}: {
  request: OwnerRequest;
  environmentId?: string;
  snapshot: AssistantSnapshot;
  source: AssistantSnapshot;
  privacy: AssistantPrivacyScope;
  canSeeProject: (id: string) => boolean;
  projectId: string;
  projects: readonly Project[];
  sessionId?: string;
  query: string;
  onOpenSession?: (id: string, environmentId?: string) => void | Promise<void>;
  onJob: (id: string) => void;
}) {
  const [assistantRequest] = useState(() => request);
  const [retainedThreadId, setThreadId] = useState(
    snapshot.threads.find((thread) => !thread.projectId)?.id ?? snapshot.threads[0]?.id ?? "",
  );
  const threadId = snapshot.threads.some((thread) => thread.id === retainedThreadId)
    ? retainedThreadId
    : "";
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const currentScope = useRef({ snapshot, source, privacy, canSeeProject, environmentId });
  currentScope.current = { snapshot, source, privacy, canSeeProject, environmentId };
  function threadVisible(id: string) {
    const thread = currentScope.current.snapshot.threads.find((thread) => thread.id === id);
    return !!thread && (!thread.projectId || currentScope.current.canSeeProject(thread.projectId));
  }
  const roomSourceStatus = useAssistantControlSource(
    threadId && threadVisible(threadId) ? threadId : undefined,
    environmentId,
  );
  function messageVisible(message: AssistantMessage) {
    const current = currentScope.current;
    return (
      threadVisible(message.threadId) &&
      visibleAssistantMessages([message], current.source, current.privacy).length === 1
    );
  }
  const [threadUpdates, setThreadUpdates] = useState<Record<string, AssistantThread>>({});
  const threadUpdatesRef = useRef(threadUpdates);
  threadUpdatesRef.current = threadUpdates;
  function newerThread(left: AssistantThread | undefined, right: AssistantThread | undefined) {
    if (!left) return right;
    if (!right) return left;
    return right.version > left.version ||
      (right.version === left.version &&
        (right.summaryState?.updatedAt ?? 0) > (left.summaryState?.updatedAt ?? 0))
      ? right
      : left;
  }
  function currentThreadFor(id: string) {
    return newerThread(
      currentScope.current.snapshot.threads.find((thread) => thread.id === id),
      threadUpdatesRef.current[id],
    );
  }
  function summaryScopeVisible(id: string) {
    const thread = currentThreadFor(id);
    return (
      threadVisible(id) &&
      !!thread &&
      (!thread.summaryProof ||
        thread.summaryProof.projectIds.every(currentScope.current.canSeeProject))
    );
  }
  function mergeThread(
    thread: AssistantThread,
    expectedId: string,
    expectedEnvironment: string | undefined,
  ) {
    if (
      !alive.current ||
      thread.id !== expectedId ||
      currentScope.current.environmentId !== expectedEnvironment ||
      !threadVisible(expectedId)
    )
      return;
    setThreadUpdates((current) => ({
      ...current,
      [expectedId]: newerThread(current[expectedId], thread)!,
    }));
  }
  const initialProject = projects.some((item) => (item.id ?? item.path) === projectId)
    ? projectId
    : (projects[0]?.id ?? projects[0]?.path ?? "");
  const [scope, setScope] = useState("global");
  const [project, setProject] = useState(initialProject);
  const [messages, setMessages] = useState<Record<string, AssistantMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    if (isTauri()) return {};
    if (unsavedConversationDrafts) return { ...unsavedConversationDrafts };
    try {
      return JSON.parse(localStorage.getItem("bycoda.assistant.thread-drafts") ?? "{}");
    } catch {
      return {};
    }
  });
  const draftsRef = useRef(drafts);
  const [initialSavedDrafts] = useState<string | null>(() =>
    unsavedConversationDrafts ? null : JSON.stringify(drafts),
  );
  const savedDrafts = useRef(initialSavedDrafts);
  const maximumDraftTimer = useRef<number | undefined>(undefined);
  const [draftSaveError, setDraftSaveError] = useState(!isTauri() && !!unsavedConversationDrafts);
  const [operationPending, setPending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messageLoadSequence = useRef(0);
  const pending = operationPending || loadingMessages;
  const [clearing, setClearing] = useState(false);
  const [threadMenu, setThreadMenu] = useState<HTMLElement | null>(null);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const summaryPending = useRef(false);
  const [summaryError, setSummaryError] = useState<{ threadId: string; text: string } | null>(null);
  const clearingRef = useRef(false);
  const searchEpoch = useRef(0);
  const [errorState, setErrorState] = useState({ key: privacy.key, text: "" });
  const error = errorState.key === privacy.key ? errorState.text : "";
  function setError(text: string) {
    setErrorState({ key: privacy.key, text });
  }
  const [confirm, setConfirmState] = useState<ConfirmRequest | null>(null);
  const confirmScope = useRef(privacy.key);
  function setConfirm(request: ConfirmRequest | null) {
    confirmScope.current = privacy.key;
    setConfirmState(request);
  }
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const selected = useRef(threadId);
  selected.current = threadId;
  const [initialRequestKeys] = useState<
    Record<string, { text: string; key: string; environmentId?: string; sessionId?: string }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
    } catch {
      return {};
    }
  });
  const requestKey = useRef(initialRequestKeys);
  const nativeSendInFlight = useRef(false);
  const nativeDrafts = useRef(
    new Map<
      string,
      {
        environmentId: string;
        version: number;
        saved: string;
        desired: string;
        pending?: Promise<void>;
      }
    >(),
  );
  const [nativeDraftReady, setNativeDraftReady] = useState("");
  const [nativeDraftDisplayed, setNativeDraftDisplayed] = useState("");
  const nativeDraftKey = JSON.stringify([environmentId, threadId]);
  const [nativeDraftReload, setNativeDraftReload] = useState(0);
  const [draftRecovery, setDraftRecovery] = useState<{
    threadId: string;
    environmentId: string;
    backups: AssistantDraftBackup[];
    selected: string;
    selectedText?: string;
    selectedSavedAt?: number | null;
    revision?: number;
    next?: string;
    loading: boolean;
    error?: string;
  } | null>(null);
  const flushNativeDraft = useCallback(async (id: string) => {
    const state = nativeDrafts.current.get(id);
    if (!state) throw new Error("The draft is still loading.");
    while (state.pending) await state.pending;
    let wrote = false;
    const work = (async () => {
      for (;;) {
        const text = state.desired;
        if (text === state.saved) return;
        const version = await writeAssistantNativeDraft(
          id,
          state.environmentId,
          state.version,
          text,
        );
        state.version = version;
        state.saved = text;
        wrote = true;
      }
    })();
    state.pending = work;
    try {
      await work;
      nativeUnsavedConversationDrafts.delete(JSON.stringify([state.environmentId, id]));
      if (
        wrote &&
        selected.current === id &&
        currentScope.current.environmentId === state.environmentId &&
        nativeUnsavedConversationDrafts.size === 0
      )
        setDraftSaveError(false);
    } catch (error) {
      nativeUnsavedConversationDrafts.set(JSON.stringify([state.environmentId, id]), state.desired);
      setDraftSaveError(true);
      throw error;
    } finally {
      if (state.pending === work) state.pending = undefined;
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const unregister = registerAssistantDraftFlusher(async () => {
      for (const [id, state] of nativeDrafts.current) {
        const key = JSON.stringify([state.environmentId, id]);
        if (!mounted && !state.pending && !nativeUnsavedConversationDrafts.has(key)) continue;
        await flushNativeDraft(id);
      }
      if (nativeUnsavedConversationDrafts.size > 0)
        throw new Error("An assistant draft could not be saved. Recover it before closing.");
    });
    return () => {
      unregister();
      mounted = false;
    };
  }, [flushNativeDraft]);
  useEffect(() => {
    if (!isTauri() || !threadId || !environmentId) {
      setNativeDraftReady("");
      return;
    }
    let active = true;
    const id = threadId;
    const sourceEnvironment = environmentId;
    const previous = nativeDrafts.current.get(id);
    nativeDrafts.current.delete(id);
    setNativeDraftReady("");
    void (async () => {
      if (previous?.pending) await previous.pending;
      return readAssistantNativeDraft(id, sourceEnvironment);
    })()
      .then((stored) => {
        if (!active) return;
        const unsaved = nativeUnsavedConversationDrafts.get(
          JSON.stringify([sourceEnvironment, id]),
        );
        if (unsaved !== undefined && unsaved !== stored.text) {
          draftsRef.current = { ...draftsRef.current, [id]: unsaved };
          setDrafts((current) => ({ ...current, [id]: unsaved }));
          setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
          setDraftSaveError(true);
          return;
        }
        if (unsaved !== undefined)
          nativeUnsavedConversationDrafts.delete(JSON.stringify([sourceEnvironment, id]));
        nativeDrafts.current.set(id, {
          environmentId: sourceEnvironment,
          version: stored.version,
          saved: stored.text,
          desired: stored.text,
        });
        draftsRef.current = { ...draftsRef.current, [id]: stored.text };
        setDrafts((current) => ({ ...current, [id]: stored.text }));
        setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
        setNativeDraftReady(JSON.stringify([sourceEnvironment, id]));
        if (nativeUnsavedConversationDrafts.size === 0) setDraftSaveError(false);
      })
      .catch(() => {
        if (!active) return;
        const unsaved = nativeUnsavedConversationDrafts.get(
          JSON.stringify([sourceEnvironment, id]),
        );
        if (unsaved !== undefined) {
          draftsRef.current = { ...draftsRef.current, [id]: unsaved };
          setDrafts((current) => ({ ...current, [id]: unsaved }));
          setNativeDraftDisplayed(JSON.stringify([sourceEnvironment, id]));
        }
        setDraftSaveError(true);
      });
    return () => {
      active = false;
      const state = nativeDrafts.current.get(id);
      if (state?.environmentId === sourceEnvironment && state.desired !== state.saved)
        void flushNativeDraft(id).catch(() => {});
    };
  }, [threadId, environmentId, nativeDraftReload, flushNativeDraft]);
  useEffect(() => {
    if (!isTauri() || !threadId || !environmentId) return;
    const id = threadId;
    const sourceEnvironment = environmentId;
    const sourcePrivacy = privacy.key;
    let active = true;
    const refresh = () => {
      const state = nativeDrafts.current.get(id);
      if (
        !state ||
        state.environmentId !== sourceEnvironment ||
        state.pending ||
        state.desired !== state.saved
      )
        return;
      const expectedVersion = state.version;
      void readAssistantNativeDraft(id, sourceEnvironment)
        .then((stored) => {
          if (
            !active ||
            nativeDrafts.current.get(id) !== state ||
            state.pending ||
            state.version !== expectedVersion ||
            state.desired !== state.saved ||
            selected.current !== id ||
            currentScope.current.environmentId !== sourceEnvironment ||
            currentScope.current.privacy.key !== sourcePrivacy ||
            !threadVisible(id)
          )
            return;
          state.version = stored.version;
          state.saved = stored.text;
          state.desired = stored.text;
          draftsRef.current = { ...draftsRef.current, [id]: stored.text };
          setDrafts((current) => ({ ...current, [id]: stored.text }));
        })
        .catch(() => {
          if (active) setDraftSaveError(true);
        });
    };
    const unsubscribe = listenWindow<{ scope?: string }>("canonical-store-changed", (event) => {
      if (event.payload?.scope === "assistant-thread-drafts.v2") refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
    };
  }, [threadId, environmentId, privacy.key]);
  const flushDrafts = useCallback(
    (report = true) => {
      if (maximumDraftTimer.current !== undefined) {
        window.clearTimeout(maximumDraftTimer.current);
        maximumDraftTimer.current = undefined;
      }
      const serialized = JSON.stringify(draftsRef.current);
      if (isTauri()) {
        for (const id of nativeDrafts.current.keys()) void flushNativeDraft(id).catch(() => {});
        return;
      }
      if (serialized === savedDrafts.current) return;
      try {
        localStorage.setItem("bycoda.assistant.thread-drafts", serialized);
        savedDrafts.current = serialized;
        unsavedConversationDrafts = undefined;
        if (report) setDraftSaveError(false);
      } catch {
        unsavedConversationDrafts = { ...draftsRef.current };
        if (report) setDraftSaveError(true);
      }
    },
    [flushNativeDraft],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => flushDrafts(), 400);
    maximumDraftTimer.current ??= window.setTimeout(() => flushDrafts(), 2000);
    return () => window.clearTimeout(timer);
  }, [drafts, flushDrafts]);
  useEffect(() => {
    const flush = () => flushDrafts();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flushDrafts(false);
    };
  }, [flushDrafts]);
  useEffect(() => () => flushDrafts(false), [threadId, flushDrafts]);
  async function load(id: string, cursor?: Pick<AssistantMessage, "id" | "createdAt">) {
    const sequence = ++messageLoadSequence.current;
    if (!id || !threadVisible(id)) {
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    setError("");
    try {
      const capturedEnvironment = environmentId;
      const result = await assistantRequest(
        {
          op: "threads.messages",
          threadId: id,
          limit: 100,
          ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id } : {}),
        },
        capturedEnvironment,
      );
      if (
        !alive.current ||
        sequence !== messageLoadSequence.current ||
        currentScope.current.environmentId !== capturedEnvironment ||
        !threadVisible(id)
      )
        return;
      if (result.thread) mergeThread(result.thread, id, environmentId);
      const list = result.messages ?? [];
      setMessages((current) => ({
        ...current,
        [id]: cursor ? [...list, ...(current[id] ?? [])] : list,
      }));
      setHasMore((current) => ({ ...current, [id]: list.length === 100 }));
    } catch (cause) {
      if (sequence === messageLoadSequence.current && selected.current === id && threadVisible(id))
        setError(cause instanceof Error ? t(cause.message) : String(cause));
    } finally {
      if (sequence === messageLoadSequence.current) setLoadingMessages(false);
    }
  }
  useEffect(() => {
    void load(threadId);
  }, [threadId]);
  async function refreshSummary() {
    const target = { threadId, environmentId, privacyKey: privacy.key };
    if (
      !target.threadId ||
      !target.environmentId ||
      summaryPending.current ||
      clearingRef.current ||
      !summaryScopeVisible(target.threadId)
    )
      return;
    const current = () =>
      alive.current &&
      selected.current === target.threadId &&
      currentScope.current.environmentId === target.environmentId &&
      currentScope.current.privacy.key === target.privacyKey &&
      summaryScopeVisible(target.threadId);
    summaryPending.current = true;
    setSummaryRefreshing(true);
    setSummaryError(null);
    try {
      const thread = await refreshAssistantSummary(
        localStorage,
        target.environmentId,
        target.threadId,
        assistantRequest,
        current,
      );
      if (current()) mergeThread(thread, target.threadId, target.environmentId);
    } catch {
      if (current())
        setSummaryError({
          threadId: target.threadId,
          text: t("Summary refresh was not confirmed."),
        });
    } finally {
      summaryPending.current = false;
      if (alive.current) setSummaryRefreshing(false);
    }
  }
  async function open() {
    if (pending || clearingRef.current) return;
    if (scope !== "global" && !canSeeProject(project)) return;
    setPending(true);
    setError("");
    try {
      const result = await assistantRequest({
        op: "threads.open",
        ...(scope !== "global" && project ? { projectId: project } : {}),
      });
      if (result.thread) setThreadId(result.thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  async function loadDraftBackups(
    id: string,
    sourceEnvironment: string,
    after?: string,
    revision?: number,
  ) {
    try {
      const page = await readAssistantDraftBackups(id, sourceEnvironment, after, revision);
      setDraftRecovery((current) => {
        if (!current || current.threadId !== id || current.environmentId !== sourceEnvironment)
          return current;
        const merged = after
          ? [
              ...current.backups,
              ...page.backups.filter(
                (item) => !current.backups.some((old) => old.hash === item.hash),
              ),
            ]
          : page.backups;
        return {
          ...current,
          backups: merged,
          revision: page.revision,
          next: page.next,
          loading: false,
          error: undefined,
        };
      });
    } catch (cause) {
      setDraftRecovery((current) =>
        current && current.threadId === id && current.environmentId === sourceEnvironment
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            }
          : current,
      );
    }
  }
  function openDraftRecovery() {
    if (!threadId || !environmentId || !threadVisible(threadId)) return;
    setDraftRecovery({ threadId, environmentId, backups: [], selected: "", loading: true });
    void loadDraftBackups(threadId, environmentId).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }
  async function selectDraftBackup(hash: string) {
    const recovery = draftRecovery;
    if (!recovery || recovery.loading) return;
    setDraftRecovery({
      ...recovery,
      selected: hash,
      selectedText: undefined,
      selectedSavedAt: undefined,
      loading: true,
      error: undefined,
    });
    try {
      const backup = await readAssistantDraftBackup(
        recovery.threadId,
        recovery.environmentId,
        hash,
      );
      setDraftRecovery((current) =>
        current &&
        current.threadId === recovery.threadId &&
        current.environmentId === recovery.environmentId &&
        current.selected === hash
          ? {
              ...current,
              selectedText: backup.text,
              selectedSavedAt: backup.savedAt,
              loading: false,
            }
          : current,
      );
    } catch (cause) {
      setDraftRecovery((current) =>
        current &&
        current.threadId === recovery.threadId &&
        current.environmentId === recovery.environmentId &&
        current.selected === hash
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            }
          : current,
      );
    }
  }
  async function restoreDraftBackup() {
    if (isAppQuitting()) return;
    const recovery = draftRecovery;
    if (
      !recovery ||
      recovery.selectedText === undefined ||
      recovery.loading ||
      selected.current !== recovery.threadId ||
      currentScope.current.environmentId !== recovery.environmentId ||
      !threadVisible(recovery.threadId)
    )
      return;
    const release = beginAssistantDraftOperation();
    setDraftRecovery({ ...recovery, loading: true, error: undefined });
    try {
      const old = nativeDrafts.current.get(recovery.threadId);
      if (old?.pending) await old.pending;
      const recoveryKey = JSON.stringify([recovery.environmentId, recovery.threadId]);
      const localText =
        nativeDraftDisplayed === recoveryKey
          ? (draftsRef.current[recovery.threadId] ?? "")
          : (nativeUnsavedConversationDrafts.get(recoveryKey) ?? "");
      await preserveAssistantDraft(recovery.threadId, recovery.environmentId, localText);
      const latest = await readAssistantNativeDraft(
        recovery.threadId,
        recovery.environmentId,
        true,
      );
      await preserveAssistantDraft(recovery.threadId, recovery.environmentId, latest.text);
      if (
        selected.current !== recovery.threadId ||
        currentScope.current.environmentId !== recovery.environmentId ||
        !threadVisible(recovery.threadId)
      )
        throw new Error("The original conversation is no longer available.");
      const version = await writeAssistantNativeDraft(
        recovery.threadId,
        recovery.environmentId,
        latest.version,
        recovery.selectedText,
      );
      nativeDrafts.current.set(recovery.threadId, {
        environmentId: recovery.environmentId,
        version,
        saved: recovery.selectedText,
        desired: recovery.selectedText,
      });
      draftsRef.current = { ...draftsRef.current, [recovery.threadId]: recovery.selectedText };
      setDrafts((current) => ({ ...current, [recovery.threadId]: recovery.selectedText! }));
      nativeUnsavedConversationDrafts.delete(
        JSON.stringify([recovery.environmentId, recovery.threadId]),
      );
      setDraftSaveError(nativeUnsavedConversationDrafts.size > 0);
      setNativeDraftReady(JSON.stringify([recovery.environmentId, recovery.threadId]));
      setNativeDraftDisplayed(JSON.stringify([recovery.environmentId, recovery.threadId]));
      setDraftRecovery(null);
    } catch (cause) {
      setDraftRecovery((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            }
          : current,
      );
    } finally {
      release();
    }
  }
  async function checkConversation() {
    if (isAppQuitting()) return;
    const release = beginAssistantDraftOperation();
    const target = threadId;
    try {
      if (isTauri() && environmentId) {
        const intent =
          assistantNativeHeldIntent(target, environmentId) ??
          (await readAssistantNativeHeldIntent(target, environmentId));
        if (
          intent &&
          threadVisible(target) &&
          currentScope.current.environmentId === intent.environmentId
        ) {
          if (nativeDraftReady !== JSON.stringify([intent.environmentId, target]))
            throw new Error("The original draft is unavailable. Recover it before continuing.");
          await flushNativeDraft(target);
          AssistantResponseValidationSchema.parse(
            await reconcileAssistantNative(target, intent.environmentId, intent.key),
          );
          setNativeDraftReload((value) => value + 1);
          await load(target);
          return;
        }
      }
      await load(target);
      if (isTauri() && selected.current === target && error)
        setError(
          t(
            "The original reply remains unconfirmed. Check the original Host before sending again.",
          ),
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      release();
    }
  }
  async function send() {
    if (isAppQuitting()) return;
    if (isTauri()) {
      if (nativeSendInFlight.current) return;
      const target = threadId;
      const text = (drafts[target] ?? "").trim();
      if (
        !text ||
        pending ||
        clearingRef.current ||
        nativeDraftReady !== nativeDraftKey ||
        !threadVisible(target)
      )
        return;
      if (!environmentId) {
        setError(
          t(
            "The original Host could not be verified. Keep this draft and reconnect its original computer.",
          ),
        );
        return;
      }
      const sourceEnvironment = environmentId;
      const key = operationId();
      const sourceSession = scope === "session" ? sessionId : undefined;
      nativeSendInFlight.current = true;
      const release = beginAssistantDraftOperation();
      setPending(true);
      setError("");
      try {
        await flushNativeDraft(target);
        if (
          selected.current !== target ||
          currentScope.current.environmentId !== sourceEnvironment ||
          !threadVisible(target)
        )
          throw new Error(
            "The original conversation is no longer available. Keep the draft before continuing.",
          );
        const draft = nativeDrafts.current.get(target);
        if (!draft || draft.environmentId !== sourceEnvironment)
          throw new Error("The original draft is unavailable.");
        await sendAssistantNative(
          target,
          {
            text,
            key,
            environmentId: sourceEnvironment,
            draftVersion: draft.version,
            ...(sourceSession ? { sessionId: sourceSession } : {}),
          },
          async (response) => {
            if (isAppQuitting())
              throw new Error("The reply is retained for recovery after closing.");
            const reply = AssistantResponseValidationSchema.parse(response);
            if (!reply.messages?.some((message) => message.role === "assistant"))
              throw new Error(
                t("The reply has not been confirmed. Check the conversation before retrying."),
              );
            if (
              selected.current !== target ||
              currentScope.current.environmentId !== sourceEnvironment ||
              !threadVisible(target)
            )
              throw new Error(
                "The original conversation is no longer available. Check it before retrying.",
              );
            setMessages((current) => {
              const existing = current[target] ?? [];
              return {
                ...current,
                [target]: [
                  ...existing,
                  ...reply.messages!.filter(
                    (message) => !existing.some((item) => item.id === message.id),
                  ),
                ],
              };
            });
            const currentDrafts = draftsRef.current;
            const nextDrafts = {
              ...currentDrafts,
              [target]: (currentDrafts[target] ?? "").trim() === text ? "" : currentDrafts[target],
            };
            draftsRef.current = nextDrafts;
            const currentDraft = nativeDrafts.current.get(target);
            if (currentDraft?.environmentId === sourceEnvironment)
              currentDraft.desired = nextDrafts[target] ?? "";
            setDrafts(nextDrafts);
            // A confirmed reply must not clear its send fence until the matching
            // draft update is durable too; otherwise reload could offer it again.
            await flushNativeDraft(target);
            return reply;
          },
          release,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        release();
        nativeSendInFlight.current = false;
        setPending(false);
      }
      return;
    }
    if (!navigator.locks) {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      return;
    }
    try {
      await navigator.locks.request(
        "bycoda.assistant.send-intents",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setError(
              t("The reply has not been confirmed. Check the conversation before retrying."),
            );
            return;
          }
          await sendLocked();
        },
      );
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
    }
  }
  async function sendLocked() {
    const text = (drafts[threadId] ?? "").trim();
    if (!text || pending || clearingRef.current || !threadVisible(threadId)) return;
    let persisted: typeof requestKey.current;
    try {
      persisted = JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
      if (!persisted || typeof persisted !== "object" || Array.isArray(persisted))
        throw new Error("Invalid intents");
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      return;
    }
    requestKey.current = persisted;
    const previous = persisted[threadId];
    // A retained intent may already have reached the Host. Do not dispatch it
    // again merely because the same draft remains visible after an uncertain
    // result; recovery must establish the original outcome first.
    if (previous) {
      setError(t("The reply has not been confirmed. Check the conversation before retrying."));
      return;
    }
    const sourceEnvironment = environmentId;
    if (!sourceEnvironment) {
      setError(
        t(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        ),
      );
      return;
    }
    setPending(true);
    setError("");
    const key = operationId();
    const sourceSession = scope === "session" ? sessionId : undefined;
    requestKey.current[threadId] = {
      text,
      key,
      environmentId: sourceEnvironment,
      ...(sourceSession ? { sessionId: sourceSession } : {}),
    };
    try {
      localStorage.setItem("bycoda.assistant.send-intents", JSON.stringify(requestKey.current));
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      setPending(false);
      return;
    }
    try {
      const result = await assistantRequest(
        {
          op: "threads.send",
          threadId,
          text,
          via: "text",
          idempotencyKey: key,
          ...(sourceSession ? { sessionId: sourceSession } : {}),
        },
        sourceEnvironment,
      );
      if (!result.messages?.some((message) => message.role === "assistant"))
        throw new Error(
          t("The reply has not been confirmed. Check the conversation before retrying."),
        );
      setMessages((current) => {
        const existing = current[threadId] ?? [];
        return {
          ...current,
          [threadId]: [
            ...existing,
            ...result.messages!.filter(
              (message) => !existing.some((item) => item.id === message.id),
            ),
          ],
        };
      });
      const currentDrafts = draftsRef.current;
      const nextDrafts = {
        ...currentDrafts,
        [threadId]: (currentDrafts[threadId] ?? "").trim() === text ? "" : currentDrafts[threadId],
      };
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      flushDrafts();
      delete requestKey.current[threadId];
      try {
        const latest = JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
        if (latest?.[threadId]?.key === key) delete latest[threadId];
        localStorage.setItem("bycoda.assistant.send-intents", JSON.stringify(latest));
      } catch {
        /* A retained receipt remains safe to retry. */
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  const [searchResults, setSearchResults] = useState<AssistantMessage[] | null>(null);
  const [searching, setSearching] = useState(false);
  function clearConversation() {
    const thread = currentThreadFor(threadId);
    if (!thread || pending || clearingRef.current || summaryPending.current) return;
    const target = { id: thread.id, version: thread.version };
    setConfirm({
      title: t("Clear this conversation?"),
      message: t(
        "Move all messages in this conversation to Recently deleted for seven days. The saved summary and your unsent draft stay available.",
      ),
      confirmLabel: t("Clear all messages"),
      pendingLabel: t("Clearing..."),
      onConfirm: async () => {
        if (!threadVisible(target.id)) return;
        if (clearingRef.current) return;
        clearingRef.current = true;
        setClearing(true);
        setError("");
        searchEpoch.current++;
        try {
          const result = await assistantRequest({
            op: "threads.clear",
            threadId: target.id,
            expectedVersion: target.version,
          });
          if (result.thread?.id !== target.id)
            throw new Error(t("The conversation clear was not confirmed. Check before retrying."));
          mergeThread(result.thread, target.id, environmentId);
          setMessages((current) => ({ ...current, [target.id]: [] }));
          setHasMore((current) => ({ ...current, [target.id]: false }));
          setSearchResults((current) =>
            current ? current.filter((message) => message.threadId !== target.id) : current,
          );
        } finally {
          clearingRef.current = false;
          setClearing(false);
        }
      },
    });
  }
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const epoch = searchEpoch.current;
    setSearching(true);
    setSearchResults([]);
    const timer = setTimeout(() => {
      void assistantRequest({ op: "conversations.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled && epoch === searchEpoch.current) setSearchResults(result.messages ?? []);
        })
        .catch((cause) => {
          if (!cancelled && epoch === searchEpoch.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const currentMessages = searchResults ?? messages[threadId] ?? emptyAssistantMessages;
  const visible = useMemo(
    () => visibleAssistantMessages(currentMessages, source, privacy),
    [currentMessages, source, privacy],
  );
  const supported = snapshot.capabilities.conversations;
  const currentThread = newerThread(
    snapshot.threads.find((thread) => thread.id === threadId),
    threadUpdates[threadId],
  );
  const summaryState = currentThread?.summaryState;
  const readySummaryVisible =
    summaryState?.status === "ready" &&
    !!currentThread?.summaryProof &&
    currentThread.summaryProof.projectIds.every(canSeeProject);
  const summaryLabel =
    summaryState?.status === "pending" || summaryState?.status === "working"
      ? t("Updating conversation summary")
      : summaryState?.status === "blocked"
        ? t("Conversation summary is waiting. Check its settings or refresh it.")
        : readySummaryVisible
          ? t("A verified conversation summary is available.")
          : "";
  const locale = useLocale();
  const history = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  useEffect(() => {
    followMessages.current = true;
  }, [threadId, query]);
  const lastMessageId = visible[visible.length - 1]?.id;
  useEffect(() => {
    if (!query && followMessages.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [threadId, query, lastMessageId]);
  const day = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const time = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const messageElements = useMemo(
    () =>
      visible.map((message, index) => (
        <Fragment key={message.id}>
          {(index === 0 || day(visible[index - 1].createdAt) !== day(message.createdAt)) && (
            <div className={styles.dayDivider}>{day(message.createdAt)}</div>
          )}
          <article className={styles.message} key={message.id} data-author={message.role}>
            <div className={styles.messageMeta}>
              <span>{message.role === "user" ? t("You") : snapshot.profile.name}</span>
              <span>{t(message.via === "voice" ? "Voice" : "Text")}</span>
              <time dateTime={isoTimestamp(message.createdAt)} title={date(message.createdAt)}>
                {time(message.createdAt)}
              </time>
              <Button
                iconOnly
                label={t("Delete message")}
                disabled={clearing}
                onClick={() =>
                  setConfirm({
                    title: t("Delete message?"),
                    message: message.text,
                    confirmLabel: t("Delete"),
                    onConfirm: async () => {
                      if (!messageVisible(message)) return;
                      await assistantRequest({
                        op: "messages.delete",
                        id: message.id,
                        expectedVersion: message.version,
                      });
                      setMessages((current) => ({
                        ...current,
                        [message.threadId]: (current[message.threadId] ?? []).filter(
                          (item) => item.id !== message.id,
                        ),
                      }));
                      setSearchResults(
                        (current) => current?.filter((item) => item.id !== message.id) ?? null,
                      );
                    },
                  })
                }
              >
                <Trash2 className="icon-xs" />
              </Button>
            </div>
            {message.ownerQuestionId && (
              <p className={styles.muted}>
                {t(
                  message.ownerQuestionAction === "snooze"
                    ? "Question postponed"
                    : "Answer recorded",
                )}
              </p>
            )}
            <p className={styles.prewrap}>{message.text}</p>
            {!!message.toolActions?.length && (
              <details className={styles.muted}>
                <summary>
                  {t("Recorded actions")} ({message.toolActions.length})
                </summary>
                <ul>
                  {message.toolActions.map((action) => (
                    <li key={action.id}>
                      {action.family} · {action.action} —{" "}
                      {t(action.status === "completed" ? "Completed" : "Outcome unknown")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {message.sessionId && onOpenSession && (
              <Button variant="link" onClick={() => onOpenSession(message.sessionId!)}>
                {t("Open session")}
              </Button>
            )}
            {!!message.jobIds.length && (
              <details className={styles.relatedWork}>
                <summary>
                  {t("Jobs")} ({message.jobIds.length})
                </summary>
                <div className={styles.stack}>
                  {message.jobIds.map((id) => {
                    const job = snapshot.jobs.find((job) => job.id === id);
                    return job ? (
                      <Button key={id} variant="link" onClick={() => onJob(id)}>
                        {job.title}
                      </Button>
                    ) : (
                      <span key={id} className={styles.muted}>
                        {id}
                      </span>
                    );
                  })}
                </div>
              </details>
            )}
          </article>
        </Fragment>
      )),
    [
      visible,
      locale,
      clearing,
      snapshot.profile.name,
      snapshot.jobs,
      onOpenSession,
      onJob,
      privacy.key,
      environmentId,
      assistantRequest,
    ],
  );
  const threadLabel = currentThread?.projectId
    ? (projects.find((project) => (project.id ?? project.path) === currentThread.projectId)?.name ??
      currentThread.projectId)
    : t("Global");
  return (
    <div className={styles.conversations}>
      <aside className={styles.threadList} aria-label={t("Conversations")}>
        <div className={styles.stack}>
          <Select
            label={t("Scope")}
            value={scope}
            disabled={clearing}
            options={[
              ["global", "Global"],
              ["project", "Project"],
              ["session", "Session focus"],
            ].map(([value, label]) => ({ value, label: t(label) }))}
            onValueChange={setScope}
          />
          {scope !== "global" && (
            <SearchableSelect
              label={t("Project")}
              value={projects.some((item) => (item.id ?? item.path) === project) ? project : ""}
              disabled={clearing || summaryRefreshing}
              options={projects.map((item) => ({
                value: item.id ?? item.path,
                label: item.name,
                description: item.path,
              }))}
              onChange={setProject}
            />
          )}
          <Button
            disabled={
              pending ||
              clearing ||
              summaryRefreshing ||
              (scope !== "global" && !project) ||
              (scope === "session" && !sessionId)
            }
            onClick={() => void open()}
          >
            {t("Open conversation")}
          </Button>
        </div>
        {[...snapshot.threads]
          .sort(
            (a, b) =>
              Number(Boolean(a.projectId)) - Number(Boolean(b.projectId)) ||
              b.updatedAt - a.updatedAt,
          )
          .map((thread) => (
            <Button
              key={thread.id}
              variant="item"
              selected={threadId === thread.id}
              disabled={clearing || summaryRefreshing}
              onClick={() => setThreadId(thread.id)}
            >
              <span className={styles.rowText}>
                {thread.projectId
                  ? (projects.find((project) => (project.id ?? project.path) === thread.projectId)
                      ?.name ?? thread.projectId)
                  : t("Global")}
                <span className={styles.muted}>{date(thread.updatedAt)}</span>
              </span>
            </Button>
          ))}
      </aside>
      <div className={styles.transcript}>
        <div className={styles.chatHeader}>
          <div className={styles.chatIdentity}>
            <strong>{snapshot.profile.name}</strong>
            <span className={styles.muted}>{threadLabel}</span>
          </div>
          {threadId && (
            <div className={styles.conversationActions}>
              <AssistantRemoteAccess
                key={`${environmentId ?? ""}:${threadId}`}
                threadId={threadId}
                environmentId={environmentId}
                sourceStatus={roomSourceStatus}
              />
              <Button
                iconOnly
                label={t("Conversation actions")}
                disabled={pending || clearing || summaryRefreshing}
                loading={clearing || summaryRefreshing}
                onClick={(event) => setThreadMenu(event.currentTarget)}
              >
                <MoreHorizontal className="icon-md" />
              </Button>
            </div>
          )}
          {threadMenu && (
            <DropdownMenu
              anchor={threadMenu}
              label={t("Conversation actions")}
              onClose={() => setThreadMenu(null)}
              onPick={(id) => {
                setThreadMenu(null);
                if (id === "summary") void refreshSummary();
                else if (id === "recover-draft") openDraftRecovery();
                else if (id === "clear") clearConversation();
              }}
              items={[
                ...(isTauri()
                  ? [
                      {
                        kind: "item" as const,
                        id: "recover-draft",
                        label: t("Recover draft"),
                        disabled: !environmentId || pending || clearing,
                      },
                    ]
                  : []),
                {
                  kind: "item",
                  id: "summary",
                  label: t(
                    hasAssistantSummaryRefresh(localStorage, environmentId, threadId)
                      ? "Retry summary refresh"
                      : "Refresh conversation summary",
                  ),
                  disabled:
                    pending ||
                    clearing ||
                    summaryRefreshing ||
                    !environmentId ||
                    !summaryScopeVisible(threadId),
                },
                {
                  kind: "item",
                  id: "clear",
                  label: t("Clear conversation..."),
                  danger: true,
                  disabled: pending || clearing || summaryRefreshing,
                },
              ]}
            />
          )}
        </div>
        <div
          className={styles.messageHistory}
          ref={history}
          onScroll={(event) => {
            const node = event.currentTarget;
            followMessages.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
          }}
        >
          {(summaryRefreshing || summaryLabel) && (
            <p className={styles.muted}>
              {summaryRefreshing ? t("Updating conversation summary") : summaryLabel}
            </p>
          )}
          {summaryError?.threadId === threadId && (
            <InlineError className={styles.error}>{summaryError.text}</InlineError>
          )}
          {hasMore[threadId] && (
            <Button
              disabled={pending || clearing}
              onClick={() => void load(threadId, messages[threadId]?.[0])}
            >
              {t("Load earlier messages")}
            </Button>
          )}
          {searching && <p>{t("Loading...")}</p>}
          {!searching && !visible.length && (
            <p className={styles.empty}>
              {t(threadId ? "No messages to display" : "Open a conversation to begin")}
            </p>
          )}
          {messageElements}
          <LiveText className="sr-only" mode="assertive" text={error} />
          <LiveText
            className="sr-only"
            text={
              searching
                ? t("Loading...")
                : summaryRefreshing
                  ? t("Updating conversation summary")
                  : summaryLabel || ""
            }
          />
          {error && (
            <InlineError className={styles.feedback} live="off">
              {error}{" "}
              <Button disabled={pending || clearing} onClick={() => void checkConversation()}>
                {t("Check conversation")}
              </Button>
            </InlineError>
          )}
        </div>
        {draftSaveError && (
          <InlineError className={`${styles.error} shrink-0 px-5 py-2`}>
            {t("Could not save this draft. It is kept in this window.")}{" "}
            <Button
              type="button"
              onClick={() => {
                if (isTauri() && nativeDraftReady !== nativeDraftKey)
                  setNativeDraftReload((value) => value + 1);
                else flushDrafts();
              }}
            >
              {t("Retry saving")}
            </Button>
            {isTauri() && (
              <Button type="button" onClick={openDraftRecovery}>
                {t("Recover draft")}
              </Button>
            )}
          </InlineError>
        )}
        <div className={styles.composer}>
          <TextareaField
            label={t("Message {p0}", { p0: snapshot.profile.name })}
            hideLabel
            placeholder={t("Message {p0}", { p0: snapshot.profile.name })}
            value={
              threadId && (!isTauri() || nativeDraftDisplayed === nativeDraftKey)
                ? (drafts[threadId] ?? "")
                : ""
            }
            disabled={!threadId}
            readOnly={isTauri() && nativeDraftReady !== nativeDraftKey}
            minRows={1}
            autosize
            maxRows={8}
            maxLength={16000}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                if (supported && !clearing) void send();
              }
            }}
            onChange={(event) => {
              if (isTauri() && isAppQuitting()) return;
              const value = event.currentTarget.value;
              const nativeDraft = nativeDrafts.current.get(threadId);
              if (isTauri() && nativeDraft && nativeDraft.environmentId === environmentId)
                nativeDraft.desired = value;
              draftsRef.current = { ...draftsRef.current, [threadId]: value };
              setDrafts((current) => ({ ...current, [threadId]: value }));
            }}
          />
          <Button
            variant="primary"
            iconOnly
            label={t("Send")}
            tooltip={t("Send")}
            loading={pending}
            disabled={
              clearing ||
              !threadId ||
              !drafts[threadId]?.trim() ||
              !supported ||
              (isTauri() && nativeDraftReady !== nativeDraftKey)
            }
            onClick={() => void send()}
          >
            <ArrowUp className="icon-md" />
          </Button>
        </div>
        {!supported && (
          <p className={styles.muted}>
            {t("Conversation replies are unavailable. Configure a model on this Host.")}
          </p>
        )}
        {draftRecovery &&
          selected.current === draftRecovery.threadId &&
          currentScope.current.environmentId === draftRecovery.environmentId &&
          threadVisible(draftRecovery.threadId) && (
            <Modal
              title={t("Recover draft")}
              onClose={() => {
                if (!draftRecovery.loading) setDraftRecovery(null);
              }}
              size="md"
              fitViewport
              footer={
                <ModalActions>
                  <Button
                    variant="ghost"
                    disabled={draftRecovery.loading}
                    onClick={() => setDraftRecovery(null)}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    loading={draftRecovery.loading}
                    disabled={draftRecovery.selectedText === undefined}
                    onClick={() =>
                      void restoreDraftBackup().catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : String(cause)),
                      )
                    }
                  >
                    {t("Restore draft")}
                  </Button>
                </ModalActions>
              }
            >
              {draftRecovery.error && <InlineError>{draftRecovery.error}</InlineError>}
              <SearchableSelect
                label={t("Saved draft")}
                value={draftRecovery.selected}
                options={draftRecovery.backups.map((item, index) => ({
                  value: item.hash,
                  label: t("Draft {p0}", { p0: index + 1 }),
                  description: formatBytes(item.bytes),
                }))}
                onChange={(value) =>
                  void selectDraftBackup(value).catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                }
                disabled={draftRecovery.loading || draftRecovery.backups.length === 0}
              />
              <TextareaField
                label={t("Draft preview")}
                readOnly
                minRows={3}
                maxRows={8}
                autosize
                value={draftRecovery.selectedText ?? ""}
              />
              {draftRecovery.selectedSavedAt != null && (
                <p className={styles.muted}>
                  {formatDate(draftRecovery.selectedSavedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              {draftRecovery.next && (
                <Button
                  disabled={draftRecovery.loading}
                  onClick={() => {
                    const current = draftRecovery;
                    setDraftRecovery({ ...current, loading: true });
                    void loadDraftBackups(
                      current.threadId,
                      current.environmentId,
                      current.next,
                      current.revision,
                    ).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    );
                  }}
                >
                  {t("Load more")}
                </Button>
              )}
              <Button
                disabled={draftRecovery.loading}
                onClick={() => {
                  const current = draftRecovery;
                  setDraftRecovery({
                    ...current,
                    backups: [],
                    selected: "",
                    selectedText: undefined,
                    selectedSavedAt: undefined,
                    next: undefined,
                    revision: undefined,
                    loading: true,
                  });
                  void loadDraftBackups(current.threadId, current.environmentId).catch(
                    (cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                  );
                }}
              >
                {t("Refresh")}
              </Button>
              {!draftRecovery.loading && !draftRecovery.backups.length && !draftRecovery.error && (
                <p>{t("No saved drafts found.")}</p>
              )}
            </Modal>
          )}
        {confirm && confirmScope.current === privacy.key && (
          <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />
        )}
      </div>
    </div>
  );
}

function NoteEditor({
  request,
  environmentId,
  note,
  onSaved,
  onClose,
}: {
  request: OwnerRequest;
  environmentId?: string;
  note: AssistantNote | "new";
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const original = note === "new" ? null : note;
  const [controller] = useState(
    () => new AssistantNoteDraft(original, localStorage, operationId, environmentId),
  );
  const [draft, setDraft] = useState(() => controller.value);
  const { title, body } = draft;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const save = controller.save(request);
      setDraft(controller.value);
      await save;
      controller.clear();
      await onSaved();
      onClose();
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(original ? "Edit note" : "New note")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="lg"
      fitViewport
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!title.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={`${styles.stack} ${styles.modalBody}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label={t("Title")}
          value={title}
          required
          maxLength={300}
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => {
            controller.update({ title: event.currentTarget.value });
            setDraft(controller.value);
          }}
        />
        <TextareaField
          label={t("Note")}
          value={body}
          minRows={12}
          maxRows={25}
          maxLength={100000}
          disabled={pending || Boolean(draft.intent)}
          onChange={(event) => {
            controller.update({ body: event.currentTarget.value });
            setDraft(controller.value);
          }}
        />
        <LiveText
          className={styles.muted}
          text={
            draft.intent && !pending
              ? t("Note save is pending. Retry to verify the original note.")
              : ""
          }
        />
      </form>
    </Modal>
  );
}

function TrashPanel({
  request,
  entries,
  onRestored,
  onClose,
}: {
  request: OwnerRequest;
  entries: AssistantTrash[];
  onRestored: (id: string) => void;
  onClose: () => void;
}) {
  const [assistantRequest] = useState(() => request);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  async function restore(id: string) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      const result = await assistantRequest({ op: "trash.restore", id });
      if (result.ok !== true)
        throw new Error(
          t("The restore could not be confirmed. Check Recently deleted before retrying."),
        );
      onRestored(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }
  return (
    <Modal title={t("Recently deleted")} onClose={onClose} size="md" fitViewport>
      <div className={`${styles.stack} ${styles.modalBody}`}>
        <p className={styles.muted}>
          {t("Deleted records are kept for seven days. Restoring a job does not restart it.")}
        </p>
        {!entries.length && <p className={styles.empty}>{t("Nothing deleted recently")}</p>}
        {entries.map((entry) => (
          <div className={styles.row} key={entry.id}>
            <div className={styles.rowText}>
              <strong>{entry.title}</strong>
              <p>
                {t(
                  entry.kind === "jobs"
                    ? "Jobs"
                    : entry.kind === "memory"
                      ? "Memory"
                      : entry.kind === "activity"
                        ? "History"
                        : entry.kind === "messages"
                          ? "Messages"
                          : "Notes",
                )}{" "}
                · {date(entry.deletedAt)}
              </p>
              <p>{t("Kept until {p0}", { p0: date(entry.expiresAt) })}</p>
              {entry.kind === "jobs" && entry.deletedTaskCount !== undefined && (
                <p>
                  {t("Includes {p0} deleted tasks. Restoring keeps them stopped.", {
                    p0: entry.deletedTaskCount,
                  })}
                </p>
              )}
            </div>
            <Button
              loading={pending === entry.id}
              disabled={Boolean(pending)}
              onClick={() => void restore(entry.id)}
            >
              {t("Restore")}
            </Button>
            <Button
              iconOnly
              label={t("Delete permanently")}
              disabled={Boolean(pending)}
              onClick={() =>
                setConfirm({
                  title: t("Delete permanently?"),
                  message: entry.title,
                  confirmLabel: t("Delete permanently"),
                  consequences: [t("This record cannot be restored.")],
                  onConfirm: async () => {
                    await assistantRequest({ op: "trash.purge", id: entry.id });
                  },
                })
              }
            >
              <Trash2 className="icon-sm" />
            </Button>
          </div>
        ))}
        {error && <InlineError className={styles.error}>{error}</InlineError>}
        {confirm && <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />}
      </div>
    </Modal>
  );
}
