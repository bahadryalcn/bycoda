import { useEffect, useRef, useState } from "react";
import type {
  AssistantJob,
  AssistantMemory,
  AssistantNote,
  AssistantRequest,
  AssistantSnapshot,
} from "../../../../shared/model/host-contracts/assistant";
import { t, useLocale } from "../../../../shared/i18n";
import { type ConfirmRequest } from "../../../../shared/ui/ConfirmDialog";
import {
  assistantIdentity,
  assistantRequest as ownerRequest,
  operationId,
  useAssistantSnapshot,
} from "../../model/assistantClient";
import { useManualSupervision, visibleAssistantProjects } from "../../model/assistantManual";
import {
  assistantPrivacyScope,
  canReadAssistantBriefing,
  projectAssistantSnapshot,
} from "../../model/assistantPrivacy";
import {
  AssistantJobBatch,
  assistantJobDraftIdentity,
  assistantQuickDraftIdentity,
  assistantJobDraftVisible,
  type AssistantJobDraft,
} from "../../model/assistantJobs";
import { captureAssistantHostRead } from "../../model/assistantHostRead";
import {
  tabs,
  jobIntentsKey,
  readJobIntents,
  commitJobIntents,
  draftText,
  type View,
  type OwnerRequest,
  type Project,
  type AssistantViewProps,
  type Pending,
  type JobDraft,
} from "./assistantRoomHelpers";

export type AssistantRoomCore = ReturnType<typeof useAssistantRoomState>;

// Group-lock values come from the shell, which owns those imports.
export type AssistantRoomLock = {
  roomPrivacy: { pending: boolean; error: string | null };
  useVisibleProjects: <T>(items: readonly T[], pathOf: (item: T) => string) => T[];
  isProjectLocked: (path: string) => boolean;
};

export function useAssistantRoomState(props: AssistantViewProps, lock: AssistantRoomLock) {
  const { roomPrivacy, useVisibleProjects, isProjectLocked } = lock;
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
  const [hostProjectRead, setHostProjectRead] = useState<{
    environmentId: string | undefined;
    projects: readonly Project[];
  } | null>(null);
  const hostProjects = hostProjectRead?.projects ?? null;
  const [projectReadError, setProjectReadError] = useState("");
  const projectReadEpoch = useRef(0);
  function fetchProjects() {
    const epoch = ++projectReadEpoch.current;
    return captureAssistantHostRead(props.environmentId ?? environmentId)
      .then(async (owner) => ({ owner, result: await owner.projects() }))
      .then(
        ({ owner, result }) => {
          if (epoch === projectReadEpoch.current) {
            setHostProjectRead({ environmentId: owner.environmentId, projects: result });
            setProjectReadError("");
          }
        },
        (cause: unknown) => {
          if (epoch === projectReadEpoch.current)
            setProjectReadError(cause instanceof Error ? cause.message : String(cause));
        },
      );
  }
  function readProjects() {
    setProjectReadError("");
    return fetchProjects();
  }
  useEffect(() => {
    fetchProjects().catch(() => undefined); // -- failures are reported by its own rejection handler
    return () => {
      projectReadEpoch.current++;
    };
  }, [props.environmentId, environmentId]);
  const boundProjects =
    environmentId && hostProjectRead?.environmentId !== environmentId ? null : hostProjects;
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
  useEffect(() => {
    visibility.current = { projects, privacy, canonicalSnapshot };
  });
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
  useEffect(() => {
    if (scopeEpoch.current.key !== privacy.key)
      scopeEpoch.current = {
        key: privacy.key,
        value: scopeEpoch.current.value + 1,
      };
  }, [privacy.key]);
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
        ? {
            ...errorState,
            text: t("The stop request could not be confirmed. Check the Room."),
          }
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
  if (restoredUndoId) {
    if (
      !undo ||
      undo.id !== restoredUndoId.id ||
      undo.environmentId !== restoredUndoId.environmentId
    ) {
      setRestoredUndoId(null);
    } else if (pending?.key !== "undo") {
      setUndo(null);
      setErrorState((current) => (current?.key === "undo" ? null : current));
      setRestoredUndoId(null);
    }
  }
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

  const [memorySearch, setMemorySearch] = useState<{
    query: string;
    results: AssistantMemory[];
    settled: boolean;
  } | null>(null);
  const memorySearchActive = view === "Memory" && query.trim() !== "";
  const memorySearchCurrent = memorySearch?.query === query ? memorySearch : null;
  const memoryResults = memorySearchActive ? (memorySearchCurrent?.results ?? []) : null;
  const memorySearching = memorySearchActive && !memorySearchCurrent?.settled;
  useEffect(() => {
    if (view !== "Memory" || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void assistantRequest({ op: "memory.search", query, limit: 100 })
        .then((result) => {
          if (!cancelled) setMemorySearch({ query, results: result.entries ?? [], settled: false });
        })
        .catch((cause) => {
          if (!cancelled)
            setError({
              key: "memory.search",
              text: cause instanceof Error ? cause.message : String(cause),
            });
        })
        .finally(() => {
          if (!cancelled)
            setMemorySearch((current) =>
              current?.query === query
                ? { ...current, settled: true }
                : { query, results: [], settled: true },
            );
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
  const [appliedNavigation, setAppliedNavigation] = useState<{
    tab: string | undefined;
    token: unknown;
  }>({ tab: undefined, token: undefined });
  if (
    appliedNavigation.tab !== props.initialTab ||
    appliedNavigation.token !== props.navigationToken
  ) {
    setAppliedNavigation({ tab: props.initialTab, token: props.navigationToken });
    const target = props.initialTab;
    if (target === "settings") setSettings(true);
    else if (target) {
      const match = tabs.find((tab) => tab.toLowerCase() === target);
      if (match) setView(match);
    }
  }
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
      setError({
        key: "pauseAll",
        text: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }
  const onOpenSession = props.onOpenSession
    ? (id: string, sourceEnvironmentId = props.environmentId ?? environmentId) => {
        run(`navigation:${id}`, t("Opening session..."), async () => {
          if (sourceEnvironmentId) await props.onOpenSession!(id, sourceEnvironmentId);
          else await props.onOpenSession!(id);
        });
      }
    : undefined;

  function returnToAssistant() {
    run("presence.return", t("Preparing briefing..."), async () => {
      setReturnMessage("");
      await assistantRequest({ op: "presence.set", state: "present" });
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      await assistantRequest({ op: "briefing.daily", day });
      const current = (await assistantRequest({ op: "snapshot", limit: 100 })).snapshot;
      if (current && !current.briefing) setReturnMessage(t("Nothing new to report."));
    });
  }

  return {
    locale,
    environmentId,
    assistantRequest,
    hostProjects,
    projectReadError,
    setProjectReadError,
    projectReadEpoch,
    readProjects,
    boundProjects,
    unlockedProjects,
    projects,
    projectPrivacy,
    privacy,
    snapshot,
    visibility,
    canSeeProject,
    canReadBriefing,
    scopeEpoch,
    identity,
    view,
    setView,
    setup,
    setSetup,
    returnMessage,
    setReturnMessage,
    settings,
    setSettings,
    trash,
    setTrash,
    menu,
    setMenu,
    healthAnchor,
    setHealthAnchor,
    presenceAnchor,
    setPresenceAnchor,
    query,
    setQuery,
    filter,
    setFilter,
    jobProjectFilter,
    setJobProjectFilter,
    jobDateFilter,
    setJobDateFilter,
    jobEdit,
    setJobEdit,
    dailySummary,
    setDailySummary,
    filterAnchor,
    setFilterAnchor,
    pending,
    setPending,
    pendingRef,
    stoppingRef,
    stopping,
    setStopping,
    errorState,
    setErrorState,
    error,
    setError,
    confirm,
    setConfirmState,
    confirmPrivacy,
    setConfirm,
    undo,
    setUndo,
    deletedNoteWithoutReceipt,
    setDeletedNoteWithoutReceipt,
    restoredUndoId,
    setRestoredUndoId,
    selected,
    setSelected,
    detail,
    setDetail,
    jobText,
    setJobText,
    jobReview,
    setJobReview,
    jobBatch,
    jobReviewFrozen,
    setJobReviewFrozen,
    jobReviewEnvironment,
    jobIntents,
    jobKey,
    reviewIntent,
    reviewedDraft,
    visibleDraft,
    updateJobDraft,
    memoryResults,
    memorySearching,
    memoryEntries,
    memoryEdit,
    setMemoryEdit,
    noteEdit,
    setNoteEdit,
    manual,
    currentProject,
    defaultProjectId,
    run,
    mutate,
    stopEverything,
    onOpenSession,
    returnToAssistant,
    canonicalSnapshot,
    snapshotEnvironmentId,
    loading,
    readError,
    refresh,
    roomPrivacy,
    props,
  };
}
